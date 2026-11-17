import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticateRequest, requireRoles, ROLES } from '../lib/rbac.js';
import { BadRequestError, NotFoundError } from '../lib/errors.js';
import { recordAuditLog } from '../lib/audit.js';
import { emitRealtimeEvent } from '../lib/realtime.js';

function resolveDateRange(query: { range?: string; from?: string; to?: string }) {
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

  switch (query.range) {
    case 'yesterday': {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return { from: startOfDay(y), to: endOfDay(y) };
    }
    case '7d': {
      const s = new Date(now);
      s.setDate(s.getDate() - 6);
      return { from: startOfDay(s), to: endOfDay(now) };
    }
    case '30d': {
      const s = new Date(now);
      s.setDate(s.getDate() - 29);
      return { from: startOfDay(s), to: endOfDay(now) };
    }
    case 'month': {
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: startOfDay(s), to: endOfDay(now) };
    }
    case 'custom': {
      const from = query.from ? startOfDay(new Date(query.from)) : startOfDay(now);
      const to = query.to ? endOfDay(new Date(query.to)) : endOfDay(now);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        throw new BadRequestError('Invalid custom date range');
      }
      return { from, to };
    }
    case 'today':
    default:
      return { from: startOfDay(now), to: endOfDay(now) };
  }
}

const expenseSchema = z.object({
  category: z.string().min(1).max(60),
  description: z.string().min(1).max(250),
  amountCents: z.number().int().positive(),
  expenseDate: z.string().optional(),
});

const refundSchema = z.object({
  amountCents: z.number().int().positive(),
  reason: z.string().min(2).max(300),
});

