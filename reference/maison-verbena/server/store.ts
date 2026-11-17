import fs from 'node:fs';
import path from 'node:path';
import {
  calculateOrderBreakdown,
  computeEffectiveUnitPrice,
} from './pricing';
import type {
  MenuItem,
  OrderLineItem,
  OrderRecord,
  OrderStatus,
  RestaurantInfo,
  SelectedOption,
  TableSession,
} from './types';
import { MENU_CATALOG, RESTAURANTS, TABLE_TOKENS } from './catalog';
import {
  evaluateGeofence,
  generateSecureId,
  signSessionBinding,
  verifySessionSignature,
  type SecurityEventType,
  type SecurityLogEntry,
} from './security';

interface IntegrationOutboxEvent {
  eventId: string;
  eventType: 'ORDER_CREATED' | 'ORDER_CANCELLED' | 'ORDER_STATUS_UPDATED';
  createdAt: string;
  order: OrderRecord;
}

interface PersistedDatabase {
  sessions: Record<string, TableSession>;
  orders: Record<string, OrderRecord>;
  idempotencyMap: Record<string, string>;
  securityLogs: SecurityLogEntry[];
  outbox: IntegrationOutboxEvent[];
}

const DEFAULT_DB_PATH = path.resolve(process.cwd(), 'server/data/runtime-store.json');

export class HttpError extends Error {
  statusCode: number;
  code: string;
  requiresReverification?: boolean;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    requiresReverification = false
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.requiresReverification = requiresReverification;
  }
}

export class RestaurantStore {
  private dbPath: string;
  private state: PersistedDatabase;
  private invalidTokenAttempts: Map<string, number> = new Map();

  constructor(dbPath = DEFAULT_DB_PATH) {
    this.dbPath = dbPath;
    this.state = this.loadState();
  }

  private loadState(): PersistedDatabase {
    try {
      if (fs.existsSync(this.dbPath)) {
        const raw = fs.readFileSync(this.dbPath, 'utf8');
        const parsed = JSON.parse(raw) as Partial<PersistedDatabase>;
        return {
          sessions: parsed.sessions ?? {},
          orders: parsed.orders ?? {},
          idempotencyMap: parsed.idempotencyMap ?? {},
          securityLogs: Array.isArray(parsed.securityLogs) ? parsed.securityLogs : [],
          outbox: Array.isArray(parsed.outbox) ? parsed.outbox : [],
        };
      }
    } catch {
      // Fallback cleanly to fresh DB if corrupt
    }
    return {
      sessions: {},
      orders: {},
      idempotencyMap: {},
      securityLogs: [],
      outbox: [],
    };
  }

