import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticateRequest, requireRoles, ROLES, type StaffRole } from '../lib/rbac.js';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../lib/errors.js';
import { recordAuditLog } from '../lib/audit.js';
import { emitRealtimeEvent } from '../lib/realtime.js';
import { deductInventoryForOrderTx, emitLowStockAlerts } from '../lib/inventory.js';

export const ORDER_STATUSES = [
  'NEW',
  'ACCEPTED',
  'PREPARING',
  'READY',
  'SERVED',
  'COMPLETED',
  'REJECTED',
  'CANCELLED',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  NEW: ['ACCEPTED', 'REJECTED', 'CANCELLED'],
  ACCEPTED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['SERVED', 'CANCELLED'],
  SERVED: ['COMPLETED'],
  COMPLETED: [],
  REJECTED: [],
  CANCELLED: [],
};

const STATUS_ROLE_MATRIX: Record<OrderStatus, StaffRole[]> = {
  NEW: [],
  ACCEPTED: [ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.WAITER, ROLES.KITCHEN_STAFF],
  REJECTED: [ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.WAITER, ROLES.KITCHEN_STAFF],
  PREPARING: [ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.KITCHEN_STAFF],
  READY: [ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.KITCHEN_STAFF],
  SERVED: [ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.WAITER],
  COMPLETED: [ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.WAITER],
  CANCELLED: [ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.WAITER],
};

const statusChangeSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  reason: z.string().max(300).optional(),
});

const itemStatusSchema = z.object({
  itemStatus: z.enum(['PENDING', 'PREPARING', 'READY', 'SERVED']),
});

const paymentSchema = z.object({
  amountCents: z.number().int().positive(),
  method: z.enum(['CASH', 'CARD', 'UPI', 'ONLINE']).default('CARD'),
  reference: z.string().max(100).optional(),
});

