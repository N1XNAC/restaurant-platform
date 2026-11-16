import type { FastifyRequest } from 'fastify';
import { ForbiddenError, UnauthorizedError } from './errors.js';
import { prisma } from './prisma.js';

export const ROLES = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  MANAGER: 'MANAGER',
  WAITER: 'WAITER',
  KITCHEN_STAFF: 'KITCHEN_STAFF',
} as const;

export type StaffRole = (typeof ROLES)[keyof typeof ROLES];

export interface AuthUser {
  id: string;
  restaurantId: string;
  email: string;
  name: string;
  role: StaffRole;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      sub: string;
      restaurantId: string;
      role: StaffRole;
    };
    user: AuthUser;
  }
}

export async function authenticateRequest(request: FastifyRequest): Promise<void> {
  try {
    const token =
      request.cookies?.access_token ||
      (request.headers.authorization?.startsWith('Bearer ')
        ? request.headers.authorization.slice(7)
        : undefined);

    if (!token) {
      throw new UnauthorizedError('Missing authentication token');
    }

    const decoded = await request.server.jwt.verify<{
      sub: string;
      restaurantId: string;
      role: StaffRole;
    }>(token);

    const staff = await prisma.staffUser.findUnique({
      where: { id: decoded.sub },
      select: {
        id: true,
        restaurantId: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
      },
    });

    if (!staff || !staff.isActive) {
      throw new UnauthorizedError('Account is inactive or no longer exists');
    }

    request.user = {
      id: staff.id,
      restaurantId: staff.restaurantId,
      email: staff.email,
      name: staff.name,
      role: staff.role as StaffRole,
    };
  } catch (err) {
    if (err instanceof UnauthorizedError) throw err;
    throw new UnauthorizedError('Invalid or expired session');
  }
}

export function requireRoles(...allowedRoles: StaffRole[]) {
  return async (request: FastifyRequest): Promise<void> => {
    await authenticateRequest(request);
    if (!allowedRoles.includes(request.user.role)) {
      throw new ForbiddenError(`Role ${request.user.role} is not authorized for this action`);
    }
  };
}