  private persist(): void {
    try {
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const tempPath = `${this.dbPath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(this.state, null, 2), 'utf8');
      fs.renameSync(tempPath, this.dbPath);
    } catch {
      // Non-fatal in read-only test contexts
    }
  }

  recordSecurityEvent(params: {
    eventType: SecurityEventType;
    severity: 'info' | 'warning' | 'critical';
    clientIp: string;
    restaurantId?: string;
    tableId?: string;
    sessionId?: string;
    detail: string;
  }): SecurityLogEntry {
    const entry: SecurityLogEntry = {
      id: generateSecureId('SEC'),
      timestamp: new Date().toISOString(),
      ...params,
    };
    this.state.securityLogs.unshift(entry);
    if (this.state.securityLogs.length > 250) {
      this.state.securityLogs.length = 250;
    }
    this.persist();
    return entry;
  }

  getSecurityLogs(limit = 50): SecurityLogEntry[] {
    return this.state.securityLogs.slice(0, limit);
  }

  validateQrNfcToken(params: {
    token: string;
    gps?: { lat?: number; lng?: number; accuracy?: number } | null;
    clientIp: string;
  }): TableSession {
    const cleanToken = (params.token || '').trim();
    const tokenDef = TABLE_TOKENS[cleanToken];

    if (!tokenDef) {
      const prevCount = this.invalidTokenAttempts.get(params.clientIp) ?? 0;
      const nextCount = prevCount + 1;
      this.invalidTokenAttempts.set(params.clientIp, nextCount);

      if (nextCount >= 3) {
        this.recordSecurityEvent({
          eventType: 'REPEATED_INVALID_TOKEN',
          severity: 'critical',
          clientIp: params.clientIp,
          detail: `Repeated invalid QR/NFC token attempts (${nextCount}x) using token prefix "${cleanToken.slice(0, 10)}"`,
        });
        throw new HttpError(
          429,
          'REPEATED_INVALID_TOKEN',
          'Multiple invalid table scan attempts detected. Please ask your server for assistance or scan the official table plaque.',
          true
        );
      }

      this.recordSecurityEvent({
        eventType: 'INVALID_TOKEN',
        severity: 'warning',
        clientIp: params.clientIp,
        detail: `Invalid QR/NFC token submitted ("${cleanToken.slice(0, 14)}")`,
      });
      throw new HttpError(
        401,
        'INVALID_TOKEN',
        'This QR code or NFC tag could not be verified. Please scan the plaque at your table.',
        true
      );
    }

    if (tokenDef.status !== 'active') {
      this.recordSecurityEvent({
        eventType: 'EXPIRED_TOKEN',
        severity: 'warning',
        clientIp: params.clientIp,
        restaurantId: tokenDef.restaurantId,
        tableId: tokenDef.tableId,
        detail: `Attempted session start with ${tokenDef.status} token ${cleanToken}`,
      });
      throw new HttpError(
        401,
        'EXPIRED_TOKEN',
        'This table QR code has expired. Please scan a fresh table placard or ask a host.',
        true
      );
    }

    const restaurant = RESTAURANTS[tokenDef.restaurantId];
    if (!restaurant || !restaurant.isActive) {
      throw new HttpError(
        503,
        'RESTAURANT_INACTIVE',
        'This dining room is not currently accepting digital table orders.'
      );
    }

    // Reset invalid attempt counter upon valid scan
    this.invalidTokenAttempts.delete(params.clientIp);

    const sessionId = generateSecureId('SESSION');
    const sessionSignature = signSessionBinding(
      sessionId,
      restaurant.restaurantId,
      tokenDef.tableId
    );

    const geoCheck = evaluateGeofence(restaurant, params.gps);
    if (geoCheck.status === 'flagged_outside_geofence') {
      this.recordSecurityEvent({
        eventType: 'OUTSIDE_GEOFENCE',
        severity: 'warning',
        clientIp: params.clientIp,
        restaurantId: restaurant.restaurantId,
        tableId: tokenDef.tableId,
        sessionId,
        detail: `Session flagged outside geofence (${geoCheck.distanceMeters}m vs ${restaurant.geofenceRadiusMeters}m radius). Secondary PIN verification required.`,
      });
    }

    const now = Date.now();
    const session: TableSession = {
      sessionId,
      sessionSignature,
      restaurantId: restaurant.restaurantId,
      tableId: tokenDef.tableId,
      tableNumber: tokenDef.tableNumber,
      tableLabel: tokenDef.tableLabel,
      seats: tokenDef.seats,
      entryMethod: tokenDef.entryMethod,
      restaurant,
      locationStatus: geoCheck.status,
      distanceMeters: geoCheck.distanceMeters,
      requiresAdditionalVerification: geoCheck.requiresAdditionalVerification,
      challengeVerified: !geoCheck.requiresAdditionalVerification,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 4 * 60 * 60 * 1000).toISOString(),
    };

    this.state.sessions[sessionId] = session;
    this.persist();
    return session;
  }

  getActiveSession(
    sessionId: string,
    sessionSignature: string,
    clientIp: string
  ): TableSession {
    const session = this.state.sessions[sessionId];
    if (!session) {
      this.recordSecurityEvent({
        eventType: 'MISSING_SESSION',
        severity: 'warning',
        clientIp,
        sessionId,
        detail: 'Request referenced an unknown or missing table session.',
      });
      throw new HttpError(
        401,
        'MISSING_SESSION',
        'Your table session was not found. Please scan your table QR code or tap NFC again.',
        true
      );
    }

    if (
      !verifySessionSignature(
        session.sessionId,
        session.restaurantId,
        session.tableId,
        sessionSignature
      )
    ) {
      this.recordSecurityEvent({
        eventType: 'TABLE_SPOOFING_ATTEMPT',
        severity: 'critical',
        clientIp,
        restaurantId: session.restaurantId,
        tableId: session.tableId,
        sessionId,
        detail: 'Invalid HMAC signature supplied for table session.',
      });
      throw new HttpError(
        403,
        'INVALID_SESSION_SIGNATURE',
        'Session integrity verification failed. Please re-scan your table QR code.',
        true
      );
    }

    if (Date.parse(session.expiresAt) <= Date.now()) {
      this.recordSecurityEvent({
        eventType: 'EXPIRED_SESSION',
        severity: 'warning',
        clientIp,
        restaurantId: session.restaurantId,
        tableId: session.tableId,
        sessionId,
        detail: 'Attempted action on an expired table session.',
      });
      throw new HttpError(
        401,
        'EXPIRED_SESSION',
        'Your 4-hour table session has expired. Please re-scan the table QR code.',
        true
      );
    }

    return session;
  }

  verifySessionLocation(params: {
    sessionId: string;
    sessionSignature: string;
    gps: { lat?: number; lng?: number; accuracy?: number } | null;
    clientIp: string;
  }): TableSession {
    const session = this.getActiveSession(
      params.sessionId,
      params.sessionSignature,
      params.clientIp
    );
    const restaurant = RESTAURANTS[session.restaurantId];
    const geoCheck = evaluateGeofence(restaurant, params.gps);

    session.locationStatus = geoCheck.status;
    session.distanceMeters = geoCheck.distanceMeters;
    if (geoCheck.status === 'verified') {
      session.requiresAdditionalVerification = false;
      session.challengeVerified = true;
    } else if (geoCheck.status === 'flagged_outside_geofence') {
      session.requiresAdditionalVerification = true;
      session.challengeVerified = false;
      this.recordSecurityEvent({
        eventType: 'OUTSIDE_GEOFENCE',
        severity: 'warning',
        clientIp: params.clientIp,
        restaurantId: session.restaurantId,
        tableId: session.tableId,
        sessionId: session.sessionId,
        detail: `Customer location check outside geofence (${geoCheck.distanceMeters}m from dining room).`,
      });
    }

    this.state.sessions[session.sessionId] = session;
    this.persist();
    return session;
  }

  verifyTableChallenge(params: {
    sessionId: string;
    sessionSignature: string;
    pin: string;
    clientIp: string;
  }): TableSession {
    const session = this.getActiveSession(
      params.sessionId,
      params.sessionSignature,
      params.clientIp
    );
    const tokenDef = Object.values(TABLE_TOKENS).find(
      (t) =>
        t.restaurantId === session.restaurantId &&
        t.tableId === session.tableId &&
        t.status === 'active'
    );

    if (!tokenDef || params.pin.trim() !== tokenDef.placardPin) {
      this.recordSecurityEvent({
        eventType: 'CHALLENGE_FAILED',
        severity: 'warning',
        clientIp: params.clientIp,
        restaurantId: session.restaurantId,
        tableId: session.tableId,
        sessionId: session.sessionId,
        detail: 'Incorrect 4-digit table placard PIN entered during location challenge.',
      });
      throw new HttpError(
        403,
        'CHALLENGE_FAILED',
        'That table placard code does not match. Check the 4-digit code printed under your table QR.',
        true
      );
    }

    session.challengeVerified = true;
    session.requiresAdditionalVerification = false;
    this.state.sessions[session.sessionId] = session;
    this.recordSecurityEvent({
      eventType: 'CHALLENGE_PASSED',
      severity: 'info',
      clientIp: params.clientIp,
      restaurantId: session.restaurantId,
      tableId: session.tableId,
      sessionId: session.sessionId,
      detail: 'Customer verified physical presence using 4-digit table placard PIN.',
    });
    this.persist();
    return session;
  }

  getRestaurantMenu(restaurantId: string): {
    restaurant: RestaurantInfo;
    items: MenuItem[];
  } {
    const restaurant = RESTAURANTS[restaurantId];
    if (!restaurant) {
      throw new HttpError(404, 'RESTAURANT_NOT_FOUND', 'Restaurant not found.');
    }
    const items = MENU_CATALOG.filter((item) => item.restaurantId === restaurantId);
    return { restaurant, items };
  }

  getMenuItem(itemId: string): MenuItem {
    const item = MENU_CATALOG.find((entry) => entry.id === itemId);
    if (!item) {
      throw new HttpError(404, 'MENU_ITEM_NOT_FOUND', 'Menu item not found.');
    }
    return item;
  }

  submitOrder(params: {
    restaurantId: string;
    tableId: string;
    sessionId: string;
    sessionSignature: string;
    idempotencyKey: string;
    orderMode: 'table_cart' | 'only_this';
    items: Array<{
      itemId: string;
      name?: string;
      quantity: number;
      unitPrice?: number;
      selectedOptions?: SelectedOption[];
      notes?: string;
    }>;
    clientIp: string;
  }): OrderRecord {
    const session = this.getActiveSession(
      params.sessionId,
      params.sessionSignature,
      params.clientIp
    );

    // Prevent manual restaurantId or tableId spoofing
    if (
      params.restaurantId !== session.restaurantId ||
      params.tableId !== session.tableId
    ) {
      this.recordSecurityEvent({
        eventType: 'TABLE_SPOOFING_ATTEMPT',
        severity: 'critical',
        clientIp: params.clientIp,
        restaurantId: session.restaurantId,
        tableId: session.tableId,
        sessionId: session.sessionId,
        detail: `Tampered identifiers in order payload: claimed ${params.restaurantId}/${params.tableId}, session bound to ${session.restaurantId}/${session.tableId}.`,
      });
      throw new HttpError(
        403,
        'TABLE_MISMATCH',
        'Table identification mismatch detected. Your session must be re-verified.',
        true
      );
    }

    const restaurant = RESTAURANTS[session.restaurantId];
    if (!restaurant || !restaurant.isActive) {
      throw new HttpError(
        503,
        'RESTAURANT_INACTIVE',
        'Kitchen service is paused at the moment. Please check with your host.'
      );
    }

    if (session.requiresAdditionalVerification && !session.challengeVerified) {
      this.recordSecurityEvent({
        eventType: 'OUTSIDE_GEOFENCE',
        severity: 'warning',
        clientIp: params.clientIp,
        restaurantId: session.restaurantId,
        tableId: session.tableId,
        sessionId: session.sessionId,
        detail: 'Blocked order submission until table placard PIN verification completes.',
      });
      throw new HttpError(
        403,
        'LOCATION_VERIFICATION_REQUIRED',
        'Please enter the 4-digit table placard code to verify you are seated at the restaurant.',
        true
      );
    }

    // Idempotency & duplicate submission protection
    const cleanIdempotencyKey = (params.idempotencyKey || '').trim();
    if (!cleanIdempotencyKey) {
      throw new HttpError(
        400,
        'MISSING_IDEMPOTENCY_KEY',
        'Missing submission request key. Please try confirming your order again.'
      );
    }

    const existingOrderId = this.state.idempotencyMap[cleanIdempotencyKey];
    if (existingOrderId && this.state.orders[existingOrderId]) {
      this.recordSecurityEvent({
        eventType: 'DUPLICATE_ORDER_ATTEMPT',
        severity: 'info',
        clientIp: params.clientIp,
        restaurantId: session.restaurantId,
        tableId: session.tableId,
        sessionId: session.sessionId,
        detail: `Prevented duplicate submission for idempotencyKey=${cleanIdempotencyKey} (existing ${existingOrderId}).`,
      });
      return this.state.orders[existingOrderId];
    }

    if (!Array.isArray(params.items) || params.items.length === 0) {
      throw new HttpError(400, 'EMPTY_ORDER', 'Order must include at least one dish.');
    }

    if (params.orderMode === 'only_this' && params.items.length > 1) {
      throw new HttpError(
        400,
        'INVALID_EXPRESS_ORDER',
        'Single-item express order can contain only one dish selection.'
      );
    }

    // Reconstruct every line item and price strictly from authoritative backend catalog
    const verifiedLines: OrderLineItem[] = [];
    let maxPrepMinutes = 8;

    for (const reqItem of params.items) {
      const qty = Math.floor(Number(reqItem.quantity));
      if (!Number.isInteger(qty) || qty < 1 || qty > 25) {
        throw new HttpError(
          400,
          'INVALID_QUANTITY',
          'Each dish quantity must be between 1 and 25.'
        );
      }

      const catalogItem = MENU_CATALOG.find(
        (m) => m.id === reqItem.itemId && m.restaurantId === session.restaurantId
      );
      if (!catalogItem) {
        throw new HttpError(
          400,
          'UNKNOWN_MENU_ITEM',
          `Menu item "${reqItem.itemId}" does not exist on this restaurant's menu.`
        );
      }
      if (!catalogItem.isAvailable) {
        this.recordSecurityEvent({
          eventType: 'UNAVAILABLE_ITEM_ATTEMPT',
          severity: 'warning',
          clientIp: params.clientIp,
          restaurantId: session.restaurantId,
          tableId: session.tableId,
          sessionId: session.sessionId,
          detail: `Customer attempted to order unavailable dish ${catalogItem.id} (${catalogItem.name}).`,
        });
        throw new HttpError(
          409,
          'ITEM_UNAVAILABLE',
          `"${catalogItem.name}" is sold out for tonight's service. Please remove it from your table order.`
        );
      }

