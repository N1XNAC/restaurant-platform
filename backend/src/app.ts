import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import path from 'node:path';
import fs from 'node:fs';
import { errorHandler } from './lib/errors.js';
import { authRoutes } from './routes/auth.js';
import { realtimeRoutes } from './lib/realtime.js';
import { tableRoutes } from './routes/tables.js';
import { menuRoutes } from './routes/menu.js';
import { publicRoutes } from './routes/public.js';
import { customerCompatRoutes } from './routes/customerCompat.js';
import { orderRoutes } from './routes/orders.js';
import { inventoryRoutes } from './routes/inventory.js';
import { analyticsRoutes } from './routes/analytics.js';
import { operationsRoutes } from './routes/operations.js';

export interface BuildAppOptions {
  logger?: boolean;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
  });

  const corsOrigins = (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  await app.register(cors, {
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await app.register(cookie, {
    secret: process.env.COOKIE_SECRET ?? 'dev-cookie-secret-change-in-production-64chars',
  });

  await app.register(jwt, {
    secret: process.env.JWT_SECRET ?? 'dev-change-this-in-production-super-secret-key-64chars',
  });

  await app.register(rateLimit, {
    global: false,
  });

  await app.register(multipart, {
    limits: {
      fileSize: 5 * 1024 * 1024, // 5 MB max image upload
      files: 1,
    },
  });

  const uploadsDir = path.resolve(process.cwd(), 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });
  await app.register(fastifyStatic, {
    root: uploadsDir,
    prefix: '/uploads/',
    decorateReply: false,
  });

  await app.register(websocket);

  app.setErrorHandler(errorHandler);

  app.get('/api/v1/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  await app.register(authRoutes);
  await app.register(realtimeRoutes);
  await app.register(tableRoutes);
  await app.register(menuRoutes);
  await app.register(publicRoutes);
  await app.register(orderRoutes);
  await app.register(inventoryRoutes);
  await app.register(analyticsRoutes);
  await app.register(operationsRoutes);
  await app.register(customerCompatRoutes);

  // Serve the customer-facing website from the same origin as the API so its
  // relative "/api/*" calls work without CORS and its relative asset paths
  // resolve unchanged. The restaurant app runs separately (see frontend/).
  const customerSiteDir =
    process.env.CUSTOMER_SITE_DIR ??
    path.resolve(process.cwd(), '..', 'customer-site');
  if (fs.existsSync(customerSiteDir)) {
    await app.register(fastifyStatic, {
      root: customerSiteDir,
      prefix: '/',
      decorateReply: false,
      index: ['index.html'],
    });
  } else {
    app.log.warn(`Customer site directory not found: ${customerSiteDir}`);
  }

  return app;
}