export async function orderRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/orders', { preHandler: [authenticateRequest] }, async (request) => {
    const query = request.query as { status?: string; tableId?: string; since?: string };
    const statuses = query.status
      ? query.status
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;

    const orders = await prisma.order.findMany({
      where: {
        restaurantId: request.user.restaurantId,
        ...(statuses && statuses.length > 0 ? { status: { in: statuses } } : {}),
        ...(query.tableId ? { tableId: query.tableId } : {}),
        ...(query.since ? { updatedAt: { gte: new Date(query.since) } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        table: { select: { id: true, tableNumber: true, label: true } },
        items: true,
        payments: true,
        refunds: true,
      },
    });

    return { orders };
  });

  app.get('/api/v1/orders/:id', { preHandler: [authenticateRequest] }, async (request) => {
    const { id } = request.params as { id: string };
    const order = await prisma.order.findFirst({
      where: { id, restaurantId: request.user.restaurantId },
      include: {
        table: { select: { id: true, tableNumber: true, label: true } },
        items: true,
        statusHistory: {
          orderBy: { createdAt: 'asc' },
          include: { changedBy: { select: { id: true, name: true, role: true } } },
        },
        payments: true,
        refunds: true,
      },
    });
    if (!order) throw new NotFoundError('Order not found');
    return { order };
  });

  app.patch('/api/v1/orders/:id/status', { preHandler: [authenticateRequest] }, async (request) => {
    const { id } = request.params as { id: string };
    const { status: nextStatus, reason } = statusChangeSchema.parse(request.body);

    const existing = await prisma.order.findFirst({
      where: { id, restaurantId: request.user.restaurantId },
      include: { table: true },
    });
    if (!existing) throw new NotFoundError('Order not found');

    const currentStatus = existing.status as OrderStatus;
    if (!ALLOWED_TRANSITIONS[currentStatus].includes(nextStatus)) {
      throw new ConflictError(`Invalid order transition from ${currentStatus} to ${nextStatus}`);
    }

    const allowedRoles = STATUS_ROLE_MATRIX[nextStatus];
    if (!allowedRoles.includes(request.user.role)) {
      throw new ForbiddenError(
        `Role ${request.user.role} cannot transition an order to ${nextStatus}`
      );
    }

    const now = new Date();
    const timestampPatch: Record<string, Date> = {};
    if (nextStatus === 'ACCEPTED') timestampPatch.acceptedAt = now;
    if (nextStatus === 'PREPARING') timestampPatch.preparingAt = now;
    if (nextStatus === 'READY') timestampPatch.readyAt = now;
    if (nextStatus === 'SERVED') timestampPatch.servedAt = now;
    if (nextStatus === 'COMPLETED') timestampPatch.completedAt = now;
    if (nextStatus === 'CANCELLED') timestampPatch.cancelledAt = now;

    const { updatedOrder, lowStockAlerts } = await prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { id: existing.id },
        data: {
          status: nextStatus,
          ...(nextStatus === 'REJECTED' && reason ? { rejectionReason: reason } : {}),
          ...timestampPatch,
          statusHistory: {
            create: {
              fromStatus: currentStatus,
              toStatus: nextStatus,
              changedById: request.user.id,
              reason: reason ?? null,
            },
          },
        },
        include: {
          table: { select: { id: true, tableNumber: true, label: true } },
          items: true,
          payments: true,
          refunds: true,
        },
      });

      // Deduct inventory once when order is ACCEPTED
      let alerts: Array<{
        ingredientId: string;
        name: string;
        stockQty: number;
        lowStockThreshold: number;
      }> = [];
      if (nextStatus === 'ACCEPTED') {
        alerts = await deductInventoryForOrderTx(tx, {
          restaurantId: request.user.restaurantId,
          orderId: existing.id,
          orderNumber: existing.orderNumber,
          actorId: request.user.id,
        });
      }

      if (nextStatus === 'READY' || nextStatus === 'ACCEPTED' || nextStatus === 'REJECTED') {
        const notifType =
          nextStatus === 'READY'
            ? 'ORDER_READY'
            : nextStatus === 'ACCEPTED'
              ? 'ORDER_ACCEPTED'
              : 'ORDER_REJECTED';
        await tx.notification.upsert({
          where: { dedupeKey: `order:${existing.id}:${nextStatus}` },
          update: {},
          create: {
            restaurantId: request.user.restaurantId,
            type: notifType,
            title: `Order ${existing.orderNumber} ${nextStatus}`,
            message: `Table ${existing.table.tableNumber} order is now ${nextStatus}`,
            entityType: 'Order',
            entityId: existing.id,
            dedupeKey: `order:${existing.id}:${nextStatus}`,
          },
        });
      }

      return { updatedOrder: updated, lowStockAlerts: alerts };
    });

    await recordAuditLog({
      restaurantId: request.user.restaurantId,
      actorId: request.user.id,
      action: 'ORDER_STATUS_CHANGED',
      entityType: 'Order',
      entityId: updatedOrder.id,
      metadata: { from: currentStatus, to: nextStatus, reason },
      ipAddress: request.ip,
    });

    await emitRealtimeEvent(request.user.restaurantId, 'order.updated', { order: updatedOrder });
    if (lowStockAlerts.length > 0) {
      await emitLowStockAlerts(request.user.restaurantId, lowStockAlerts);
    }

    return { order: updatedOrder };
  });

  app.patch(
    '/api/v1/orders/:orderId/items/:itemId/status',
    {
      preHandler: [
        requireRoles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.KITCHEN_STAFF, ROLES.WAITER),
      ],
    },
    async (request) => {
      const { orderId, itemId } = request.params as { orderId: string; itemId: string };
      const { itemStatus } = itemStatusSchema.parse(request.body);

      const order = await prisma.order.findFirst({
        where: { id: orderId, restaurantId: request.user.restaurantId },
      });
      if (!order) throw new NotFoundError('Order not found');

      const item = await prisma.orderItem.findFirst({
        where: { id: itemId, orderId },
      });
      if (!item) throw new NotFoundError('Order item not found');

      const updatedItem = await prisma.orderItem.update({
        where: { id: itemId },
        data: { itemStatus },
      });

      const fullOrder = await prisma.order.findUniqueOrThrow({
        where: { id: orderId },
        include: {
          table: { select: { id: true, tableNumber: true, label: true } },
          items: true,
          payments: true,
          refunds: true,
        },
      });

      await emitRealtimeEvent(request.user.restaurantId, 'order.item_updated', {
        orderId,
        item: updatedItem,
        order: fullOrder,
      });

      return { item: updatedItem, order: fullOrder };
    }
  );

  app.post(
    '/api/v1/orders/:id/payments',
    { preHandler: [requireRoles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.WAITER)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = paymentSchema.parse(request.body);

      const order = await prisma.order.findFirst({
        where: { id, restaurantId: request.user.restaurantId },
        include: { payments: { where: { status: 'COMPLETED' } } },
      });
      if (!order) throw new NotFoundError('Order not found');
      if (order.status === 'CANCELLED' || order.status === 'REJECTED') {
        throw new BadRequestError(`Cannot record payment for ${order.status} order`);
      }

      const alreadyPaid = order.payments.reduce((s, p) => s + p.amountCents, 0);
      const remaining = Math.max(0, order.totalCents - alreadyPaid);
      if (body.amountCents > remaining) {
        throw new BadRequestError(
          `Payment amount (${body.amountCents}) exceeds remaining balance (${remaining})`
        );
      }

      const newPaidTotal = alreadyPaid + body.amountCents;
      const newPaymentStatus = newPaidTotal >= order.totalCents ? 'PAID' : 'PARTIALLY_PAID';

      const result = await prisma.$transaction(async (tx) => {
        const payment = await tx.payment.create({
          data: {
            restaurantId: request.user.restaurantId,
            orderId: order.id,
            amountCents: body.amountCents,
            method: body.method,
            status: 'COMPLETED',
            reference: body.reference ?? null,
          },
        });

        const updatedOrder = await tx.order.update({
          where: { id: order.id },
          data: { paymentStatus: newPaymentStatus },
          include: {
            table: { select: { id: true, tableNumber: true, label: true } },
            items: true,
            payments: true,
            refunds: true,
          },
        });

        return { payment, updatedOrder };
      });

      await recordAuditLog({
        restaurantId: request.user.restaurantId,
        actorId: request.user.id,
        action: 'PAYMENT_RECORDED',
        entityType: 'Order',
        entityId: order.id,
        metadata: { amountCents: body.amountCents, method: body.method },
        ipAddress: request.ip,
      });

      await emitRealtimeEvent(request.user.restaurantId, 'order.updated', {
        order: result.updatedOrder,
      });

      return reply.status(201).send(result);
    }
  );
}