      // Resolve authoritative customization choices from catalog
      const authoritativeOptions: SelectedOption[] = [];
      for (const reqOpt of reqItem.selectedOptions || []) {
        const group = catalogItem.customizations?.find(
          (g) => g.id === reqOpt.groupId
        );
        const choice = group?.choices.find((c) => c.id === reqOpt.choiceId);
        if (group && choice) {
          authoritativeOptions.push({
            groupId: group.id,
            groupName: group.name,
            choiceId: choice.id,
            choiceLabel: choice.label,
            priceDelta: choice.priceDelta,
          });
        }
      }

      const authoritativeUnitPrice = computeEffectiveUnitPrice(
        catalogItem.price,
        authoritativeOptions
      );

      if (
        typeof reqItem.unitPrice === 'number' &&
        Math.abs(reqItem.unitPrice - authoritativeUnitPrice) > 0.01
      ) {
        this.recordSecurityEvent({
          eventType: 'PRICE_TAMPERING_DETECTED',
          severity: 'critical',
          clientIp: params.clientIp,
          restaurantId: session.restaurantId,
          tableId: session.tableId,
          sessionId: session.sessionId,
          detail: `Frontend price mismatch ignored for ${catalogItem.id}: client sent ${reqItem.unitPrice}, authoritative price is ${authoritativeUnitPrice}.`,
        });
      }