export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/analytics/summary', { preHandler: [authenticateRequest] }, async (request) => {
    const query = request.query as { range?: string; from?: string; to?: string };
    const { from, to } = resolveDateRange(query);
    const restaurantId = request.user.restaurantId;

    const [orders, tables, refunds, expenses, consumptionTx, recentReviews, menuCategories] =
      await Promise.all([
        prisma.order.findMany({
          where: { restaurantId, createdAt: { gte: from, lte: to } },
          include: {
            table: { select: { id: true, tableNumber: true } },
            items: {
              include: {
                menuItem: { select: { categoryId: true } },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.restaurantTable.findMany({
          where: { restaurantId, isActive: true },
          select: { id: true, status: true },
        }),
        prisma.refund.findMany({
          where: { restaurantId, createdAt: { gte: from, lte: to } },
        }),
        prisma.expense.findMany({
          where: { restaurantId, expenseDate: { gte: from, lte: to } },
        }),
        prisma.inventoryTransaction.findMany({
          where: {
            restaurantId,
            type: 'CONSUMPTION',
            createdAt: { gte: from, lte: to },
          },
        }),
        prisma.review.findMany({
          where: { restaurantId },
          orderBy: { createdAt: 'desc' },
          take: 5,
        }),
        prisma.menuCategory.findMany({
          where: { restaurantId },
          select: { id: true, name: true },
        }),
      ]);

    const categoryNameMap = new Map(menuCategories.map((c) => [c.id, c.name]));

    const statusCounts: Record<string, number> = {
      NEW: 0,
      ACCEPTED: 0,
      PREPARING: 0,
      READY: 0,
      SERVED: 0,
      COMPLETED: 0,
      REJECTED: 0,
      CANCELLED: 0,
    };

    let grossSalesCents = 0;
    let discountsCents = 0;
    let taxesCollectedCents = 0;
    let serviceChargesCents = 0;
    let totalDishesSold = 0;
    let validOrdersCount = 0;

    const dishStats = new Map<string, { name: string; quantity: number; revenueCents: number }>();
    const categoryStats = new Map<string, { name: string; revenueCents: number; count: number }>();
    const hourlyMap = new Map<number, { hour: string; orders: number; salesCents: number }>();

    for (let h = 0; h < 24; h++) {
      hourlyMap.set(h, { hour: `${String(h).padStart(2, '0')}:00`, orders: 0, salesCents: 0 });
    }

    for (const order of orders) {
      statusCounts[order.status] = (statusCounts[order.status] ?? 0) + 1;

      // Cancelled & rejected orders must NOT count toward completed sales
      if (order.status !== 'CANCELLED' && order.status !== 'REJECTED') {
        validOrdersCount += 1;
        grossSalesCents += order.subtotalCents;
        discountsCents += order.discountCents;
        taxesCollectedCents += order.taxCents;
        serviceChargesCents += order.serviceChargeCents;

        const hourBucket = hourlyMap.get(order.createdAt.getHours());
        if (hourBucket) {
          hourBucket.orders += 1;
          hourBucket.salesCents += order.totalCents;
        }

        for (const item of order.items) {
          totalDishesSold += item.quantity;
          const prevDish = dishStats.get(item.itemNameSnapshot);
          if (prevDish) {
            prevDish.quantity += item.quantity;
            prevDish.revenueCents += item.lineTotalCents;
          } else {
            dishStats.set(item.itemNameSnapshot, {
              name: item.itemNameSnapshot,
              quantity: item.quantity,
              revenueCents: item.lineTotalCents,
            });
          }

          const catId = item.menuItem?.categoryId ?? 'uncategorized';
          const catName = categoryNameMap.get(catId) ?? 'Other';
          const prevCat = categoryStats.get(catName);
          if (prevCat) {
            prevCat.revenueCents += item.lineTotalCents;
            prevCat.count += item.quantity;
          } else {
            categoryStats.set(catName, {
              name: catName,
              revenueCents: item.lineTotalCents,
              count: item.quantity,
            });
          }
        }
      }
    }

    const refundsCents = refunds.reduce((s, r) => s + r.amountCents, 0);
    const netSalesCents = Math.max(0, grossSalesCents - discountsCents - refundsCents);

    // COGS from actual inventory consumption transactions (abs(delta) * unitCostCents)
    const cogsCents = consumptionTx.reduce(
      (s, tx) => s + Math.round(Math.abs(tx.quantityDelta) * tx.unitCostCents),
      0
    );
    const operatingExpensesCents = expenses.reduce((s, e) => s + e.amountCents, 0);
    const estimatedGrossProfitCents = netSalesCents - cogsCents;
    const estimatedNetProfitCents = estimatedGrossProfitCents - operatingExpensesCents;
    const averageOrderValueCents =
      validOrdersCount > 0 ? Math.round(netSalesCents / validOrdersCount) : 0;

    const occupiedTables = tables.filter((t) => t.status === 'OCCUPIED').length;
    const availableTables = tables.filter((t) => t.status === 'AVAILABLE').length;

    const popularDishes = [...dishStats.values()]
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 10);

    const revenueByCategory = [...categoryStats.values()].sort(
      (a, b) => b.revenueCents - a.revenueCents
    );

    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      kpis: {
        totalOrders: orders.length,
        pendingOrders: statusCounts.NEW,
        acceptedOrders: statusCounts.ACCEPTED,
        preparingOrders: statusCounts.PREPARING,
        readyOrders: statusCounts.READY,
        servedOrders: statusCounts.SERVED,
        completedOrders: statusCounts.COMPLETED,
        cancelledOrders: statusCounts.CANCELLED,
        rejectedOrders: statusCounts.REJECTED,
        grossSalesCents,
        discountsCents,
        refundsCents,
        netSalesCents,
        taxesCollectedCents,
        serviceChargesCents,
        cogsCents,
        operatingExpensesCents,
        estimatedGrossProfitCents,
        estimatedNetProfitCents,
        totalDishesSold,
        averageOrderValueCents,
        occupiedTables,
        availableTables,
        totalActiveTables: tables.length,
      },
      popularDishes,
      revenueByCategory,
      hourlySeries: [...hourlyMap.values()],
      recentOrders: orders.slice(0, 10),
      recentReviews,
    };
  });

  app.get(
    '/api/v1/analytics/export.csv',
    { preHandler: [requireRoles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)] },
    async (request, reply) => {
      const query = request.query as { range?: string; from?: string; to?: string };
      const { from, to } = resolveDateRange(query);

      const orders = await prisma.order.findMany({
        where: { restaurantId: request.user.restaurantId, createdAt: { gte: from, lte: to } },
        include: { table: { select: { tableNumber: true } } },
        orderBy: { createdAt: 'desc' },
      });

      const header =
        'OrderNumber,Table,Status,PaymentStatus,Subtotal,Tax,Discount,Total,CreatedAt\n';
      const rows = orders
        .map((o) =>
          [
            o.orderNumber,
            o.table.tableNumber,
            o.status,
            o.paymentStatus,
            (o.subtotalCents / 100).toFixed(2),
            (o.taxCents / 100).toFixed(2),
            (o.discountCents / 100).toFixed(2),
            (o.totalCents / 100).toFixed(2),
            o.createdAt.toISOString(),
          ].join(',')
        )
        .join('\n');

      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', 'attachment; filename="sales-report.csv"');
      return reply.send(header + rows);
    }
  );

  app.get('/api/v1/expenses', { preHandler: [authenticateRequest] }, async (request) => {
    const expenses = await prisma.expense.findMany({
      where: { restaurantId: request.user.restaurantId },
      orderBy: { expenseDate: 'desc' },
      take: 100,
      include: { recordedBy: { select: { id: true, name: true } } },
    });
    return { expenses };
  });

  app.post(
    '/api/v1/expenses',
    { preHandler: [requireRoles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)] },
    async (request, reply) => {
      const data = expenseSchema.parse(request.body);
      const expense = await prisma.expense.create({
        data: {
          restaurantId: request.user.restaurantId,
          category: data.category.trim(),
          description: data.description.trim(),
          amountCents: data.amountCents,
          expenseDate: data.expenseDate ? new Date(data.expenseDate) : new Date(),
          recordedById: request.user.id,
        },
      });

      await recordAuditLog({
        restaurantId: request.user.restaurantId,
        actorId: request.user.id,
        action: 'EXPENSE_RECORDED',
        entityType: 'Expense',
        entityId: expense.id,
        metadata: { category: expense.category, amountCents: expense.amountCents },
        ipAddress: request.ip,
      });

      return reply.status(201).send({ expense });
    }
  );

  app.delete(
    '/api/v1/expenses/:id',
    { preHandler: [requireRoles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)] },
    async (request) => {
      const { id } = request.params as { id: string };
      const existing = await prisma.expense.findFirst({
        where: { id, restaurantId: request.user.restaurantId },
      });
      if (!existing) throw new NotFoundError('Expense not found');
      await prisma.expense.delete({ where: { id } });
      return { deleted: true };
    }
  );

  app.post(
    '/api/v1/orders/:id/refunds',
    { preHandler: [requireRoles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const data = refundSchema.parse(request.body);

      const order = await prisma.order.findFirst({
        where: { id, restaurantId: request.user.restaurantId },
        include: {
          payments: { where: { status: 'COMPLETED' } },
          refunds: true,
        },
      });
      if (!order) throw new NotFoundError('Order not found');

      const paidCents = order.payments.reduce((s, p) => s + p.amountCents, 0);
      const alreadyRefunded = order.refunds.reduce((s, r) => s + r.amountCents, 0);
      const refundableCents = Math.max(0, paidCents - alreadyRefunded);

      if (data.amountCents > refundableCents) {
        throw new BadRequestError(
          `Refund amount (${data.amountCents}) exceeds refundable balance (${refundableCents})`
        );
      }

      const newRefundedTotal = alreadyRefunded + data.amountCents;
      const newPaymentStatus =
        newRefundedTotal >= paidCents ? 'REFUNDED' : 'PARTIALLY_REFUNDED';

      const result = await prisma.$transaction(async (tx) => {
        const refund = await tx.refund.create({
          data: {
            restaurantId: request.user.restaurantId,
            orderId: order.id,
            amountCents: data.amountCents,
            reason: data.reason.trim(),
            processedById: request.user.id,
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

        return { refund, updatedOrder };
      });

      await recordAuditLog({
        restaurantId: request.user.restaurantId,
        actorId: request.user.id,
        action: 'REFUND_PROCESSED',
        entityType: 'Order',
        entityId: order.id,
        metadata: { amountCents: data.amountCents, reason: data.reason },
        ipAddress: request.ip,
      });

      await emitRealtimeEvent(request.user.restaurantId, 'order.updated', {
        order: result.updatedOrder,
      });

      return reply.status(201).send(result);
    }
  );
}
