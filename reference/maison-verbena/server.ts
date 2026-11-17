import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createApiRouter } from './server/routes';
import { RestaurantStore } from './server/store';

async function startServer(): Promise<void> {
  const app = express();
  const port = Number(process.env.PORT || 3000);
  const isProd = process.env.NODE_ENV === 'production';

  app.disable('x-powered-by');

  // Configurable CORS support so static frontends on Netlify/Vercel/CDNs can talk to this API
  const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '*')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.use('/api', (req, res, next) => {
    const reqOrigin = req.headers.origin;
    if (allowedOrigins.includes('*')) {
      res.setHeader('Access-Control-Allow-Origin', '*');
    } else if (reqOrigin && allowedOrigins.includes(reqOrigin)) {
      res.setHeader('Access-Control-Allow-Origin', reqOrigin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Integration-Key');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.use(express.json({ limit: '256kb' }));

  const store = new RestaurantStore();
  app.use('/api', createApiRouter(store));

  const distDir = path.resolve(process.cwd(), 'dist');
  const staticRoot = isProd && fs.existsSync(distDir) ? distDir : process.cwd();

  app.use(
    '/assets',
    express.static(path.join(staticRoot, 'assets'), {
      maxAge: isProd ? '30d' : 0,
    })
  );
  app.use(
    '/css',
    express.static(path.join(staticRoot, 'css'), {
      maxAge: isProd ? '1d' : 0,
    })
  );
  app.use(
    '/js',
    express.static(path.join(staticRoot, 'js'), {
      maxAge: isProd ? '1d' : 0,
    })
  );

  // Cleanly serve standalone HTML pages (index.html, menu.html, cart.html, order-confirmation.html)
  const htmlPages = new Set([
    'index.html',
    'menu.html',
    'cart.html',
    'order-confirmation.html',
  ]);

  app.get('/', (_req, res) => {
    res.sendFile(path.join(staticRoot, 'index.html'));
  });

  app.get('/:page', (req, res, next) => {
    const requested = req.params.page;
    const normalized = requested.endsWith('.html') ? requested : `${requested}.html`;
    if (htmlPages.has(normalized)) {
      res.sendFile(path.join(staticRoot, normalized));
      return;
    }
    next();
  });

  app.listen(port, '0.0.0.0', () => {
    console.log(
      `Maison Verbena static + API server listening on http://localhost:${port} (root: ${path.basename(staticRoot)})`
    );
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