      const lineTotal =
        (Math.round(authoritativeUnitPrice * 100) * qty) / 100;
      maxPrepMinutes = Math.max(maxPrepMinutes, catalogItem.prepTimeMinutes);

      verifiedLines.push({
        itemId: catalogItem.id,
        name: catalogItem.name,
        image: catalogItem.image,
        unitPrice: authoritativeUnitPrice,
        quantity: qty,
        lineTotal,
        selectedOptions: authoritativeOptions,
        notes: reqItem.notes ? String(reqItem.notes).trim().slice(0, 120) : undefined,
      });
    }

    const breakdown = calculateOrderBreakdown(
      verifiedLines.map((line) => ({
        unitPrice: line.unitPrice,
        quantity: line.quantity,
        selectedOptions: [], // already baked into authoritative line.unitPrice
      })),
      restaurant.taxRate,
      restaurant.serviceChargeRate
    );

    const nowMs = Date.now();
    const orderId = generateSecureId('ORDER');
    const order: OrderRecord = {
      orderId,
      restaurantId: restaurant.restaurantId,
      restaurantName: restaurant.name,
      tableId: session.tableId,
      tableNumber: session.tableNumber,
      tableLabel: session.tableLabel,
      sessionId: session.sessionId,
      items: verifiedLines,
      subtotal: breakdown.subtotal,
      taxAmount: breakdown.taxAmount,
      serviceCharge: breakdown.serviceCharge,
      grandTotal: breakdown.grandTotal,
      status: 'RECEIVED',
      orderMode: params.orderMode,
      locationStatus: session.locationStatus,
      createdAt: new Date(nowMs).toISOString(),
      updatedAt: new Date(nowMs).toISOString(),
      estimatedMinutes: maxPrepMinutes,
      cancellableUntil: new Date(nowMs + 2 * 60 * 1000).toISOString(),
    };

    this.state.orders[orderId] = order;
    this.state.idempotencyMap[cleanIdempotencyKey] = orderId;
    this.state.outbox.unshift({
      eventId: generateSecureId('EVT'),
      eventType: 'ORDER_CREATED',
      createdAt: order.createdAt,
      order,
    });
    if (this.state.outbox.length > 200) {
      this.state.outbox.length = 200;
    }

    this.persist();
    return order;
  }

  getOrder(orderId: string): OrderRecord {
    const order = this.state.orders[orderId];
    if (!order) {
      throw new HttpError(404, 'ORDER_NOT_FOUND', 'Order record could not be found.');
    }

    // Simulate realistic kitchen ticket progression for live status polling
    // while never mutating cancelled/served orders
    if (order.status !== 'CANCELLED' && order.status !== 'SERVED') {
      const elapsedSec = (Date.now() - Date.parse(order.createdAt)) / 1000;
      let nextStatus: OrderStatus = order.status;
      if (elapsedSec >= 35 && order.status === 'PREPARING') {
        nextStatus = 'READY';
      } else if (elapsedSec >= 12 && order.status === 'RECEIVED') {
        nextStatus = 'PREPARING';
      }
      if (nextStatus !== order.status) {
        order.status = nextStatus;
        order.updatedAt = new Date().toISOString();
        this.state.orders[orderId] = order;
        this.persist();
      }
    }

    return order;
  }

  cancelOrder(params: {
    orderId: string;
    sessionId: string;
    sessionSignature: string;
    reason?: string;
    clientIp: string;
  }): OrderRecord {
    const session = this.getActiveSession(
      params.sessionId,
      params.sessionSignature,
      params.clientIp
    );
    const order = this.getOrder(params.orderId);

    if (order.sessionId !== session.sessionId) {
      throw new HttpError(
        403,
        'ORDER_OWNERSHIP_MISMATCH',
        'Only the table session that placed this order may request cancellation.'
      );
    }

    if (order.status === 'CANCELLED') {
      return order;
    }

    if (order.status === 'READY' || order.status === 'SERVED') {
      throw new HttpError(
        409,
        'ORDER_ALREADY_PREPARED',
        'Your dishes are already plated or served and can no longer be cancelled digitally.'
      );
    }

    if (Date.now() > Date.parse(order.cancellableUntil)) {
      throw new HttpError(
        409,
        'CANCELLATION_WINDOW_CLOSED',
        'The kitchen fire window has passed. Please speak directly with your server for assistance.'
      );
    }

    order.status = 'CANCELLED';
    order.updatedAt = new Date().toISOString();
    order.cancellationReason =
      params.reason?.trim() || 'Cancelled by guest within kitchen grace window';

    this.state.orders[order.orderId] = order;
    this.state.outbox.unshift({
      eventId: generateSecureId('EVT'),
      eventType: 'ORDER_CANCELLED',
      createdAt: order.updatedAt,
      order,
    });
    this.persist();
    return order;
  }

  listIntegrationOrders(restaurantId?: string): OrderRecord[] {
    const all = Object.values(this.state.orders).sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
    );
    return restaurantId ? all.filter((o) => o.restaurantId === restaurantId) : all;
  }

  updateOrderStatusFromManagement(
    orderId: string,
    status: OrderStatus
  ): OrderRecord {
    const order = this.state.orders[orderId];
    if (!order) {
      throw new HttpError(404, 'ORDER_NOT_FOUND', 'Order not found.');
    }
    order.status = status;
    order.updatedAt = new Date().toISOString();
    this.state.orders[orderId] = order;
    this.state.outbox.unshift({
      eventId: generateSecureId('EVT'),
      eventType: 'ORDER_STATUS_UPDATED',
      createdAt: order.updatedAt,
      order,
    });
    this.persist();
    return order;
  }
}
