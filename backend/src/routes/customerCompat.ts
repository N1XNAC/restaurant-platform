import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ZodError } from 'zod';
import { prisma } from '../lib/prisma.js';
import { emitRealtimeEvent } from '../lib/realtime.js';
import {
  CANCELLATION_GRACE_MS,
  evaluateGeofence,
  fromCustomerStatus,
  signSessionBinding,
  toCustomerMenuItem,
  toCustomerOrder,
  toCustomerRestaurant,
  toCustomerSession,
  toCustomerStatus,
  verifySessionBinding,
  EXTRAS_GROUP_ID,
  VARIATIONS_GROUP_ID,
  type CustomerOrder,
  type CustomerOrderStatus,
  type CustomerSessionPayload,
  type CustomerLocationStatus,
  type SessionContext,
} from '../lib/customerAdapter.js';
import {
  cancelCustomerOrder,
  createCustomerOrder,
  type PreparedLine,
} from '../lib/orderService.js';

/**
 * Compatibility surface for the independently developed customer website
 * (`customer-site/`). It speaks the customer app's exact contract while reading
 * and writing the same tables the restaurant app uses, so both applications
 * stay in sync with one backend.
 *
 * Customer-facing responses use the customer vocabulary (dollars, RECEIVED /
 * PREPARING / READY / SERVED / CANCELLED). Internal records stay canonical
 * (cents, NEW / ACCEPTED / ...).
 */

const SESSION_TTL_MS = 4 * 60 * 60 * 1000;

class CustomerError extends Error {
  statusCode: number;
  code: string;
  requiresReverification: boolean;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    requiresReverification = false
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.requiresReverification = requiresReverification;
  }
}

const gpsSchema = z
  .object({
    lat: z.number().optional(),
    lng: z.number().optional(),
    accuracy: z.number().optional(),
  })
  .nullish();

const validateSessionSchema = z.object({
  token: z.string().min(1),
  gps: gpsSchema,
});

const verifyLocationSchema = z.object({
  sessionId: z.string().min(1),
  sessionSignature: z.string().min(1),
  gps: gpsSchema,
});

const verifyChallengeSchema = z.object({
  sessionId: z.string().min(1),
  sessionSignature: z.string().min(1),
  pin: z.string().min(1).max(12),
});

const selectedOptionSchema = z.object({
  groupId: z.string(),
  groupName: z.string().optional(),
  choiceId: z.string(),
  choiceLabel: z.string().optional(),
  priceDelta: z.number().optional(),
});

const createOrderSchema = z.object({
  restaurantId: z.string().min(1),
  tableId: z.string().min(1),
  sessionId: z.string().min(1),
  sessionSignature: z.string().min(1),
  idempotencyKey: z.string().min(1),
  orderMode: z.enum(['table_cart', 'only_this']).default('table_cart'),
  items: z
    .array(
      z.object({
        itemId: z.string().min(1),
        name: z.string().optional(),
        quantity: z.number(),
        unitPrice: z.number().optional(),
        selectedOptions: z.array(selectedOptionSchema).default([]),
        notes: z.string().max(500).optional(),
      })
    )
    .min(1),
});

const cancelOrderSchema = z.object({
  sessionId: z.string().min(1),
  sessionSignature: z.string().min(1),
  reason: z.string().max(400).optional(),
});

const integrationStatusSchema = z.object({
  status: z.string().min(1),
});

/** Demo alias used by the customer app defaults before a session is bound. */
const RESTAURANT_ID_ALIASES: Record<string, string> = {
  REST_001: 'bistro-lumiere',
};

