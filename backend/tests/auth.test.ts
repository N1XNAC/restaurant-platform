import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

describe('Phase 2: Auth, RBAC, and Restaurant Configuration', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('GET /api/v1/health returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ok');
  });

  it('rejects unauthenticated /api/v1/auth/me', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects invalid password on login', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'owner@bistro.local', password: 'WrongPassword!' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('logs in OWNER and allows restaurant config update, while blocking WAITER', async () => {
    const ownerLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'owner@bistro.local', password: 'Password123!' },
    });
    expect(ownerLogin.statusCode).toBe(200);
    const ownerBody = ownerLogin.json();
    expect(ownerBody.user.role).toBe('OWNER');
    expect(ownerBody.token).toBeTruthy();

    const waiterLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'waiter@bistro.local', password: 'Password123!' },
    });
    expect(waiterLogin.statusCode).toBe(200);
    const waiterToken = waiterLogin.json().token;

    // Waiter cannot update restaurant config
    const forbiddenRes = await app.inject({
      method: 'PATCH',
      url: '/api/v1/restaurant',
      headers: { authorization: `Bearer ${waiterToken}` },
      payload: { taxRateBps: 900 },
    });
    expect(forbiddenRes.statusCode).toBe(403);

    // Owner can update restaurant config
    const okRes = await app.inject({
      method: 'PATCH',
      url: '/api/v1/restaurant',
      headers: { authorization: `Bearer ${ownerBody.token}` },
      payload: { taxRateBps: 800 },
    });
    expect(okRes.statusCode).toBe(200);
    expect(okRes.json().restaurant.taxRateBps).toBe(800);
  });
});
