import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticateRequest, requireRoles, ROLES } from '../lib/rbac.js';
import { BadRequestError, ConflictError, NotFoundError } from '../lib/errors.js';
import { recordAuditLog } from '../lib/audit.js';
import { emitLowStockAlerts } from '../lib/inventory.js';

const ingredientSchema = z.object({
  name: z.string().min(1).max(100),
  unit: z.enum(['g', 'kg', 'ml', 'l', 'pcs']),
  stockQty: z.number().min(0).default(0),
  lowStockThreshold: z.number().min(0).default(10),
  costPerUnitCents: z.number().int().min(0).default(0),
});

const adjustmentSchema = z.object({
  ingredientId: z.string().min(1),
  type: z.enum(['PURCHASE', 'RESTOCK', 'ADJUSTMENT', 'WASTAGE']),
  quantityDelta: z.number().refine((v) => v !== 0, 'quantityDelta must be non-zero'),
  unitCostCents: z.number().int().min(0).optional(),
  notes: z.string().max(300).optional(),
});

export async function inventoryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/inventory/ingredients', { preHandler: [authenticateRequest] }, async (request) => {
    const ingredients = await prisma.ingredient.findMany({
      where: { restaurantId: request.user.restaurantId },
      orderBy: { name: 'asc' },
    });
    return {
      ingredients: ingredients.map((ing) => ({
        ...ing,
        isLowStock: ing.stockQty <= ing.lowStockThreshold,
      })),
    };
  });

  app.post(
    '/api/v1/inventory/ingredients',
    { preHandler: [requireRoles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)] },
    async (request, reply) => {
      const data = ingredientSchema.parse(request.body);
      const exists = await prisma.ingredient.findUnique({
        where: {
          restaurantId_name: {
            restaurantId: request.user.restaurantId,
            name: data.name.trim(),
          },
        },
      });
      if (exists) throw new ConflictError('Ingredient already exists');

      const ingredient = await prisma.ingredient.create({
        data: {
          restaurantId: request.user.restaurantId,
          name: data.name.trim(),
          unit: data.unit,
          stockQty: data.stockQty,
          lowStockThreshold: data.lowStockThreshold,
          costPerUnitCents: data.costPerUnitCents,
        },
      });

      await recordAuditLog({
        restaurantId: request.user.restaurantId,
        actorId: request.user.id,
        action: 'INGREDIENT_CREATED',
        entityType: 'Ingredient',
        entityId: ingredient.id,
        metadata: { name: ingredient.name, stockQty: ingredient.stockQty },
        ipAddress: request.ip,
      });

      return reply.status(201).send({ ingredient });
    }
  );

  app.patch(
    '/api/v1/inventory/ingredients/:id',
    { preHandler: [requireRoles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)] },
    async (request) => {
      const { id } = request.params as { id: string };
      const data = ingredientSchema.partial().parse(request.body);

      const existing = await prisma.ingredient.findFirst({
        where: { id, restaurantId: request.user.restaurantId },
      });
      if (!existing) throw new NotFoundError('Ingredient not found');

      const ingredient = await prisma.ingredient.update({
        where: { id },
        data: {
          name: data.name?.trim(),
          unit: data.unit,
          lowStockThreshold: data.lowStockThreshold,
          costPerUnitCents: data.costPerUnitCents,
        },
      });
      return { ingredient };
    }
  );

  app.post(
    '/api/v1/inventory/adjustments',
    { preHandler: [requireRoles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.KITCHEN_STAFF)] },
    async (request, reply) => {
      const data = adjustmentSchema.parse(request.body);
      const existing = await prisma.ingredient.findFirst({
        where: { id: data.ingredientId, restaurantId: request.user.restaurantId },
      });
      if (!existing) throw new NotFoundError('Ingredient not found');

      let signedDelta = data.quantityDelta;
      if (data.type === 'WASTAGE' && signedDelta > 0) {
        signedDelta = -signedDelta;
      } else if ((data.type === 'PURCHASE' || data.type === 'RESTOCK') && signedDelta < 0) {
        throw new BadRequestError(`${data.type} quantityDelta must be positive`);
      }

      const newQty = existing.stockQty + signedDelta;
      if (newQty < 0) {
        throw new BadRequestError(`Adjustment would result in negative stock (${newQty})`);
      }

      const { updated, txRecord } = await prisma.$transaction(async (tx) => {
        const txRecord = await tx.inventoryTransaction.create({
          data: {
            restaurantId: request.user.restaurantId,
            ingredientId: existing.id,
            type: data.type,
            quantityDelta: signedDelta,
            unitCostCents: data.unitCostCents ?? existing.costPerUnitCents,
            notes: data.notes ?? null,
            createdById: request.user.id,
          },
        });

        const updated = await tx.ingredient.update({
          where: { id: existing.id },
          data: {
            stockQty: newQty,
            ...(data.unitCostCents !== undefined ? { costPerUnitCents: data.unitCostCents } : {}),
          },
        });

        return { updated, txRecord };
      });

      if (updated.stockQty <= updated.lowStockThreshold) {
        await emitLowStockAlerts(request.user.restaurantId, [
          {
            ingredientId: updated.id,
            name: updated.name,
            stockQty: updated.stockQty,
            lowStockThreshold: updated.lowStockThreshold,
          },
        ]);
      }

      await recordAuditLog({
        restaurantId: request.user.restaurantId,
        actorId: request.user.id,
        action: 'INVENTORY_ADJUSTED',
        entityType: 'Ingredient',
        entityId: updated.id,
        metadata: { type: data.type, delta: signedDelta, newQty: updated.stockQty },
        ipAddress: request.ip,
      });

      return reply.status(201).send({ ingredient: updated, transaction: txRecord });
    }
  );

  app.get('/api/v1/inventory/transactions', { preHandler: [authenticateRequest] }, async (request) => {
    const transactions = await prisma.inventoryTransaction.findMany({
      where: { restaurantId: request.user.restaurantId },
      orderBy: { createdAt: 'desc' },
      take: 150,
      include: {
        ingredient: { select: { id: true, name: true, unit: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });
    return { transactions };
  });
}
