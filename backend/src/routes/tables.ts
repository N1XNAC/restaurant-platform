import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticateRequest, requireRoles, ROLES } from '../lib/rbac.js';
import { BadRequestError, ConflictError, NotFoundError } from '../lib/errors.js';
import { recordAuditLog } from '../lib/audit.js';
import { emitRealtimeEvent } from '../lib/realtime.js';

const TABLE_STATUSES = ['AVAILABLE', 'OCCUPIED', 'RESERVED', 'CLEANING'] as const;
const ACTIVE_ORDER_STATUSES = ['NEW', 'ACCEPTED', 'PREPARING', 'READY', 'SERVED'];

const createTableSchema = z.object({
  tableNumber: z.string().min(1).max(20),
  label: z.string().max(60).optional(),
  capacity: z.number().int().min(1).max(30).default(4),
  assignedWaiterId: z.string().nullable().optional(),
});

const updateTableSchema = z.object({
  tableNumber: z.string().min(1).max(20).optional(),
  label: z.string().max(60).nullable().optional(),
  capacity: z.number().int().min(1).max(30).optional(),
  isActive: z.boolean().optional(),
  assignedWaiterId: z.string().nullable().optional(),
});

const updateTableStatusSchema = z.object({
  status: z.enum(TABLE_STATUSES),
});

export async function tableRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/tables', { preHandler: [authenticateRequest] }, async (request) => {
    const tables = await prisma.restaurantTable.findMany({
      where: { restaurantId: request.user.restaurantId },
      orderBy: { tableNumber: 'asc' },
      include: {
        assignedWaiter: { select: { id: true, name: true } },
        orders: {
          where: { status: { in: ACTIVE_ORDER_STATUSES } },
          select: {
            id: true,
            orderNumber: true,
            status: true,
            paymentStatus: true,
            totalCents: true,
            createdAt: true,
            payments: {
              where: { status: 'COMPLETED' },
              select: { amountCents: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    const enriched = tables.map((t) => {
      const outstandingCents = t.orders.reduce((sum, o) => {
        const paid = o.payments.reduce((pSum, p) => pSum + p.amountCents, 0);
        return sum + Math.max(0, o.totalCents - paid);
      }, 0);
      return {
        ...t,
        activeOrdersCount: t.orders.length,
        outstandingCents,
      };
    });

    return { tables: enriched };
  });

  app.post(
    '/api/v1/tables',
    { preHandler: [requireRoles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)] },
    async (request, reply) => {
      const data = createTableSchema.parse(request.body);
      const existing = await prisma.restaurantTable.findUnique({
        where: {
          restaurantId_tableNumber: {
            restaurantId: request.user.restaurantId,
            tableNumber: data.tableNumber.trim(),
          },
        },
      });
      if (existing) {
        throw new ConflictError(`Table ${data.tableNumber} already exists`);
      }

      const table = await prisma.restaurantTable.create({
        data: {
          restaurantId: request.user.restaurantId,
          tableNumber: data.tableNumber.trim(),
          label: data.label ?? null,
          capacity: data.capacity,
          assignedWaiterId: data.assignedWaiterId ?? null,
        },
      });

      await recordAuditLog({
        restaurantId: request.user.restaurantId,
        actorId: request.user.id,
        action: 'TABLE_CREATED',
        entityType: 'RestaurantTable',
        entityId: table.id,
        metadata: { tableNumber: table.tableNumber },
        ipAddress: request.ip,
      });

      await emitRealtimeEvent(request.user.restaurantId, 'table.updated', { table });
      return reply.status(201).send({ table });
    }
  );

  app.patch(
    '/api/v1/tables/:id',
    { preHandler: [requireRoles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)] },
    async (request) => {
      const { id } = request.params as { id: string };
      const data = updateTableSchema.parse(request.body);

      const existing = await prisma.restaurantTable.findFirst({
        where: { id, restaurantId: request.user.restaurantId },
      });
      if (!existing) throw new NotFoundError('Table not found');

      if (data.isActive === false) {
        const activeOrders = await prisma.order.count({
          where: {
            restaurantId: request.user.restaurantId,
            tableId: id,
            status: { in: ACTIVE_ORDER_STATUSES },
          },
        });
        if (activeOrders > 0) {
          throw new ConflictError('Cannot deactivate table with active orders');
        }
      }

      const table = await prisma.restaurantTable.update({
        where: { id },
        data,
      });

      await recordAuditLog({
        restaurantId: request.user.restaurantId,
        actorId: request.user.id,
        action: 'TABLE_UPDATED',
        entityType: 'RestaurantTable',
        entityId: table.id,
        metadata: data,
        ipAddress: request.ip,
      });

      await emitRealtimeEvent(request.user.restaurantId, 'table.updated', { table });
      return { table };
    }
  );

  app.patch(
    '/api/v1/tables/:id/status',
    { preHandler: [requireRoles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.WAITER)] },
    async (request) => {
      const { id } = request.params as { id: string };
      const { status } = updateTableStatusSchema.parse(request.body);

      const existing = await prisma.restaurantTable.findFirst({
        where: { id, restaurantId: request.user.restaurantId },
      });
      if (!existing) throw new NotFoundError('Table not found');
      if (!existing.isActive) {
        throw new BadRequestError('Cannot change status of an inactive table');
      }

      if (status === 'AVAILABLE') {
        const activeOrders = await prisma.order.count({
          where: {
            restaurantId: request.user.restaurantId,
            tableId: id,
            status: { in: ACTIVE_ORDER_STATUSES },
          },
        });
        if (activeOrders > 0) {
          throw new ConflictError(
            `Cannot mark table AVAILABLE while ${activeOrders} active order(s) remain`
          );
        }
      }

      const table = await prisma.restaurantTable.update({
        where: { id },
        data: { status },
      });

      await recordAuditLog({
        restaurantId: request.user.restaurantId,
        actorId: request.user.id,
        action: 'TABLE_STATUS_CHANGED',
        entityType: 'RestaurantTable',
        entityId: table.id,
        metadata: { from: existing.status, to: status },
        ipAddress: request.ip,
      });

      await emitRealtimeEvent(request.user.restaurantId, 'table.updated', { table });
      return { table };
    }
  );

  app.delete(
    '/api/v1/tables/:id',
    { preHandler: [requireRoles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)] },
    async (request) => {
      const { id } = request.params as { id: string };
      const existing = await prisma.restaurantTable.findFirst({
        where: { id, restaurantId: request.user.restaurantId },
      });
      if (!existing) throw new NotFoundError('Table not found');

      const activeOrders = await prisma.order.count({
        where: {
          restaurantId: request.user.restaurantId,
          tableId: id,
          status: { in: ACTIVE_ORDER_STATUSES },
        },
      });
      if (activeOrders > 0) {
        throw new ConflictError('Cannot delete or deactivate table while active orders remain');
      }

      const totalOrders = await prisma.order.count({
        where: { restaurantId: request.user.restaurantId, tableId: id },
      });

      if (totalOrders > 0) {
        const table = await prisma.restaurantTable.update({
          where: { id },
          data: { isActive: false },
        });
        await emitRealtimeEvent(request.user.restaurantId, 'table.updated', { table });
        return { deactivated: true, table };
      }

      await prisma.restaurantTable.delete({ where: { id } });
      await emitRealtimeEvent(request.user.restaurantId, 'table.updated', { id, deleted: true });
      return { deleted: true };
    }
  );
}
