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
import { uploadsDir } from './lib/uploads.js';
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
    // Behind a reverse proxy (Fly/Render/Nginx) this makes request.protocol,
    // request.ip and rate limiting reflect the real client.
    trustProxy: process.env.TRUST_PROXY === 'true',
  });

  const corsOrigins = (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  const corsOriginRegex = process.env.CORS_ORIGIN_REGEX
    ? new RegExp(process.env.CORS_ORIGIN_REGEX)
    : null;

  await app.register(cors, {
    origin: (origin, callback) => {
      // No Origin header: server-to-server calls, curl, health checks.
      if (!origin) return callback(null, true);
      const normalized = origin.replace(/\/+$/, '');
      if (
        corsOrigins.includes('*') ||
        corsOrigins.includes(normalized) ||
        (corsOriginRegex ? corsOriginRegex.test(normalized) : false)
      ) {
        return callback(null, true);
      }
      // Disallowed origins get no CORS headers instead of a 500.
      return callback(null, false);
    },
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

  const uploadsPath = uploadsDir();
  fs.mkdirSync(uploadsPath, { recursive: true });
  await app.register(fastifyStatic, {
    root: uploadsPath,
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
  // resolve unchanged. Set SERVE_CUSTOMER_SITE=false when the customer site is
  // hosted separately (e.g. a Netlify site pointing at this backend).
  const serveCustomerSite = process.env.SERVE_CUSTOMER_SITE !== 'false';
  const customerSiteDir =
    process.env.CUSTOMER_SITE_DIR ??
    path.resolve(process.cwd(), '..', 'customer-site');
  if (serveCustomerSite && fs.existsSync(customerSiteDir)) {
    await app.register(fastifyStatic, {
      root: customerSiteDir,
      prefix: '/',
      decorateReply: false,
      index: ['index.html'],
    });
  } else if (serveCustomerSite) {
    app.log.warn(`Customer site directory not found: ${customerSiteDir}`);
  }

  return app;
}
