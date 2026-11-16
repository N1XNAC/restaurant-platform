import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticateRequest, requireRoles, ROLES } from '../lib/rbac.js';
import { BadRequestError, ConflictError, NotFoundError } from '../lib/errors.js';
import { recordAuditLog } from '../lib/audit.js';
import { emitRealtimeEvent } from '../lib/realtime.js';

const categorySchema = z.object({
  name: z.string().min(1).max(60),
  description: z.string().max(250).nullable().optional(),
  sortOrder: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
});

const variationInputSchema = z.object({
  name: z.string().min(1).max(60),
  priceDeltaCents: z.number().int().min(-100000).max(500000).default(0),
  isAvailable: z.boolean().default(true),
});

const extraInputSchema = z.object({
  name: z.string().min(1).max(60),
  priceCents: z.number().int().min(0).max(500000).default(0),
  isAvailable: z.boolean().default(true),
});

const recipeIngredientSchema = z.object({
  ingredientId: z.string().min(1),
  quantityRequired: z.number().positive(),
});

const menuItemSchema = z.object({
  categoryId: z.string().min(1),
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullable().optional(),
  priceCents: z.number().int().min(0).max(10_000_000),
  prepTimeMinutes: z.number().int().min(1).max(180).default(15),
  dietaryType: z.enum(['VEG', 'NON_VEG', 'VEGAN']).default('VEG'),
  allergens: z.array(z.string().max(40)).default([]),
  imageUrl: z.string().max(500).nullable().optional(),
  isAvailable: z.boolean().default(true),
  variations: z.array(variationInputSchema).optional(),
  extras: z.array(extraInputSchema).optional(),
  ingredients: z.array(recipeIngredientSchema).optional(),
});

const ALLOWED_IMAGE_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

