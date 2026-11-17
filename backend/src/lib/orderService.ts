import type { Restaurant } from '@prisma/client';
import { prisma } from './prisma.js';
import { emitRealtimeEvent } from './realtime.js';

export interface PreparedLine {
  menuItemId: string;
  itemNameSnapshot: string;
  unitPriceCents: number;
  quantity: number;
  variationsSnapshotJson: string;
  extrasSnapshotJson: string;
  extrasTotalCents: number;
  lineTotalCents: number;
  specialInstructions: string | null;
  prepTimeMinutes: number;
}

export interface PricingTotals {
  subtotalCents: number;
  taxCents: number;
  serviceChargeCents: number;
  totalCents: number;
}

/**
 * Single source of truth for order pricing. Tax and service charge are computed
 * on the item subtotal only, using integer minor units.
 */
export function computePricing(subtotalCents: number, restaurant: Pick<Restaurant, 'taxRateBps' | 'serviceChargeBps'>): PricingTotals {
  const taxCents = Math.round((subtotalCents * restaurant.taxRateBps) / 10000);
  const serviceChargeCents = Math.round((subtotalCents * restaurant.serviceChargeBps) / 10000);
  return {
    subtotalCents,
    taxCents,
    serviceChargeCents,
    totalCents: subtotalCents + taxCents + serviceChargeCents,
  };
}

export interface CreateOrderInput {
  restaurant: Restaurant;
  tableId: string;
  tableNumber: string;
  lines: PreparedLine[];
  notes?: string | null;
  idempotencyKey?: string | null;
  orderMode?: string;
  customerSessionId?: string | null;
}

export interface CreateOrderResult {
  order: Awaited<ReturnType<typeof prisma.order.create>> & {
    table: { id: string; tableNumber: string; label: string | null };
    items: unknown[];
  };
  deduplicated: boolean;
}

/**
 * Creates a customer order inside a DB transaction and emits realtime events.
 * Idempotency is enforced by the unique (restaurantId, idempotencyKey) index.
 */
export async function createCustomerOrder(input: CreateOrderInput) {
  const { restaurant, tableId, tableNumber, lines } = input;

  if (input.idempotencyKey) {
    const existing = await prisma.order.findUnique({
      where: {
        restaurantId_idempotencyKey: {
          restaurantId: restaurant.id,
          idempotencyKey: input.idempotencyKey,
        },
      },
      include: {
        table: { select: { id: true, tableNumber: true, label: true } },
        items: true,
      },
    });
    if (existing) {
      return { order: existing, deduplicated: true, created: false };
    }
  }

  const subtotalCents = lines.reduce((sum, l) => sum + l.lineTotalCents, 0);
  const pricing = computePricing(subtotalCents, restaurant);
  const orderNumber = `ORD-${Date.now().toString(36).toUpperCase()}-${Math.random()
    .toString(16)
    .slice(2, 6)
    .toUpperCase()}`;

  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        restaurantId: restaurant.id,
        tableId,
        orderNumber,
        idempotencyKey: input.idempotencyKey ?? null,
        status: 'NEW',
        paymentStatus: 'UNPAID',
        subtotalCents: pricing.subtotalCents,
        taxCents: pricing.taxCents,
        serviceChargeCents: pricing.serviceChargeCents,
        discountCents: 0,
        totalCents: pricing.totalCents,
        notes: input.notes ?? null,
        orderMode: input.orderMode ?? 'table_cart',
        customerSessionId: input.customerSessionId ?? null,
        items: { create: lines },
        statusHistory: {
          create: { fromStatus: null, toStatus: 'NEW', reason: 'Customer submitted order' },
        },
      },
      include: {
        table: { select: { id: true, tableNumber: true, label: true } },
        items: true,
      },
    });

    const table = await tx.restaurantTable.findUniqueOrThrow({ where: { id: tableId } });
    let updatedTable = table;
    if (table.status === 'AVAILABLE' || table.status === 'RESERVED') {
      updatedTable = await tx.restaurantTable.update({
        where: { id: table.id },
        data: { status: 'OCCUPIED' },
      });
    }

    await tx.notification.create({
      data: {
        restaurantId: restaurant.id,
        type: 'NEW_ORDER',
        title: `New Order ${order.orderNumber}`,
        message: `Table ${tableNumber} placed an order (${lines.length} item line(s))`,
        entityType: 'Order',
        entityId: order.id,
        dedupeKey: `order:${order.id}:NEW`,
      },
    });

    return { order, table: updatedTable };
  });

  await emitRealtimeEvent(restaurant.id, 'order.created', { order: result.order });
  await emitRealtimeEvent(restaurant.id, 'table.updated', { table: result.table });
  await emitRealtimeEvent(restaurant.id, 'notification.created', {
    type: 'NEW_ORDER',
    orderId: result.order.id,
  });

  return { order: result.order, deduplicated: false, created: true };
}

/**
 * Cancels a customer order. Only NEW/ACCEPTED orders can be cancelled, and only
 * inside the grace window (minutes after creation).
 */
export async function cancelCustomerOrder(params: {
  restaurantId: string;
  orderId: string;
  reason?: string;
  graceMinutes?: number;
}) {
  const graceMinutes = params.graceMinutes ?? 5;
  const order = await prisma.order.findFirst({
    where: { id: params.orderId, restaurantId: params.restaurantId },
    include: {
      table: { select: { id: true, tableNumber: true, label: true } },
      items: true,
    },
  });
  if (!order) return { order: null, error: 'NOT_FOUND' as const };

  if (order.status === 'CANCELLED') {
    return { order, error: null };
  }
  if (order.status !== 'NEW' && order.status !== 'ACCEPTED') {
    return { order: null, error: 'TOO_LATE' as const };
  }
  const cancellableUntil = new Date(order.createdAt.getTime() + graceMinutes * 60000);
  if (Date.now() > cancellableUntil.getTime()) {
    return { order: null, error: 'GRACE_EXPIRED' as const };
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.order.update({
      where: { id: order.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        rejectionReason: params.reason ?? 'Cancelled by customer',
        statusHistory: {
          create: {
            fromStatus: order.status,
            toStatus: 'CANCELLED',
            reason: params.reason ?? 'Cancelled by customer',
          },
        },
      },
      include: {
        table: { select: { id: true, tableNumber: true, label: true } },
        items: true,
      },
    });

    await tx.notification.upsert({
      where: { dedupeKey: `order:${order.id}:CANCELLED` },
      update: {},
      create: {
        restaurantId: params.restaurantId,
        type: 'ORDER_CANCELLED',
        title: `Order ${order.orderNumber} cancelled`,
        message: `Table ${order.table.tableNumber} cancelled their order`,
        entityType: 'Order',
        entityId: order.id,
        dedupeKey: `order:${order.id}:CANCELLED`,
      },
    });

    return next;
  });

  await emitRealtimeEvent(params.restaurantId, 'order.updated', { order: updated });
  return { order: updated, error: null };
}
