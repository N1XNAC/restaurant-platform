import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticateRequest, requireRoles, ROLES } from '../lib/rbac.js';
import { ConflictError, NotFoundError } from '../lib/errors.js';
import { recordAuditLog } from '../lib/audit.js';

const createStaffSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2).max(100),
  password: z.string().min(8).max(100),
  role: z.enum(['OWNER', 'ADMIN', 'MANAGER', 'WAITER', 'KITCHEN_STAFF']),
});

const updateStaffSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  role: z.enum(['OWNER', 'ADMIN', 'MANAGER', 'WAITER', 'KITCHEN_STAFF']).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(8).max(100).optional(),
});

export async function operationsRoutes(app: FastifyInstance): Promise<void> {
  // Reviews
  app.get('/api/v1/reviews', { preHandler: [authenticateRequest] }, async (request) => {
    const reviews = await prisma.review.findMany({
      where: { restaurantId: request.user.restaurantId },
      orderBy: { createdAt: 'desc' },
      include: {
        order: { select: { id: true, orderNumber: true } },
        respondedBy: { select: { id: true, name: true } },
      },
    });

    const total = reviews.length;
    const avgRating =
      total > 0 ? Number((reviews.reduce((s, r) => s + r.rating, 0) / total).toFixed(2)) : 0;
    const distribution: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    for (const r of reviews) {
      distribution[r.rating] = (distribution[r.rating] ?? 0) + 1;
    }

    return {
      reviews,
      summary: { total, avgRating, distribution },
    };
  });

  app.post(
    '/api/v1/reviews/:id/reply',
    { preHandler: [requireRoles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)] },
    async (request) => {
      const { id } = request.params as { id: string };
      const { response } = z.object({ response: z.string().min(1).max(1000) }).parse(request.body);

      const existing = await prisma.review.findFirst({
        where: { id, restaurantId: request.user.restaurantId },
      });
      if (!existing) throw new NotFoundError('Review not found');

      const review = await prisma.review.update({
        where: { id },
        data: {
          response: response.trim(),
          respondedById: request.user.id,
          respondedAt: new Date(),
        },
      });

      await recordAuditLog({
        restaurantId: request.user.restaurantId,
        actorId: request.user.id,
        action: 'REVIEW_REPLIED',
        entityType: 'Review',
        entityId: review.id,
        ipAddress: request.ip,
      });

      return { review };
    }
  );

  // Staff Management
  app.get(
    '/api/v1/staff',
    { preHandler: [requireRoles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)] },
    async (request) => {
      const staff = await prisma.staffUser.findMany({
        where: { restaurantId: request.user.restaurantId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
          createdAt: true,
        },
      });
      return { staff };
    }
  );

  app.post(
    '/api/v1/staff',
    { preHandler: [requireRoles(ROLES.OWNER, ROLES.ADMIN)] },
    async (request, reply) => {
      const data = createStaffSchema.parse(request.body);
      const email = data.email.toLowerCase().trim();
      const exists = await prisma.staffUser.findUnique({ where: { email } });
      if (exists) throw new ConflictError('A staff user with this email already exists');

      const passwordHash = await bcrypt.hash(data.password, 10);
      const user = await prisma.staffUser.create({
        data: {
          restaurantId: request.user.restaurantId,
          email,
          name: data.name.trim(),
          passwordHash,
          role: data.role,
        },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
          createdAt: true,
        },
      });

      await recordAuditLog({
        restaurantId: request.user.restaurantId,
        actorId: request.user.id,
        action: 'STAFF_CREATED',
        entityType: 'StaffUser',
        entityId: user.id,
        metadata: { email: user.email, role: user.role },
        ipAddress: request.ip,
      });

      return reply.status(201).send({ staff: user });
    }
  );

  app.patch(
    '/api/v1/staff/:id',
    { preHandler: [requireRoles(ROLES.OWNER, ROLES.ADMIN)] },
    async (request) => {
      const { id } = request.params as { id: string };
      const data = updateStaffSchema.parse(request.body);
      const existing = await prisma.staffUser.findFirst({
        where: { id, restaurantId: request.user.restaurantId },
      });
      if (!existing) throw new NotFoundError('Staff member not found');

      const passwordHash = data.password ? await bcrypt.hash(data.password, 10) : undefined;
      const user = await prisma.staffUser.update({
        where: { id },
        data: {
          name: data.name?.trim(),
          role: data.role,
          isActive: data.isActive,
          ...(passwordHash ? { passwordHash } : {}),
        },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
          createdAt: true,
        },
      });

      await recordAuditLog({
        restaurantId: request.user.restaurantId,
        actorId: request.user.id,
        action: 'STAFF_UPDATED',
        entityType: 'StaffUser',
        entityId: user.id,
        metadata: { role: user.role, isActive: user.isActive },
        ipAddress: request.ip,
      });

      return { staff: user };
    }
  );

  // Audit Logs
  app.get(
    '/api/v1/audit-logs',
    { preHandler: [requireRoles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)] },
    async (request) => {
      const logs = await prisma.auditLog.findMany({
        where: { restaurantId: request.user.restaurantId },
        orderBy: { createdAt: 'desc' },
        take: 150,
        include: { actor: { select: { id: true, name: true, role: true } } },
      });
      return { logs };
    }
  );

  // Notifications
  app.get('/api/v1/notifications', { preHandler: [authenticateRequest] }, async (request) => {
    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { restaurantId: request.user.restaurantId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.notification.count({
        where: { restaurantId: request.user.restaurantId, isRead: false },
      }),
    ]);

    return { notifications, unreadCount };
  });

  app.patch(
    '/api/v1/notifications/:id/read',
    { preHandler: [authenticateRequest] },
    async (request) => {
      const { id } = request.params as { id: string };
      const existing = await prisma.notification.findFirst({
        where: { id, restaurantId: request.user.restaurantId },
      });
      if (!existing) throw new NotFoundError('Notification not found');

      const notification = await prisma.notification.update({
        where: { id },
        data: { isRead: true },
      });
      return { notification };
    }
  );

  app.post(
    '/api/v1/notifications/read-all',
    { preHandler: [authenticateRequest] },
    async (request) => {
      await prisma.notification.updateMany({
        where: { restaurantId: request.user.restaurantId, isRead: false },
        data: { isRead: true },
      });
      return { ok: true };
    }
  );
}
