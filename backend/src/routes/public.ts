import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { BadRequestError, NotFoundError } from '../lib/errors.js';
import { emitRealtimeEvent } from '../lib/realtime.js';
import { createCustomerOrder, type PreparedLine } from '../lib/orderService.js';

const createPublicOrderSchema = z.object({
  tableId: z.string().min(1),
  notes: z.string().max(500).optional(),
  idempotencyKey: z.string().min(4).max(128).optional(),
  items: z
    .array(
      z.object({
        menuItemId: z.string().min(1),
        quantity: z.number().int().min(1).max(50),
        variationId: z.string().optional(),
        extraIds: z.array(z.string()).default([]),
        specialInstructions: z.string().max(250).optional(),
      })
    )
    .min(1),
});

const createPublicReviewSchema = z.object({
  orderId: z.string().optional(),
  customerName: z.string().min(1).max(80).default('Guest'),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional(),
});

async function resolveRestaurant(slugOrId: string) {
  const restaurant = await prisma.restaurant.findFirst({
    where: { OR: [{ slug: slugOrId }, { id: slugOrId }] },
  });
  if (!restaurant) throw new NotFoundError('Restaurant not found');
  return restaurant;
}

export async function publicRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/public/restaurants/:slug/menu', async (request) => {
    const { slug } = request.params as { slug: string };
    const restaurant = await resolveRestaurant(slug);

    const [categories, items] = await Promise.all([
      prisma.menuCategory.findMany({
        where: { restaurantId: restaurant.id, isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      prisma.menuItem.findMany({
        where: { restaurantId: restaurant.id, isArchived: false, isAvailable: true },
        orderBy: { name: 'asc' },
        include: {
          variations: { where: { isAvailable: true } },
          extras: { where: { isAvailable: true } },
        },
      }),
    ]);

    return {
      restaurant: {
        id: restaurant.id,
        name: restaurant.name,
        slug: restaurant.slug,
        currency: restaurant.currency,
        taxRateBps: restaurant.taxRateBps,
      },
      categories,
      items: items.map((i) => ({
        ...i,
        allergens: JSON.parse(i.allergensJson) as string[],
      })),
    };
  });

  app.get('/api/v1/public/restaurants/:slug/tables/:tableNumber', async (request) => {
    const { slug, tableNumber } = request.params as { slug: string; tableNumber: string };
    const restaurant = await resolveRestaurant(slug);

    const table = await prisma.restaurantTable.findFirst({
      where: {
        restaurantId: restaurant.id,
        OR: [{ id: tableNumber }, { tableNumber }],
        isActive: true,
      },
      select: {
        id: true,
        tableNumber: true,
        label: true,
        capacity: true,
        status: true,
      },
    });
    if (!table) throw new NotFoundError('Active table not found for this restaurant');
    return { table, restaurantId: restaurant.id };
  });

  app.post(
    '/api/v1/public/restaurants/:slug/orders',
    {
      config: {
        rateLimit: {
          max: 60,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const restaurant = await resolveRestaurant(slug);
      const body = createPublicOrderSchema.parse(request.body);

      const headerKey = request.headers['idempotency-key'];
      const idempotencyKey =
        (typeof headerKey === 'string' && headerKey.trim()) || body.idempotencyKey || null;

      if (idempotencyKey) {
        const existing = await prisma.order.findUnique({
          where: {
            restaurantId_idempotencyKey: {
              restaurantId: restaurant.id,
              idempotencyKey,
            },
          },
          include: {
            table: { select: { id: true, tableNumber: true, label: true } },
            items: true,
          },
        });
        if (existing) {
          return reply.status(200).send({ order: existing, deduplicated: true });
        }
      }

      const table = await prisma.restaurantTable.findFirst({
        where: { id: body.tableId, restaurantId: restaurant.id, isActive: true },
      });
      if (!table) {
        throw new BadRequestError('Invalid or inactive tableId for this restaurant');
      }

      // Fetch all referenced menu items in one query
      const menuItemIds = [...new Set(body.items.map((i) => i.menuItemId))];
      const dbItems = await prisma.menuItem.findMany({
        where: {
          id: { in: menuItemIds },
          restaurantId: restaurant.id,
          isArchived: false,
          isAvailable: true,
        },
        include: {
          variations: { where: { isAvailable: true } },
          extras: { where: { isAvailable: true } },
        },
      });
      const itemMap = new Map(dbItems.map((i) => [i.id, i]));

      const preparedItems: PreparedLine[] = [];

      for (const reqItem of body.items) {
        const dbItem = itemMap.get(reqItem.menuItemId);
        if (!dbItem) {
          throw new BadRequestError(`Menu item ${reqItem.menuItemId} is unavailable or invalid`);
        }

        let unitPriceCents = dbItem.priceCents;
        const selectedVariations: Array<{ id: string; name: string; priceDeltaCents: number }> = [];
        if (reqItem.variationId) {
          const variation = dbItem.variations.find((v) => v.id === reqItem.variationId);
          if (!variation) {
            throw new BadRequestError(`Invalid variation ${reqItem.variationId} for ${dbItem.name}`);
          }
          unitPriceCents += variation.priceDeltaCents;
          selectedVariations.push({
            id: variation.id,
            name: variation.name,
            priceDeltaCents: variation.priceDeltaCents,
          });
        }

        const selectedExtras: Array<{ id: string; name: string; priceCents: number }> = [];
        let extrasTotalCents = 0;
        for (const extraId of reqItem.extraIds) {
          const extra = dbItem.extras.find((e) => e.id === extraId);
          if (!extra) {
            throw new BadRequestError(`Invalid extra ${extraId} for ${dbItem.name}`);
          }
          extrasTotalCents += extra.priceCents;
          selectedExtras.push({ id: extra.id, name: extra.name, priceCents: extra.priceCents });
        }

        preparedItems.push({
          menuItemId: dbItem.id,
          itemNameSnapshot: dbItem.name,
          unitPriceCents,
          quantity: reqItem.quantity,
          variationsSnapshotJson: JSON.stringify(selectedVariations),
          extrasSnapshotJson: JSON.stringify(selectedExtras),
          extrasTotalCents,
          lineTotalCents: (unitPriceCents + extrasTotalCents) * reqItem.quantity,
          specialInstructions: reqItem.specialInstructions ?? null,
          prepTimeMinutes: dbItem.prepTimeMinutes,
        });
      }

      const result = await createCustomerOrder({
        restaurant,
        tableId: table.id,
        tableNumber: table.tableNumber,
        lines: preparedItems,
        notes: body.notes ?? null,
        idempotencyKey,
      });

      return reply
        .status(result.deduplicated ? 200 : 201)
        .send({ order: result.order, deduplicated: result.deduplicated });
    }
  );

  app.get('/api/v1/public/orders/:id', async (request) => {
    const { id } = request.params as { id: string };
    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        table: { select: { id: true, tableNumber: true, label: true } },
        items: true,
      },
    });
    if (!order) throw new NotFoundError('Order not found');
    return { order };
  });

  app.post('/api/v1/public/restaurants/:slug/reviews', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const restaurant = await resolveRestaurant(slug);
    const body = createPublicReviewSchema.parse(request.body);

    if (body.orderId) {
      const order = await prisma.order.findFirst({
        where: { id: body.orderId, restaurantId: restaurant.id },
      });
      if (!order) throw new BadRequestError('Order not found for this restaurant');
    }

    const review = await prisma.review.create({
      data: {
        restaurantId: restaurant.id,
        orderId: body.orderId ?? null,
        customerName: body.customerName.trim(),
        rating: body.rating,
        comment: body.comment?.trim() ?? null,
      },
    });

    await prisma.notification.create({
      data: {
        restaurantId: restaurant.id,
        type: 'NEW_REVIEW',
        title: `New ${review.rating}-Star Review`,
        message: `${review.customerName}: ${review.comment?.slice(0, 80) ?? 'Rated their experience'}`,
        entityType: 'Review',
        entityId: review.id,
        dedupeKey: `review:${review.id}`,
      },
    });

    await emitRealtimeEvent(restaurant.id, 'review.created', { review });
    await emitRealtimeEvent(restaurant.id, 'notification.created', {
      type: 'NEW_REVIEW',
      reviewId: review.id,
    });

    return reply.status(201).send({ review });
  });
}