async function resolveRestaurantByIdOrSlug(value: string) {
  const alias = RESTAURANT_ID_ALIASES[value] ?? value;
  const byId = await prisma.restaurant.findUnique({ where: { id: alias } });
  if (byId) return byId;
  return prisma.restaurant.findFirst({ where: { slug: alias } });
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

async function loadSessionContext(
  sessionId: string,
  sessionSignature: string
): Promise<SessionContext> {
  const session = await prisma.customerSession.findUnique({
    where: { id: sessionId },
  });
  if (!session) {
    throw new CustomerError(
      401,
      'MISSING_SESSION',
      'Your table session was not found. Please scan your table QR code or tap NFC again.',
      true
    );
  }

  if (session.sessionSignature !== sessionSignature || !verifySessionBinding(session)) {
    throw new CustomerError(
      403,
      'INVALID_SESSION_SIGNATURE',
      'Session integrity verification failed. Please re-scan your table QR code.',
      true
    );
  }

  if (session.expiresAt.getTime() <= Date.now()) {
    throw new CustomerError(
      401,
      'EXPIRED_SESSION',
      'Your 4-hour table session has expired. Please re-scan the table QR code.',
      true
    );
  }

  const [restaurant, table, token] = await Promise.all([
    prisma.restaurant.findUniqueOrThrow({ where: { id: session.restaurantId } }),
    prisma.restaurantTable.findUnique({ where: { id: session.tableId } }),
    prisma.tableToken.findFirst({
      where: {
        restaurantId: session.restaurantId,
        tableId: session.tableId,
        status: 'active',
      },
    }),
  ]);

  if (!table) {
    throw new CustomerError(
      404,
      'TABLE_NOT_FOUND',
      'The table bound to this session no longer exists.',
      true
    );
  }

  if (!token) {
    throw new CustomerError(
      401,
      'EXPIRED_TOKEN',
      'This table QR code has expired. Please ask a host for a fresh placard.',
      true
    );
  }

  return { session, restaurant, table, token };
}

function sessionPayload(
  ctx: SessionContext,
  extra: { distanceMeters?: number | null; locationStatus?: CustomerLocationStatus } = {}
): CustomerSessionPayload {
  return toCustomerSession(ctx, extra);
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

async function loadOrderForCustomer(orderId: string, restaurantId?: string) {
  return prisma.order.findFirst({
    where: { id: orderId, ...(restaurantId ? { restaurantId } : {}) },
    include: {
      table: { select: { id: true, tableNumber: true, label: true } },
      items: {
        include: { menuItem: { select: { imageUrl: true } } },
      },
    },
  });
}

async function serializeOrder(
  order: NonNullable<Awaited<ReturnType<typeof loadOrderForCustomer>>>
): Promise<CustomerOrder> {
  const restaurant = await prisma.restaurant.findUniqueOrThrow({
    where: { id: order.restaurantId },
  });
  const session = order.customerSessionId
    ? await prisma.customerSession.findUnique({
        where: { id: order.customerSessionId },
      })
    : null;

  return toCustomerOrder(order, {
    restaurantName: restaurant.name,
    locationStatus: (session?.locationStatus as CustomerLocationStatus) ?? 'unverified',
  });
}

function assertIntegrationKey(request: FastifyRequest) {
  const expected =
    process.env.INTEGRATION_API_KEY ?? process.env.RESTAURANT_MGMT_API_KEY;
  if (!expected) return; // Development default: no key configured, allow.
  const provided = request.headers['x-integration-key'];
  if (typeof provided !== 'string' || provided !== expected) {
    throw new CustomerError(
      401,
      'INVALID_INTEGRATION_KEY',
      'A valid X-Integration-Key header is required for restaurant management integration.'
    );
  }
}

export async function customerCompatRoutes(app: FastifyInstance): Promise<void> {
  // Customer-contract error envelope. Scoped to this plugin only.
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof CustomerError) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          requiresReverification: error.requiresReverification,
        },
      });
    }
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request payload',
          requiresReverification: false,
        },
      });
    }
    const fastifyError = error as { statusCode?: number; code?: string; message?: string };
    if (fastifyError.statusCode && fastifyError.statusCode < 500) {
      return reply.status(fastifyError.statusCode).send({
        error: {
          code: fastifyError.code ?? 'REQUEST_FAILED',
          message: fastifyError.message ?? 'Request failed',
          requiresReverification: false,
        },
      });
    }
    app.log.error(error);
    return reply.status(500).send({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred',
        requiresReverification: false,
      },
    });
  });

  app.get('/api/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));

  // Directory of demo QR/NFC placards (no PINs exposed).
  app.get('/api/session/demo-tokens', async () => {
    const tokens = await prisma.tableToken.findMany({
      include: { table: true },
      orderBy: { token: 'asc' },
    });
    return {
      presets: tokens.map((token) => ({
        token: token.token,
        // Display code shown in the customer app's demo directory.
        tableId: token.table.tableNumber,
        tableNumber: token.table.tableNumber,
        tableLabel: token.table.label ?? `Table ${token.table.tableNumber}`,
        entryMethod: token.entryMethod,
        seats: token.table.capacity,
        status: token.status,
      })),
    };
  });

  app.post(
    '/api/session/validate',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const body = validateSessionSchema.parse(request.body);
      const token = await prisma.tableToken.findUnique({
        where: { token: body.token.trim() },
        include: { table: true, restaurant: true },
      });

      if (!token) {
        throw new CustomerError(
          401,
          'INVALID_TOKEN',
          'This QR code or NFC tag could not be verified. Please scan the plaque at your table.',
          true
        );
      }

      if (token.status !== 'active') {
        throw new CustomerError(
          401,
          'EXPIRED_TOKEN',
          'This table QR code has expired. Please scan a fresh table placard or ask a host.',
          true
        );
      }

      if (!token.table.isActive) {
        throw new CustomerError(
          409,
          'TABLE_INACTIVE',
          'This table is not currently accepting digital orders.'
        );
      }

      const sessionId = `SESSION_${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
      const sessionSignature = signSessionBinding(
        sessionId,
        token.restaurantId,
        token.tableId
      );
      const geo = evaluateGeofence(token.restaurant, body.gps ?? null);
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

      const session = await prisma.customerSession.create({
        data: {
          id: sessionId,
          restaurantId: token.restaurantId,
          tableId: token.tableId,
          sessionSignature,
          entryMethod: token.entryMethod,
          locationStatus: geo.status,
          challengeVerified: !geo.requiresAdditionalVerification,
          expiresAt,
        },
      });

      const payload = sessionPayload(
        { session, restaurant: token.restaurant, table: token.table, token },
        { distanceMeters: geo.distanceMeters, locationStatus: geo.status }
      );

      return reply.status(200).send({ session: payload });
    }
  );

  app.post(
    '/api/session/verify-location',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request) => {
      const body = verifyLocationSchema.parse(request.body);
      const ctx = await loadSessionContext(body.sessionId, body.sessionSignature);
      const geo = evaluateGeofence(ctx.restaurant, body.gps ?? null);

      const locationStatus =
        geo.status === 'verified' ? 'verified' : geo.status === 'unavailable'
          ? 'unavailable'
          : 'flagged_outside_geofence';

      const session = await prisma.customerSession.update({
        where: { id: ctx.session.id },
        data: {
          locationStatus,
          challengeVerified:
            geo.status === 'verified' ? true : ctx.session.challengeVerified,
        },
      });

      return {
        session: sessionPayload(
          { ...ctx, session },
          { distanceMeters: geo.distanceMeters, locationStatus }
        ),
      };
    }
  );

  app.post(
    '/api/session/verify-challenge',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request) => {
      const body = verifyChallengeSchema.parse(request.body);
      const ctx = await loadSessionContext(body.sessionId, body.sessionSignature);

      if (body.pin.trim() !== ctx.token.placardPin) {
        throw new CustomerError(
          403,
          'CHALLENGE_FAILED',
          'That table placard code does not match. Check the 4-digit code printed under your table QR.',
          true
        );
      }

      const session = await prisma.customerSession.update({
        where: { id: ctx.session.id },
        data: { challengeVerified: true },
      });

      return { session: sessionPayload({ ...ctx, session }) };
    }
  );

  // -------------------------------------------------------------------------
  // Menu
  // -------------------------------------------------------------------------

  app.get('/api/restaurant/:restaurantId/menu', async (request) => {
    const { restaurantId } = request.params as { restaurantId: string };
    const query = request.query as {
      search?: string;
      category?: string;
      dietary?: string;
    };

    const restaurant = await resolveRestaurantByIdOrSlug(restaurantId);
    if (!restaurant) {
      throw new CustomerError(404, 'RESTAURANT_NOT_FOUND', 'Restaurant not found.');
    }

    const items = await prisma.menuItem.findMany({
      where: {
        restaurantId: restaurant.id,
        isArchived: false,
        isAvailable: true,
      },
      include: {
        category: { select: { name: true } },
        variations: { where: { isAvailable: true } },
        extras: { where: { isAvailable: true } },
      },
      orderBy: [{ category: { sortOrder: 'asc' } }, { name: 'asc' }],
    });

    const mapped = items.map(toCustomerMenuItem);

    const search = (query.search ?? '').trim().toLowerCase();
    const category = (query.category ?? '').trim();
    const dietary = (query.dietary ?? '').trim();

    const filtered = mapped.filter((item) => {
      if (category && category !== 'All' && item.category !== category) return false;
      if (dietary && dietary !== 'all' && item.dietary !== dietary) return false;
      if (
        search &&
        !item.name.toLowerCase().includes(search) &&
        !item.description.toLowerCase().includes(search) &&
        !item.category.toLowerCase().includes(search)
      ) {
        return false;
      }
      return true;
    });

    const categories = Array.from(new Set(mapped.map((item) => item.category)));

    return {
      restaurant: toCustomerRestaurant(restaurant),
      categories,
      items: filtered,
    };
  });

  app.get('/api/menu/items/:itemId', async (request) => {
    const { itemId } = request.params as { itemId: string };
    const item = await prisma.menuItem.findUnique({
      where: { id: itemId },
      include: {
        category: { select: { name: true } },
        variations: { where: { isAvailable: true } },
        extras: { where: { isAvailable: true } },
      },
    });
    if (!item) {
      throw new CustomerError(404, 'MENU_ITEM_NOT_FOUND', 'Menu item not found.');
    }
    return { item: toCustomerMenuItem(item) };
  });

  // -------------------------------------------------------------------------
  // Orders (customer)
  // -------------------------------------------------------------------------

  app.post(
    '/api/orders',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const body = createOrderSchema.parse(request.body);
      const ctx = await loadSessionContext(body.sessionId, body.sessionSignature);

      if (
        body.restaurantId !== ctx.restaurant.id &&
        body.restaurantId !== 'REST_001'
      ) {
        throw new CustomerError(
          403,
          'TABLE_MISMATCH',
          'Table identification mismatch detected. Your session must be re-verified.',
          true
        );
      }
      if (body.tableId !== ctx.table.id) {
        throw new CustomerError(
          403,
          'TABLE_MISMATCH',
          'Table identification mismatch detected. Your session must be re-verified.',
          true
        );
      }

      const requiresChallenge =
        ctx.session.locationStatus === 'flagged_outside_geofence' &&
        !ctx.session.challengeVerified;
      if (requiresChallenge) {
        throw new CustomerError(
          403,
          'LOCATION_VERIFICATION_REQUIRED',
          'Please enter the 4-digit table placard code to verify you are seated at the restaurant.',
          true
        );
      }

      const idempotencyKey = body.idempotencyKey.trim();
      if (!idempotencyKey) {
        throw new CustomerError(
          400,
          'MISSING_IDEMPOTENCY_KEY',
          'Missing submission request key. Please try confirming your order again.'
        );
      }

      if (body.orderMode === 'only_this' && body.items.length > 1) {
        throw new CustomerError(
          400,
          'INVALID_EXPRESS_ORDER',
          'Single-item express order can contain only one dish selection.'
        );
      }

      const menuItems = await prisma.menuItem.findMany({
        where: {
          id: { in: [...new Set(body.items.map((i) => i.itemId))] },
          restaurantId: ctx.restaurant.id,
          isArchived: false,
        },
        include: {
          variations: { where: { isAvailable: true } },
          extras: { where: { isAvailable: true } },
        },
      });
      const byId = new Map(menuItems.map((item) => [item.id, item]));

      const lines: PreparedLine[] = [];

      for (const requested of body.items) {
        const quantity = Math.floor(Number(requested.quantity));
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 25) {
          throw new CustomerError(
            400,
            'INVALID_QUANTITY',
            'Each dish quantity must be between 1 and 25.'
          );
        }

        const item = byId.get(requested.itemId);
        if (!item) {
          throw new CustomerError(
            400,
            'UNKNOWN_MENU_ITEM',
            `Menu item "${requested.itemId}" does not exist on this restaurant's menu.`
          );
        }
        if (!item.isAvailable) {
          throw new CustomerError(
            409,
            'ITEM_UNAVAILABLE',
            `"${item.name}" is sold out for tonight's service. Please remove it from your table order.`
          );
        }

        // Only the group/choice ids are trusted; every price is re-derived from
        // the database.
        let variation: (typeof item.variations)[number] | undefined;
        const extras: Array<{ id: string; name: string; priceCents: number }> = [];

        for (const option of requested.selectedOptions) {
          if (option.groupId === VARIATIONS_GROUP_ID) {
            const found = item.variations.find((v) => v.id === option.choiceId);
            if (found) variation = found;
          } else if (option.groupId === EXTRAS_GROUP_ID) {
            const found = item.extras.find((e) => e.id === option.choiceId);
            if (found && !extras.some((e) => e.id === found.id)) {
              extras.push({
                id: found.id,
                name: found.name,
                priceCents: found.priceCents,
              });
            }
          }
        }

        const unitPriceCents = item.priceCents + (variation?.priceDeltaCents ?? 0);
        const extrasTotalCents = extras.reduce((sum, e) => sum + e.priceCents, 0);
        const lineTotalCents = (unitPriceCents + extrasTotalCents) * quantity;

        lines.push({
          menuItemId: item.id,
          itemNameSnapshot: item.name,
          unitPriceCents,
          quantity,
          variationsSnapshotJson: JSON.stringify(
            variation
              ? [
                  {
                    id: variation.id,
                    name: variation.name,
                    priceDeltaCents: variation.priceDeltaCents,
                  },
                ]
              : []
          ),
          extrasSnapshotJson: JSON.stringify(extras),
          extrasTotalCents,
          lineTotalCents,
          specialInstructions: requested.notes
            ? String(requested.notes).trim().slice(0, 250)
            : null,
          prepTimeMinutes: item.prepTimeMinutes,
        });
      }

      const result = await createCustomerOrder({
        restaurant: ctx.restaurant,
        tableId: ctx.table.id,
        tableNumber: ctx.table.tableNumber,
        lines,
        notes: null,
        idempotencyKey,
        orderMode: body.orderMode,
        customerSessionId: ctx.session.id,
      });

      const order = await loadOrderForCustomer(result.order.id);
      if (!order) {
        throw new CustomerError(500, 'ORDER_NOT_FOUND', 'Order could not be loaded.');
      }

      return reply.status(result.deduplicated ? 200 : 201).send({
        order: await serializeOrder(order),
        message: result.deduplicated
          ? 'Your order was already received.'
          : 'Your order has been successfully placed!',
      });
    }
  );

  app.get('/api/orders/:orderId', async (request) => {
    const { orderId } = request.params as { orderId: string };
    const order = await loadOrderForCustomer(orderId);
    if (!order) {
      throw new CustomerError(404, 'ORDER_NOT_FOUND', 'Order record could not be found.');
    }
    return { order: await serializeOrder(order) };
  });

  app.post(
    '/api/orders/:orderId/cancel',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request) => {
      const { orderId } = request.params as { orderId: string };
      const body = cancelOrderSchema.parse(request.body);
      const ctx = await loadSessionContext(body.sessionId, body.sessionSignature);

      const order = await prisma.order.findFirst({
        where: { id: orderId, restaurantId: ctx.restaurant.id },
      });
      if (!order) {
        throw new CustomerError(404, 'ORDER_NOT_FOUND', 'Order record could not be found.');
      }

      if (order.customerSessionId !== ctx.session.id) {
        throw new CustomerError(
          403,
          'ORDER_OWNERSHIP_MISMATCH',
          'Only the table session that placed this order may request cancellation.'
        );
      }

      if (order.status === 'CANCELLED') {
        const existing = await loadOrderForCustomer(orderId);
        return { order: await serializeOrder(existing!) };
      }

      if (['READY', 'SERVED', 'COMPLETED', 'REJECTED'].includes(order.status)) {
        throw new CustomerError(
          409,
          'ORDER_ALREADY_PREPARED',
          'Your dishes are already plated or served and can no longer be cancelled digitally.'
        );
      }

      if (Date.now() > order.createdAt.getTime() + CANCELLATION_GRACE_MS) {
        throw new CustomerError(
          409,
          'CANCELLATION_WINDOW_CLOSED',
          'The kitchen fire window has passed. Please speak directly with your server for assistance.'
        );
      }

      const cancelled = await cancelCustomerOrder({
        restaurantId: ctx.restaurant.id,
        orderId,
        reason: body.reason,
        graceMinutes: CANCELLATION_GRACE_MS / 60000,
      });

      if (!cancelled.order) {
        if (cancelled.error === 'GRACE_EXPIRED') {
          throw new CustomerError(
            409,
            'CANCELLATION_WINDOW_CLOSED',
            'The kitchen fire window has passed. Please speak directly with your server for assistance.'
          );
        }
        throw new CustomerError(
          409,
          'ORDER_ALREADY_PREPARED',
          'Your dishes are already being prepared and can no longer be cancelled digitally.'
        );
      }

      const updated = await loadOrderForCustomer(orderId);
      return { order: await serializeOrder(updated!) };
    }
  );

  // -------------------------------------------------------------------------
  // Restaurant management integration (pull + status push)
  // -------------------------------------------------------------------------

  app.get('/api/integration/orders', async (request) => {
    assertIntegrationKey(request);
    const query = request.query as { restaurantId?: string; limit?: string };
    const restaurant = query.restaurantId
      ? await resolveRestaurantByIdOrSlug(query.restaurantId)
      : await prisma.restaurant.findFirst({ where: { slug: 'bistro-lumiere' } });

    if (!restaurant) {
      throw new CustomerError(404, 'RESTAURANT_NOT_FOUND', 'Restaurant not found.');
    }

    const limit = Math.min(Math.max(Number(query.limit ?? 100) || 100, 1), 500);
    const orders = await prisma.order.findMany({
      where: { restaurantId: restaurant.id },
      include: {
        table: { select: { id: true, tableNumber: true, label: true } },
        items: { include: { menuItem: { select: { imageUrl: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return {
      orders: await Promise.all(orders.map((order) => serializeOrder(order))),
    };
  });

  app.patch('/api/integration/orders/:orderId/status', async (request) => {
    assertIntegrationKey(request);
    const { orderId } = request.params as { orderId: string };
    const body = integrationStatusSchema.parse(request.body);

    const target = fromCustomerStatus(body.status);
    const allowed = [
      'NEW',
      'ACCEPTED',
      'PREPARING',
      'READY',
      'SERVED',
      'COMPLETED',
      'CANCELLED',
      'REJECTED',
    ];
    if (!allowed.includes(target)) {
      throw new CustomerError(
        400,
        'INVALID_STATUS',
        `"${body.status}" is not a supported order status.`
      );
    }

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      throw new CustomerError(404, 'ORDER_NOT_FOUND', 'Order not found.');
    }
    if (order.status === target) {
      const unchanged = await loadOrderForCustomer(orderId);
      return { order: await serializeOrder(unchanged!) };
    }

    const updated = await prisma.order.update({
      where: { id: orderId },
      data: {
        status: target,
        ...(target === 'ACCEPTED' ? { acceptedAt: new Date() } : {}),
        ...(target === 'PREPARING' ? { preparingAt: new Date() } : {}),
        ...(target === 'READY' ? { readyAt: new Date() } : {}),
        ...(target === 'SERVED' ? { servedAt: new Date() } : {}),
        ...(target === 'COMPLETED' ? { completedAt: new Date() } : {}),
        ...(target === 'CANCELLED' ? { cancelledAt: new Date() } : {}),
        statusHistory: {
          create: {
            fromStatus: order.status,
            toStatus: target,
            reason: 'Status pushed from restaurant management system',
          },
        },
      },
      include: {
        table: { select: { id: true, tableNumber: true, label: true } },
        items: { include: { menuItem: { select: { imageUrl: true } } } },
      },
    });

    await emitRealtimeEvent(order.restaurantId, 'order.updated', { order: updated });

    return { order: await serializeOrder(updated) };
  });

  // Lightweight helper used by the restaurant app to preview what the customer
  // website will see for a given order (same serializer, same vocabulary).
  app.get('/api/compat/orders/:orderId', async (request) => {
    assertIntegrationKey(request);
    const { orderId } = request.params as { orderId: string };
    const order = await loadOrderForCustomer(orderId);
    if (!order) {
      throw new CustomerError(404, 'ORDER_NOT_FOUND', 'Order record could not be found.');
    }
    return { order: await serializeOrder(order), status: toCustomerStatus(order.status) as CustomerOrderStatus };
  });
}
