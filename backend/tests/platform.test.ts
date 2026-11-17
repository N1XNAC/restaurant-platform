import crypto from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

describe('Restaurant Platform End-to-End API Tests', () => {
  let app: FastifyInstance;
  let ownerToken = '';
  let waiterToken = '';
  let kitchenToken = '';
  let otherRestToken = '';
  let tableId = '';
  let menuItemId = '';
  let ingredientId = '';
  let createdOrderId = '';

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    await app.ready();

    const login = async (email: string) => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email, password: 'Password123!' },
      });
      return res.json().token as string;
    };

    ownerToken = await login('owner@bistro.local');
    waiterToken = await login('waiter@bistro.local');
    kitchenToken = await login('kitchen@bistro.local');

    // Create a second isolated restaurant for isolation tests
    const otherRest = await prisma.restaurant.upsert({
      where: { slug: 'other-bistro' },
      update: {},
      create: {
        id: 'rest-other-bistro',
        name: 'Other Bistro',
        slug: 'other-bistro',
        taxRateBps: 500,
      },
    });
    const hash = await bcrypt.hash('Password123!', 10);
    await prisma.staffUser.upsert({
      where: { email: 'owner@other.local' },
      update: {},
      create: {
        restaurantId: otherRest.id,
        email: 'owner@other.local',
        name: 'Other Owner',
        passwordHash: hash,
        role: 'OWNER',
      },
    });
    otherRestToken = await login('owner@other.local');

    const tablesRes = await app.inject({
      method: 'GET',
      url: '/api/v1/tables',
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    tableId = tablesRes.json().tables[0].id;

    const menuRes = await app.inject({
      method: 'GET',
      url: '/api/v1/menu',
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const margherita = menuRes
      .json()
      .items.find((i: { name: string }) => i.name === 'Margherita Classica');
    menuItemId = margherita.id;

    const ingRes = await app.inject({
      method: 'GET',
      url: '/api/v1/inventory/ingredients',
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const dough = ingRes
      .json()
      .ingredients.find((i: { name: string }) => i.name === 'Sourdough Dough Ball');
    ingredientId = dough.id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('rejects order with invalid tableId', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/public/restaurants/bistro-lumiere/orders',
      payload: {
        tableId: 'non-existent-table',
        items: [{ menuItemId, quantity: 1 }],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('creates order with server-calculated totals and prevents duplicates via Idempotency-Key', async () => {
    const idemKey = `test-idem-${crypto.randomUUID()}`;
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/v1/public/restaurants/bistro-lumiere/orders',
      headers: { 'idempotency-key': idemKey },
      payload: {
        tableId,
        items: [{ menuItemId, quantity: 2, specialInstructions: 'Extra crispy' }],
      },
    });
    expect(res1.statusCode).toBe(201);
    const order1 = res1.json().order;
    createdOrderId = order1.id;

    // Server-calculated totals: 2 * 1650 = 3300 subtotal, then tax + service
    // charge taken from the restaurant's live configuration (never hardcoded).
    const restaurant = await prisma.restaurant.findUniqueOrThrow({
      where: { slug: 'bistro-lumiere' },
    });
    const expectedTax = Math.round((3300 * restaurant.taxRateBps) / 10000);
    const expectedService = Math.round((3300 * restaurant.serviceChargeBps) / 10000);

    expect(order1.subtotalCents).toBe(3300);
    expect(order1.taxCents).toBe(expectedTax);
    expect(order1.serviceChargeCents).toBe(expectedService);
    expect(order1.totalCents).toBe(3300 + expectedTax + expectedService);
    expect(order1.status).toBe('NEW');

    // Retry with same Idempotency-Key
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/v1/public/restaurants/bistro-lumiere/orders',
      headers: { 'idempotency-key': idemKey },
      payload: {
        tableId,
        items: [{ menuItemId, quantity: 2 }],
      },
    });
    expect(res2.statusCode).toBe(200);
    expect(res2.json().deduplicated).toBe(true);
    expect(res2.json().order.id).toBe(order1.id);
  });

  it('blocks marking table AVAILABLE while active order remains', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/tables/${tableId}/status`,
      headers: { authorization: `Bearer ${waiterToken}` },
      payload: { status: 'AVAILABLE' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('enforces restaurant-level isolation across tenants', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/orders/${createdOrderId}`,
      headers: { authorization: `Bearer ${otherRestToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('validates order status transitions, RBAC, and deducts inventory exactly once on ACCEPTED', async () => {
    const beforeIng = await prisma.ingredient.findUniqueOrThrow({ where: { id: ingredientId } });

    // Invalid jump NEW -> COMPLETED
    const badJump = await app.inject({
      method: 'PATCH',
      url: `/api/v1/orders/${createdOrderId}/status`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { status: 'COMPLETED' },
    });
    expect(badJump.statusCode).toBe(409);

    // NEW -> ACCEPTED
    const acceptRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/orders/${createdOrderId}/status`,
      headers: { authorization: `Bearer ${waiterToken}` },
      payload: { status: 'ACCEPTED' },
    });
    expect(acceptRes.statusCode).toBe(200);
    expect(acceptRes.json().order.status).toBe('ACCEPTED');

    const afterIng = await prisma.ingredient.findUniqueOrThrow({ where: { id: ingredientId } });
    expect(afterIng.stockQty).toBe(beforeIng.stockQty - 2); // 2 pizzas * 1 dough ball

    // Waiter cannot move to PREPARING
    const waiterPrep = await app.inject({
      method: 'PATCH',
      url: `/api/v1/orders/${createdOrderId}/status`,
      headers: { authorization: `Bearer ${waiterToken}` },
      payload: { status: 'PREPARING' },
    });
    expect(waiterPrep.statusCode).toBe(403);

    // Kitchen moves ACCEPTED -> PREPARING -> READY
    const prepRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/orders/${createdOrderId}/status`,
      headers: { authorization: `Bearer ${kitchenToken}` },
      payload: { status: 'PREPARING' },
    });
    expect(prepRes.statusCode).toBe(200);

    const readyRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/orders/${createdOrderId}/status`,
      headers: { authorization: `Bearer ${kitchenToken}` },
      payload: { status: 'READY' },
    });
    expect(readyRes.statusCode).toBe(200);

    // Kitchen cannot mark SERVED
    const kitchenServe = await app.inject({
      method: 'PATCH',
      url: `/api/v1/orders/${createdOrderId}/status`,
      headers: { authorization: `Bearer ${kitchenToken}` },
      payload: { status: 'SERVED' },
    });
    expect(kitchenServe.statusCode).toBe(403);

    // Waiter marks SERVED -> COMPLETED
    const serveRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/orders/${createdOrderId}/status`,
      headers: { authorization: `Bearer ${waiterToken}` },
      payload: { status: 'SERVED' },
    });
    expect(serveRes.statusCode).toBe(200);

    const completeRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/orders/${createdOrderId}/status`,
      headers: { authorization: `Bearer ${waiterToken}` },
      payload: { status: 'COMPLETED' },
    });
    expect(completeRes.statusCode).toBe(200);
  });

  it('handles payments, partial refunds, and rejects over-refunding', async () => {
    const created = await prisma.order.findUniqueOrThrow({
      where: { id: createdOrderId },
    });

    const payRes = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${createdOrderId}/payments`,
      headers: { authorization: `Bearer ${waiterToken}` },
      payload: { amountCents: created.totalCents, method: 'CARD' },
    });
    expect(payRes.statusCode).toBe(201);
    expect(payRes.json().updatedOrder.paymentStatus).toBe('PAID');

    const partialRefund = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${createdOrderId}/refunds`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { amountCents: 500, reason: 'Late delivery discount' },
    });
    expect(partialRefund.statusCode).toBe(201);
    expect(partialRefund.json().updatedOrder.paymentStatus).toBe('PARTIALLY_REFUNDED');

    const overRefund = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${createdOrderId}/refunds`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { amountCents: 4000, reason: 'Too much' },
    });
    expect(overRefund.statusCode).toBe(400);
  });

  it('excludes cancelled orders from sales analytics', async () => {
    const readKpis = async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/analytics/summary?range=today',
        headers: { authorization: `Bearer ${ownerToken}` },
      });
      expect(res.statusCode).toBe(200);
      return res.json().kpis as {
        grossSalesCents: number;
        cancelledOrders: number;
        totalOrders: number;
      };
    };

    const before = await readKpis();

    // Create and cancel an order
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/public/restaurants/bistro-lumiere/orders',
      payload: {
        tableId,
        items: [{ menuItemId, quantity: 5 }],
      },
    });
    const cancelId = res.json().order.id;

    // While NEW the order is already counted as revenue
    const mid = await readKpis();
    expect(mid.grossSalesCents).toBe(before.grossSalesCents + 1650 * 5);

    await app.inject({
      method: 'PATCH',
      url: `/api/v1/orders/${cancelId}/status`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { status: 'CANCELLED', reason: 'Customer changed mind' },
    });

    const after = await readKpis();
    expect(after.cancelledOrders).toBe(before.cancelledOrders + 1);
    expect(after.totalOrders).toBe(before.totalOrders + 1);
    // Cancelled revenue must be removed from gross sales
    expect(after.grossSalesCents).toBe(before.grossSalesCents);
  });
});
