import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

/**
 * Contract tests for the customer-facing compatibility surface. The bundled
 * customer website (`customer-site/`) talks to exactly these endpoints, and the
 * restaurant app reads the same rows, so these tests double as an integration
 * test between the two applications.
 */
describe('Customer website compatibility API', () => {
  let app: FastifyInstance;
  let session: {
    sessionId: string;
    sessionSignature: string;
    restaurantId: string;
    tableId: string;
    tableNumber: string;
  };
  let menuItemId = '';
  let extraChoiceId = '';
  let variationChoiceId = '';

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('exposes the placard directory without PINs', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/session/demo-tokens' });
    expect(res.statusCode).toBe(200);
    const presets = res.json().presets as Array<Record<string, unknown>>;
    expect(presets.length).toBeGreaterThanOrEqual(4);
    expect(presets.some((p) => p.token === 'QR_MV_T08_VALID')).toBe(true);
    expect(JSON.stringify(presets)).not.toContain('placardPin');
  });

  it('validates a QR token and binds an HMAC-signed table session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/session/validate',
      payload: {
        token: 'QR_MV_T08_VALID',
        gps: { lat: 37.7749, lng: -122.4194, accuracy: 15 },
      },
    });
    expect(res.statusCode).toBe(200);
    session = res.json().session;
    expect(session.restaurantId).toBe('rest-bistro-lumiere');
    expect(session.tableNumber).toBe('T-08');
    expect(session.locationStatus).toBe('verified');
    expect(session.sessionSignature).toMatch(/^[a-f0-9]{64}$/);
    expect(res.json().session.restaurant.taxRate).toBeGreaterThan(0);
  });

  it('rejects an unknown or expired placard', async () => {
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/session/validate',
      payload: { token: 'QR_MV_DOES_NOT_EXIST' },
    });
    expect(unknown.statusCode).toBe(401);
    expect(unknown.json().error.code).toBe('INVALID_TOKEN');

    const expired = await app.inject({
      method: 'POST',
      url: '/api/session/validate',
      payload: { token: 'QR_MV_EXPIRED' },
    });
    expect(expired.statusCode).toBe(401);
    expect(expired.json().error.code).toBe('EXPIRED_TOKEN');
  });

  it('serves the restaurant menu in the customer vocabulary (dollars, fixed categories)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/restaurant/${session.restaurantId}/menu`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.restaurant.restaurantId).toBe('rest-bistro-lumiere');
    expect(body.items.length).toBeGreaterThan(5);
    expect(body.categories).toContain('Wood-Fired');
    expect(body.categories).not.toContain('Wood-Fired Pizza');

    const burger = body.items.find(
      (i: { name: string }) => i.name === 'Classic Brioche Burger'
    );
    expect(burger.price).toBe(24);
    expect(burger.dietary).toBe('non-veg');
    const extras = burger.customizations.find(
      (g: { id: string }) => g.id === 'extras'
    );
    // The first choice must be free so the customer app's default selection
    // does not silently add a paid extra.
    expect(extras.choices[0].priceDelta).toBe(0);

    menuItemId = burger.id;
    extraChoiceId = extras.choices.find(
      (c: { priceDelta: number }) => c.priceDelta > 0
    ).id;
    variationChoiceId = burger.customizations.find(
      (g: { id: string }) => g.id === 'variations'
    ).choices[0].id;
  });

  it('creates an order with server-side pricing and exposes it to the customer', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: {
        restaurantId: session.restaurantId,
        tableId: session.tableId,
        sessionId: session.sessionId,
        sessionSignature: session.sessionSignature,
        idempotencyKey: `compat-${Date.now()}`,
        orderMode: 'table_cart',
        items: [
          {
            itemId: menuItemId,
            quantity: 2,
            // A tampered price must be ignored by the server.
            unitPrice: 0.01,
            selectedOptions: [
              { groupId: 'variations', choiceId: variationChoiceId },
              { groupId: 'extras', choiceId: extraChoiceId },
            ],
            notes: 'No onions',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    const order = res.json().order;
    const restaurant = await prisma.restaurant.findUniqueOrThrow({
      where: { id: session.restaurantId },
    });
    const extra = await prisma.menuItemExtra.findUniqueOrThrow({
      where: { id: extraChoiceId },
    });
    // 24.00 burger x2 plus the chosen paid extra x2, ignoring the client price.
    const subtotalCents = 2400 * 2 + extra.priceCents * 2;
    const subtotal = subtotalCents / 100;

    expect(order.subtotal).toBe(subtotal);
    expect(order.status).toBe('RECEIVED');
    expect(order.sessionId).toBe(session.sessionId);
    expect(order.grandTotal).toBeGreaterThan(order.subtotal);
    expect(order.taxAmount).toBeCloseTo(
      Math.round((subtotalCents * restaurant.taxRateBps) / 10000) / 100,
      2
    );
    expect(order.serviceCharge).toBeCloseTo(
      Math.round((subtotalCents * restaurant.serviceChargeBps) / 10000) / 100,
      2
    );
    expect(order.grandTotal).toBeCloseTo(
      subtotal + order.taxAmount + order.serviceCharge,
      2
    );

    const fetched = await app.inject({
      method: 'GET',
      url: `/api/orders/${order.orderId}`,
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().order.orderId).toBe(order.orderId);
  });

  it('is idempotent on the client submission key', async () => {
    const key = `compat-idem-${Date.now()}`;
    const payload = {
      restaurantId: session.restaurantId,
      tableId: session.tableId,
      sessionId: session.sessionId,
      sessionSignature: session.sessionSignature,
      idempotencyKey: key,
      orderMode: 'table_cart',
      items: [{ itemId: menuItemId, quantity: 1, selectedOptions: [] }],
    };

    const first = await app.inject({ method: 'POST', url: '/api/orders', payload });
    const second = await app.inject({ method: 'POST', url: '/api/orders', payload });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().order.orderId).toBe(first.json().order.orderId);
  });

  it('rejects table spoofing and forged session signatures', async () => {
    const spoof = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: {
        restaurantId: session.restaurantId,
        tableId: 'cm-not-a-real-table',
        sessionId: session.sessionId,
        sessionSignature: session.sessionSignature,
        idempotencyKey: `compat-spoof-${Date.now()}`,
        items: [{ itemId: menuItemId, quantity: 1 }],
      },
    });
    expect(spoof.statusCode).toBe(403);
    expect(spoof.json().error.code).toBe('TABLE_MISMATCH');

    const forged = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: {
        restaurantId: session.restaurantId,
        tableId: session.tableId,
        sessionId: session.sessionId,
        sessionSignature: 'f'.repeat(64),
        idempotencyKey: `compat-forged-${Date.now()}`,
        items: [{ itemId: menuItemId, quantity: 1 }],
      },
    });
    expect(forged.statusCode).toBe(403);
    expect(forged.json().error.code).toBe('INVALID_SESSION_SIGNATURE');
  });

  it('requires the placard PIN when the guest is outside the geofence', async () => {
    const far = await app.inject({
      method: 'POST',
      url: '/api/session/validate',
      payload: {
        token: 'NFC_MV_T04_VALID',
        gps: { lat: 40.0, lng: -100.0, accuracy: 20 },
      },
    });
    expect(far.statusCode).toBe(200);
    const farSession = far.json().session;
    expect(farSession.locationStatus).toBe('flagged_outside_geofence');

    const blocked = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: {
        restaurantId: farSession.restaurantId,
        tableId: farSession.tableId,
        sessionId: farSession.sessionId,
        sessionSignature: farSession.sessionSignature,
        idempotencyKey: `compat-far-${Date.now()}`,
        items: [{ itemId: menuItemId, quantity: 1 }],
      },
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('LOCATION_VERIFICATION_REQUIRED');
    expect(blocked.json().error.requiresReverification).toBe(true);

    const wrongPin = await app.inject({
      method: 'POST',
      url: '/api/session/verify-challenge',
      payload: {
        sessionId: farSession.sessionId,
        sessionSignature: farSession.sessionSignature,
        pin: '0000',
      },
    });
    expect(wrongPin.statusCode).toBe(403);
    expect(wrongPin.json().error.code).toBe('CHALLENGE_FAILED');

    const rightPin = await app.inject({
      method: 'POST',
      url: '/api/session/verify-challenge',
      payload: {
        sessionId: farSession.sessionId,
        sessionSignature: farSession.sessionSignature,
        pin: '4041',
      },
    });
    expect(rightPin.statusCode).toBe(200);
    expect(rightPin.json().session.challengeVerified).toBe(true);
  });

  it('cancels inside the grace window and refuses once the kitchen started', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: {
        restaurantId: session.restaurantId,
        tableId: session.tableId,
        sessionId: session.sessionId,
        sessionSignature: session.sessionSignature,
        idempotencyKey: `compat-cancel-${Date.now()}`,
        items: [{ itemId: menuItemId, quantity: 1 }],
      },
    });
    expect(created.statusCode).toBe(201);
    const orderId = created.json().order.orderId;

    // A different session must not cancel it.
    const otherSession = await prisma.customerSession.create({
      data: {
        id: `SESSION_OTHER_${Date.now()}`,
        restaurantId: session.restaurantId,
        tableId: session.tableId,
        sessionSignature: 'other',
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const foreign = await app.inject({
      method: 'POST',
      url: `/api/orders/${orderId}/cancel`,
      payload: {
        sessionId: otherSession.id,
        sessionSignature: otherSession.sessionSignature,
      },
    });
    expect(foreign.statusCode).toBe(403);

    const cancelled = await app.inject({
      method: 'POST',
      url: `/api/orders/${orderId}/cancel`,
      payload: {
        sessionId: session.sessionId,
        sessionSignature: session.sessionSignature,
        reason: 'Guest changed their mind',
      },
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().order.status).toBe('CANCELLED');
    expect(cancelled.json().order.cancellationReason).toContain('Guest');

    // A prepared order cannot be cancelled.
    const second = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: {
        restaurantId: session.restaurantId,
        tableId: session.tableId,
        sessionId: session.sessionId,
        sessionSignature: session.sessionSignature,
        idempotencyKey: `compat-prep-${Date.now()}`,
        items: [{ itemId: menuItemId, quantity: 1 }],
      },
    });
    const secondId = second.json().order.orderId;
    await prisma.order.update({ where: { id: secondId }, data: { status: 'PREPARING' } });

    const late = await app.inject({
      method: 'POST',
      url: `/api/orders/${secondId}/cancel`,
      payload: {
        sessionId: session.sessionId,
        sessionSignature: session.sessionSignature,
      },
    });
    expect(late.statusCode).toBe(409);
    expect(late.json().error.code).toBe('ORDER_ALREADY_PREPARED');
  });

  it('maps restaurant status changes onto the customer vocabulary and back', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: {
        restaurantId: session.restaurantId,
        tableId: session.tableId,
        sessionId: session.sessionId,
        sessionSignature: session.sessionSignature,
        idempotencyKey: `compat-status-${Date.now()}`,
        items: [{ itemId: menuItemId, quantity: 1 }],
      },
    });
    const orderId = created.json().order.orderId;

    const push = await app.inject({
      method: 'PATCH',
      url: `/api/integration/orders/${orderId}/status`,
      payload: { status: 'READY' },
    });
    expect(push.statusCode).toBe(200);
    expect(push.json().order.status).toBe('READY');

    const internal = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(internal.status).toBe('READY');

    const list = await app.inject({
      method: 'GET',
      url: `/api/integration/orders?restaurantId=${session.restaurantId}&limit=200`,
    });
    expect(list.statusCode).toBe(200);
    const found = list.json().orders.find(
      (o: { orderId: string }) => o.orderId === orderId
    );
    expect(found.status).toBe('READY');
    expect(found.restaurantId).toBe(session.restaurantId);
  });

  it('serves the customer website and its assets from the backend origin', async () => {
    const index = await app.inject({ method: 'GET', url: '/' });
    expect(index.statusCode).toBe(200);
    expect(index.headers['content-type']).toContain('text/html');
    expect(index.body).toContain('Maison Verbena');

    const menuPage = await app.inject({ method: 'GET', url: '/menu.html' });
    expect(menuPage.statusCode).toBe(200);

    const script = await app.inject({ method: 'GET', url: '/js/api.js' });
    expect(script.statusCode).toBe(200);

    const css = await app.inject({ method: 'GET', url: '/css/global.css' });
    expect(css.statusCode).toBe(200);
  });
});
