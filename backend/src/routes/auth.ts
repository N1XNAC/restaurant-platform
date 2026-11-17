import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { UnauthorizedError } from '../lib/errors.js';
import { authenticateRequest, requireRoles, ROLES, type StaffRole } from '../lib/rbac.js';
import { recordAuditLog } from '../lib/audit.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

const updateRestaurantSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  tagline: z.string().max(160).nullable().optional(),
  cuisine: z.string().max(120).nullable().optional(),
  hours: z.string().max(120).nullable().optional(),
  taxRateBps: z.number().int().min(0).max(5000).optional(),
  serviceChargeBps: z.number().int().min(0).max(5000).optional(),
  currency: z.string().min(3).max(5).optional(),
  address: z.string().max(300).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  email: z.string().email().nullable().optional(),
  timezone: z.string().min(1).max(60).optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  geofenceRadiusMeters: z.number().int().min(10).max(5000).optional(),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/v1/auth/login',
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      const body = loginSchema.parse(request.body);
      const staff = await prisma.staffUser.findUnique({
        where: { email: body.email.toLowerCase().trim() },
        include: { restaurant: true },
      });

      if (!staff || !staff.isActive) {
        throw new UnauthorizedError('Invalid email or password');
      }

      const valid = await bcrypt.compare(body.password, staff.passwordHash);
      if (!valid) {
        throw new UnauthorizedError('Invalid email or password');
      }

      const token = app.jwt.sign(
        {
          sub: staff.id,
          restaurantId: staff.restaurantId,
          role: staff.role as StaffRole,
        },
        { expiresIn: '12h' }
      );

      await recordAuditLog({
        restaurantId: staff.restaurantId,
        actorId: staff.id,
        action: 'AUTH_LOGIN',
        entityType: 'StaffUser',
        entityId: staff.id,
        ipAddress: request.ip,
      });

      reply.setCookie('access_token', token, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 60 * 60 * 12,
      });

      return {
        token,
        user: {
          id: staff.id,
          restaurantId: staff.restaurantId,
          email: staff.email,
          name: staff.name,
          role: staff.role,
        },
        restaurant: {
          id: staff.restaurant.id,
          name: staff.restaurant.name,
          slug: staff.restaurant.slug,
          taxRateBps: staff.restaurant.taxRateBps,
          serviceChargeBps: staff.restaurant.serviceChargeBps,
          currency: staff.restaurant.currency,
        },
      };
    }
  );

  app.post('/api/v1/auth/logout', async (request, reply) => {
    try {
      await authenticateRequest(request);
      await recordAuditLog({
        restaurantId: request.user.restaurantId,
        actorId: request.user.id,
        action: 'AUTH_LOGOUT',
        entityType: 'StaffUser',
        entityId: request.user.id,
        ipAddress: request.ip,
      });
    } catch {
      // Ignore if already expired
    }
    reply.clearCookie('access_token', { path: '/' });
    return { ok: true };
  });

  app.get('/api/v1/auth/me', { preHandler: [authenticateRequest] }, async (request) => {
    const restaurant = await prisma.restaurant.findUniqueOrThrow({
      where: { id: request.user.restaurantId },
      select: {
        id: true,
        name: true,
        slug: true,
        tagline: true,
        cuisine: true,
        hours: true,
        taxRateBps: true,
        serviceChargeBps: true,
        currency: true,
        address: true,
        phone: true,
        email: true,
        timezone: true,
        latitude: true,
        longitude: true,
        geofenceRadiusMeters: true,
      },
    });

    return {
      user: request.user,
      restaurant,
    };
  });

  app.get('/api/v1/restaurant', { preHandler: [authenticateRequest] }, async (request) => {
    const restaurant = await prisma.restaurant.findUniqueOrThrow({
      where: { id: request.user.restaurantId },
    });
    return { restaurant };
  });

  app.patch(
    '/api/v1/restaurant',
    { preHandler: [requireRoles(ROLES.OWNER, ROLES.ADMIN)] },
    async (request) => {
      const data = updateRestaurantSchema.parse(request.body);
      const updated = await prisma.restaurant.update({
        where: { id: request.user.restaurantId },
        data,
      });

      await recordAuditLog({
        restaurantId: request.user.restaurantId,
        actorId: request.user.id,
        action: 'RESTAURANT_UPDATED',
        entityType: 'Restaurant',
        entityId: updated.id,
        metadata: data,
        ipAddress: request.ip,
      });

      return { restaurant: updated };
    }
  );
}