export async function menuRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/menu', { preHandler: [authenticateRequest] }, async (request) => {
    const [categories, items] = await Promise.all([
      prisma.menuCategory.findMany({
        where: { restaurantId: request.user.restaurantId },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      prisma.menuItem.findMany({
        where: { restaurantId: request.user.restaurantId, isArchived: false },
        orderBy: [{ name: 'asc' }],
        include: {
          category: { select: { id: true, name: true } },
          variations: true,
          extras: true,
          ingredients: {
            include: {
              ingredient: { select: { id: true, name: true, unit: true, stockQty: true } },
            },
          },
        },
      }),
    ]);

    return {
      categories,
      items: items.map((item) => ({
        ...item,
        allergens: JSON.parse(item.allergensJson) as string[],
      })),
    };
  });

  app.post(
    '/api/v1/menu/categories',
    { preHandler: [requireRoles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)] },
    async (request, reply) => {
      const data = categorySchema.parse(request.body);
      const exists = await prisma.menuCategory.findUnique({
        where: {
          restaurantId_name: {
            restaurantId: request.user.restaurantId,
            name: data.name.trim(),
          },
        },
      });
      if (exists) throw new ConflictError('Category name already exists');

      const category = await prisma.menuCategory.create({
        data: {
          restaurantId: request.user.restaurantId,
          name: data.name.trim(),
          description: data.description ?? null,
          sortOrder: data.sortOrder,
          isActive: data.isActive,
        },
      });
      await emitRealtimeEvent(request.user.restaurantId, 'menu.updated', {
        entity: 'category',
        id: category.id,
      });
      return reply.status(201).send({ category });
    }
  );

  app.patch(
    '/api/v1/menu/categories/:id',
    { preHandler: [requireRoles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)] },
    async (request) => {
      const { id } = request.params as { id: string };
      const data = categorySchema.partial().parse(request.body);
      const existing = await prisma.menuCategory.findFirst({
        where: { id, restaurantId: request.user.restaurantId },
      });
      if (!existing) throw new NotFoundError('Category not found');

      const category = await prisma.menuCategory.update({
        where: { id },
        data,
      });
      await emitRealtimeEvent(request.user.restaurantId, 'menu.updated', {
        entity: 'category',
        id: category.id,
      });
      return { category };
    }
  );

  app.delete(
    '/api/v1/menu/categories/:id',
    { preHandler: [requireRoles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)] },
    async (request) => {
      const { id } = request.params as { id: string };
      const existing = await prisma.menuCategory.findFirst({
        where: { id, restaurantId: request.user.restaurantId },
      });
      if (!existing) throw new NotFoundError('Category not found');

      const itemCount = await prisma.menuItem.count({
        where: { categoryId: id, isArchived: false },
      });
      if (itemCount > 0) {
        throw new ConflictError('Cannot delete category that still has active menu items');
      }

      await prisma.menuCategory.delete({ where: { id } });
      await emitRealtimeEvent(request.user.restaurantId, 'menu.updated', {
        entity: 'category',
        id,
        deleted: true,
      });
      return { deleted: true };
    }
  );

  app.post(
    '/api/v1/menu/items',
    { preHandler: [requireRoles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)] },
    async (request, reply) => {
      const data = menuItemSchema.parse(request.body);
      const category = await prisma.menuCategory.findFirst({
        where: { id: data.categoryId, restaurantId: request.user.restaurantId },
      });
      if (!category) throw new BadRequestError('Invalid categoryId for this restaurant');

      const item = await prisma.menuItem.create({
        data: {
          restaurantId: request.user.restaurantId,
          categoryId: data.categoryId,
          name: data.name.trim(),
          description: data.description ?? null,
          priceCents: data.priceCents,
          prepTimeMinutes: data.prepTimeMinutes,
          dietaryType: data.dietaryType,
          allergensJson: JSON.stringify(data.allergens),
          imageUrl: data.imageUrl ?? null,
          isAvailable: data.isAvailable,
          variations: data.variations ? { create: data.variations } : undefined,
          extras: data.extras ? { create: data.extras } : undefined,
          ingredients: data.ingredients
            ? {
                create: data.ingredients.map((ing) => ({
                  ingredientId: ing.ingredientId,
                  quantityRequired: ing.quantityRequired,
                })),
              }
            : undefined,
        },
        include: { variations: true, extras: true, ingredients: true },
      });

      await recordAuditLog({
        restaurantId: request.user.restaurantId,
        actorId: request.user.id,
        action: 'MENU_ITEM_CREATED',
        entityType: 'MenuItem',
        entityId: item.id,
        metadata: { name: item.name, priceCents: item.priceCents },
        ipAddress: request.ip,
      });

      await emitRealtimeEvent(request.user.restaurantId, 'menu.updated', {
        entity: 'item',
        id: item.id,
      });

      return reply.status(201).send({
        item: { ...item, allergens: JSON.parse(item.allergensJson) as string[] },
      });
    }
  );

  app.patch(
    '/api/v1/menu/items/:id',
    { preHandler: [requireRoles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)] },
    async (request) => {
      const { id } = request.params as { id: string };
      const data = menuItemSchema.partial().parse(request.body);

      const existing = await prisma.menuItem.findFirst({
        where: { id, restaurantId: request.user.restaurantId, isArchived: false },
      });
      if (!existing) throw new NotFoundError('Menu item not found');

      if (data.categoryId) {
        const category = await prisma.menuCategory.findFirst({
          where: { id: data.categoryId, restaurantId: request.user.restaurantId },
        });
        if (!category) throw new BadRequestError('Invalid categoryId for this restaurant');
      }

      const item = await prisma.$transaction(async (tx) => {
        if (data.variations !== undefined) {
          await tx.menuItemVariation.deleteMany({ where: { menuItemId: id } });
        }
        if (data.extras !== undefined) {
          await tx.menuItemExtra.deleteMany({ where: { menuItemId: id } });
        }
        if (data.ingredients !== undefined) {
          await tx.menuItemIngredient.deleteMany({ where: { menuItemId: id } });
        }

        return tx.menuItem.update({
          where: { id },
          data: {
            categoryId: data.categoryId,
            name: data.name?.trim(),
            description: data.description,
            priceCents: data.priceCents,
            prepTimeMinutes: data.prepTimeMinutes,
            dietaryType: data.dietaryType,
            allergensJson: data.allergens ? JSON.stringify(data.allergens) : undefined,
            imageUrl: data.imageUrl,
            isAvailable: data.isAvailable,
            variations: data.variations ? { create: data.variations } : undefined,
            extras: data.extras ? { create: data.extras } : undefined,
            ingredients: data.ingredients
              ? {
                  create: data.ingredients.map((ing) => ({
                    ingredientId: ing.ingredientId,
                    quantityRequired: ing.quantityRequired,
                  })),
                }
              : undefined,
          },
          include: { variations: true, extras: true, ingredients: true },
        });
      });

      await recordAuditLog({
        restaurantId: request.user.restaurantId,
        actorId: request.user.id,
        action: 'MENU_ITEM_UPDATED',
        entityType: 'MenuItem',
        entityId: item.id,
        metadata: { name: item.name, priceCents: item.priceCents },
        ipAddress: request.ip,
      });

      await emitRealtimeEvent(request.user.restaurantId, 'menu.updated', {
        entity: 'item',
        id: item.id,
      });

      return {
        item: { ...item, allergens: JSON.parse(item.allergensJson) as string[] },
      };
    }
  );

  app.patch(
    '/api/v1/menu/items/:id/availability',
    { preHandler: [requireRoles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.KITCHEN_STAFF)] },
    async (request) => {
      const { id } = request.params as { id: string };
      const { isAvailable } = z.object({ isAvailable: z.boolean() }).parse(request.body);

      const existing = await prisma.menuItem.findFirst({
        where: { id, restaurantId: request.user.restaurantId, isArchived: false },
      });
      if (!existing) throw new NotFoundError('Menu item not found');

      const item = await prisma.menuItem.update({
        where: { id },
        data: { isAvailable },
      });

      await emitRealtimeEvent(request.user.restaurantId, 'menu.updated', {
        entity: 'item',
        id: item.id,
        isAvailable,
      });

      return { item };
    }
  );

  app.delete(
    '/api/v1/menu/items/:id',
    { preHandler: [requireRoles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)] },
    async (request) => {
      const { id } = request.params as { id: string };
      const existing = await prisma.menuItem.findFirst({
        where: { id, restaurantId: request.user.restaurantId, isArchived: false },
      });
      if (!existing) throw new NotFoundError('Menu item not found');

      // Archive instead of hard-delete to preserve historical order integrity
      await prisma.menuItem.update({
        where: { id },
        data: { isArchived: true, isAvailable: false },
      });

      await recordAuditLog({
        restaurantId: request.user.restaurantId,
        actorId: request.user.id,
        action: 'MENU_ITEM_ARCHIVED',
        entityType: 'MenuItem',
        entityId: id,
        ipAddress: request.ip,
      });

      await emitRealtimeEvent(request.user.restaurantId, 'menu.updated', {
        entity: 'item',
        id,
        archived: true,
      });

      return { archived: true };
    }
  );

  app.post(
    '/api/v1/menu/upload',
    { preHandler: [requireRoles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)] },
    async (request) => {
      const file = await request.file();
      if (!file) {
        throw new BadRequestError('No image file uploaded');
      }
      const ext = ALLOWED_IMAGE_MIME[file.mimetype];
      if (!ext) {
        throw new BadRequestError('Only PNG, JPEG, and WEBP images are allowed');
      }

      const filename = `${crypto.randomUUID()}${ext}`;
      const uploadsDir = path.resolve(process.cwd(), 'uploads');
      fs.mkdirSync(uploadsDir, { recursive: true });
      const destPath = path.join(uploadsDir, filename);

      await pipeline(file.file, fs.createWriteStream(destPath));
      if (file.file.truncated) {
        fs.unlinkSync(destPath);
        throw new BadRequestError('Image exceeds 5MB limit');
      }

      return { imageUrl: `/uploads/${filename}` };
    }
  );
}
