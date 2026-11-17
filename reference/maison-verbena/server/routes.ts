import express, { type NextFunction, type Request, type Response } from 'express';
import { MENU_CATALOG, TABLE_TOKENS } from './catalog';
import { HttpError, RestaurantStore } from './store';
import type { OrderStatus } from './types';

export function createApiRouter(store: RestaurantStore): express.Router {
  const router = express.Router();

  function getClientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      return forwarded.split(',')[0].trim();
    }
    return req.ip || '127.0.0.1';
  }

  async function forwardToRestaurantManagement(
    eventType: 'ORDER_CREATED' | 'ORDER_CANCELLED',
    payload: unknown
  ): Promise<void> {
    const webhookUrl = process.env.RESTAURANT_MGMT_WEBHOOK_URL;
    if (!webhookUrl) return;
    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Integration-Key': process.env.RESTAURANT_MGMT_API_KEY || '',
        },
        body: JSON.stringify({ eventType, payload }),
      });
    } catch {
      // Outbox retains event for pull synchronization if webhook target is offline
    }
  }

  router.get('/health', (_req: Request, res: Response) => {
    res.json({ ok: true, service: 'maison-verbena-customer-api' });
  });

  // Safe directory of QR/NFC scan presets for testing / table switching without exposing PINs
  router.get('/session/demo-tokens', (_req: Request, res: Response) => {
    const presets = Object.values(TABLE_TOKENS).map((t) => ({
      token: t.token,
      tableId: t.tableId,
      tableNumber: t.tableNumber,
      tableLabel: t.tableLabel,
      entryMethod: t.entryMethod,
      seats: t.seats,
      status: t.status,
    }));
    res.json({ presets });
  });

  // POST /api/session/validate — validates QR/NFC token and binds authenticated session
  router.post('/session/validate', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { token, gps } = req.body ?? {};
      const session = store.validateQrNfcToken({
        token: typeof token === 'string' ? token : '',
        gps: gps ?? null,
        clientIp: getClientIp(req),
      });
      res.status(200).json({ session });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/session/verify-location — secondary consented GPS geofence evaluation
  router.post('/session/verify-location', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { sessionId, sessionSignature, gps } = req.body ?? {};
      const session = store.verifySessionLocation({
        sessionId: String(sessionId || ''),
        sessionSignature: String(sessionSignature || ''),
        gps: gps ?? null,
        clientIp: getClientIp(req),
      });
      res.json({ session });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/session/verify-challenge — secondary 4-digit table placard verification
  router.post('/session/verify-challenge', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { sessionId, sessionSignature, pin } = req.body ?? {};
      const session = store.verifyTableChallenge({
        sessionId: String(sessionId || ''),
        sessionSignature: String(sessionSignature || ''),
        pin: String(pin || ''),
        clientIp: getClientIp(req),
      });
      res.json({ session });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/restaurant/:restaurantId/menu — fetches authoritative restaurant menu & details
  router.get('/restaurant/:restaurantId/menu', (req: Request, res: Response, next: NextFunction) => {
    try {
      const restaurantId = String(req.params.restaurantId || '');
      const { restaurant, items } = store.getRestaurantMenu(restaurantId);
      const search = String(req.query.search || '').trim().toLowerCase();
      const category = String(req.query.category || '').trim();
      const dietary = String(req.query.dietary || '').trim();

      const filtered = items.filter((item) => {
        if (category && category !== 'All' && item.category !== category) return false;
        if (dietary && dietary !== 'all' && item.dietary !== dietary) return false;
        if (
          search &&
          !item.name.toLowerCase().includes(search) &&
          !item.description.toLowerCase().includes(search) &&
          !item.category.toLowerCase().includes(search)
        ) {
          return false;
        }
        return true;
      });

      res.json({
        restaurant,
        categories: Array.from(new Set(MENU_CATALOG.map((m) => m.category))),
        items: filtered,
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/menu/items/:itemId — fetches single food item details
  router.get('/menu/items/:itemId', (req: Request, res: Response, next: NextFunction) => {
    try {
      const item = store.getMenuItem(String(req.params.itemId || ''));
      res.json({ item });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/orders — submits validated customer order with server-computed pricing
  router.post('/orders', (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body ?? {};
      const order = store.submitOrder({
        restaurantId: String(body.restaurantId || ''),
        tableId: String(body.tableId || ''),
        sessionId: String(body.sessionId || ''),
        sessionSignature: String(body.sessionSignature || ''),
        idempotencyKey: String(body.idempotencyKey || ''),
        orderMode: body.orderMode === 'only_this' ? 'only_this' : 'table_cart',
        items: Array.isArray(body.items) ? body.items : [],
        clientIp: getClientIp(req),
      });

      void forwardToRestaurantManagement('ORDER_CREATED', order);
      res.status(201).json({
        order,
        message: 'Your order has been successfully placed!',
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/orders/:orderId — fetches order confirmation & live status
  router.get('/orders/:orderId', (req: Request, res: Response, next: NextFunction) => {
    try {
      const order = store.getOrder(String(req.params.orderId || ''));
      res.json({ order });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/orders/:orderId/cancel — requests cancellation subject to restaurant window
  router.post('/orders/:orderId/cancel', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { sessionId, sessionSignature, reason } = req.body ?? {};
      const order = store.cancelOrder({
        orderId: String(req.params.orderId || ''),
        sessionId: String(sessionId || ''),
        sessionSignature: String(sessionSignature || ''),
        reason: typeof reason === 'string' ? reason : undefined,
        clientIp: getClientIp(req),
      });

      void forwardToRestaurantManagement('ORDER_CANCELLED', order);
      res.json({ order });
    } catch (err) {
      next(err);
    }
  });

  // Integration Contract Endpoints for Separate Restaurant Management Dashboard
  router.get('/integration/orders', (req: Request, res: Response) => {
    const restaurantId =
      typeof req.query.restaurantId === 'string' ? req.query.restaurantId : undefined;
    res.json({ orders: store.listIntegrationOrders(restaurantId) });
  });

  router.patch('/integration/orders/:orderId/status', (req: Request, res: Response, next: NextFunction) => {
    try {
      const allowedStatuses: OrderStatus[] = [
        'RECEIVED',
        'PREPARING',
        'READY',
        'SERVED',
        'CANCELLED',
      ];
      const nextStatus = String(req.body?.status || '') as OrderStatus;
      if (!allowedStatuses.includes(nextStatus)) {
        throw new HttpError(400, 'INVALID_STATUS', 'Unsupported order status transition.');
      }
      const order = store.updateOrderStatusFromManagement(
        String(req.params.orderId || ''),
        nextStatus
      );
      res.json({ order });
    } catch (err) {
      next(err);
    }
  });

  router.get('/security/logs', (_req: Request, res: Response) => {
    res.json({ logs: store.getSecurityLogs(40) });
  });

  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.statusCode).json({
        error: {
          code: err.code,
          message: err.message,
          requiresReverification: Boolean(err.requiresReverification),
        },
      });
      return;
    }
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred while processing your table request.',
      },
    });
  });

  return router;
}
