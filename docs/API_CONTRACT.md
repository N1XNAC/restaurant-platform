# Restaurant Platform — API Contract (v1)

Shared backend for **both** the customer-facing website and the restaurant operations app.

There are two API surfaces on the same server and the same database:

| Surface | Prefix | Money | Used by |
|---|---|---|---|
| Platform API | `/api/v1` | integer **cents** | restaurant operations app, integrations |
| Customer compatibility API | `/api` | **dollars** (numbers) | bundled `customer-site/` application |

- Base URL (local dev): `http://localhost:4000`
- All monetary values are server-calculated. Never send or trust client-side totals.
- The backend is the source of truth. Prices, tax, service charge and totals are always recalculated server-side.

---

## 1. Authentication (restaurant staff only)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/v1/auth/login` | none | Body: `{ email, password }`. Returns `{ token, user, restaurant }`. Also sets `access_token` httpOnly cookie. |
| POST | `/api/v1/auth/logout` | staff | Clears session cookie. |
| GET | `/api/v1/auth/me` | staff | Returns `{ user, restaurant }`. |

Send the token either as `Authorization: Bearer <token>` or rely on the cookie (`credentials: 'include'`).

**Roles:** `OWNER`, `ADMIN`, `MANAGER`, `WAITER`, `KITCHEN_STAFF`.
Every staff endpoint enforces both role permission **and** restaurant isolation on the backend. A token for restaurant A can never read or write restaurant B's data.

---

## 2. Public endpoints (customer website)

These need no authentication. They are the only surface the customer app should depend on.

### 2.1 Get restaurant menu
```
GET /api/v1/public/restaurants/:slug/menu
```
`:slug` is the restaurant slug (e.g. `bistro-lumiere`); the restaurant id also works.

Returns:
```json
{
  "restaurant": { "id": "...", "name": "...", "slug": "...", "currency": "USD", "taxRateBps": 850, "serviceChargeBps": 500 },
  "categories": [ { "id": "...", "name": "Starters", "description": "...", "sortOrder": 1, "isActive": true } ],
  "items": [
    {
      "id": "...",
      "categoryId": "...",
      "name": "Margherita Classica",
      "description": "...",
      "priceCents": 1650,
      "prepTimeMinutes": 12,
      "dietaryType": "VEG",
      "allergens": ["Dairy", "Gluten"],
      "imageUrl": "/uploads/xxxx.png",
      "isAvailable": true,
      "variations": [ { "id": "...", "name": "Large 16\"", "priceDeltaCents": 550, "isAvailable": true } ],
      "extras": [ { "id": "...", "name": "Extra Burrata", "priceCents": 450, "isAvailable": true } ]
    }
  ]
}
```
Only `isAvailable: true` items and active categories are returned.

### 2.2 Resolve / validate a table
```
GET /api/v1/public/restaurants/:slug/tables/:tableNumber
```
`:tableNumber` may be the table id or the human table number (`T-01`). Returns `{ table, restaurantId }`. 404 if the table is unknown or inactive **for that restaurant**.

### 2.3 Place an order  ← key endpoint
```
POST /api/v1/public/restaurants/:slug/orders
Idempotency-Key: <unique string>      # REQUIRED (header). Prevents duplicate orders on retry.
```
Body:
```json
{
  "tableId": "cmwhzpsik000bee59y9w81dyb",
  "notes": "No olives please",
  "items": [
    {
      "menuItemId": "...",
      "quantity": 2,
      "variationId": "...",          // optional
      "extraIds": ["..."],           // optional, default []
      "specialInstructions": "Extra crispy"
    }
  ]
}
```

Backend behaviour:
1. Validates the table belongs to this restaurant and is active.
2. Validates every `menuItemId` / `variationId` / `extraIds` against this restaurant's **available** menu.
3. Computes `subtotalCents`, `taxCents` (restaurant `taxRateBps`), `serviceChargeCents` (restaurant `serviceChargeBps`, applied to the subtotal only) and `totalCents` server-side.
4. Creates the order in status `NEW` inside a DB transaction, flips the table to `OCCUPIED` if it was `AVAILABLE`/`RESERVED`, writes a status-history row and a `NEW_ORDER` notification.
5. Emits realtime event `order.created`.

Response `201`:
```json
{ "order": { "id": "...", "orderNumber": "ORD-...", "status": "NEW", "subtotalCents": 3300, "taxCents": 281, "serviceChargeCents": 165, "totalCents": 3746, "items": [...] }, "deduplicated": false }
```

If the same `Idempotency-Key` is replayed, the original order is returned with `200` and `"deduplicated": true`.

### 2.4 Track an order
```
GET /api/v1/public/orders/:id
```
Returns the full order with `table` and `items`.

### 2.5 Submit a review
```
POST /api/v1/public/restaurants/:slug/reviews
```
Body: `{ orderId?: string, customerName: string, rating: 1..5, comment?: string }`.
Emits `review.created` and a `NEW_REVIEW` notification for the restaurant.

---

## 3. Realtime channel (WebSocket)

```
ws://localhost:4000/api/v1/realtime?token=<jwt>&lastSequence=<n>
```
The token may also be supplied via the `access_token` cookie.

Every frame uses the same envelope:
```json
{
  "eventId": "uuid",
  "sequence": 42,
  "type": "order.created",
  "restaurantId": "...",
  "timestamp": "2026-01-01T00:00:00.000Z",
  "payload": { }
}
```

**Event types**

| type | payload | fired when |
|---|---|---|
| `order.created` | `{ order }` | customer submits an order |
| `order.updated` | `{ order }` | status / payment / refund changes |
| `order.item_updated` | `{ orderId, item, order }` | kitchen marks an item ready |
| `table.updated` | `{ table }` | table created / status changed / deleted |
| `menu.updated` | `{ entity, id, isAvailable?, archived? }` | dish or category changed |
| `inventory.low_stock` | `{ ingredientId, name, stockQty, lowStockThreshold }` | stock drops to/below threshold |
| `review.created` | `{ review }` | customer posts a review |
| `notification.created` | `{ type, ... }` | any new in-app notification |

**Reconnection & duplicate prevention**
- Events are persisted in the `RealtimeEvent` table with a monotonically increasing `sequence`.
- On reconnect, pass the last `sequence` you processed; the server replays everything after it.
- Also de-duplicate by `eventId` client-side. The backend guarantees each `eventId` is emitted once.
- The database is the source of truth: always reconcile with `GET /api/v1/orders?since=<iso>` after a reconnect.

---

## 4. Staff endpoints (restaurant app)

All require staff auth + role + restaurant isolation.

### Orders
| Method | Path | Roles |
|---|---|---|
| GET | `/api/v1/orders?status=NEW,ACCEPTED&tableId=&since=` | all staff |
| GET | `/api/v1/orders/:id` | all staff |
| PATCH | `/api/v1/orders/:id/status` | see matrix below |
| PATCH | `/api/v1/orders/:orderId/items/:itemId/status` | OWNER/ADMIN/MANAGER/KITCHEN_STAFF/WAITER |
| POST | `/api/v1/orders/:id/payments` | OWNER/ADMIN/MANAGER/WAITER |
| POST | `/api/v1/orders/:id/refunds` | OWNER/ADMIN/MANAGER |

**Order lifecycle**
```
NEW -> ACCEPTED -> PREPARING -> READY -> SERVED -> COMPLETED
  \-> REJECTED        (terminal)
  \-> CANCELLED       (from NEW/ACCEPTED/PREPARING/READY)
```
Invalid jumps (e.g. `NEW -> COMPLETED`) return `409`.

**Status role matrix**

| Target status | Allowed roles |
|---|---|
| `ACCEPTED`, `REJECTED` | OWNER, ADMIN, MANAGER, WAITER, KITCHEN_STAFF |
| `PREPARING`, `READY` | OWNER, ADMIN, MANAGER, KITCHEN_STAFF |
| `SERVED`, `COMPLETED` | OWNER, ADMIN, MANAGER, WAITER |
| `CANCELLED` | OWNER, ADMIN, MANAGER, WAITER |

Inventory is deducted exactly once, when the order moves to `ACCEPTED` (guarded by a unique `deductionKey`).

### Tables
| Method | Path | Roles |
|---|---|---|
| GET | `/api/v1/tables` | all staff (includes `activeOrdersCount`, `outstandingCents`) |
| POST | `/api/v1/tables` | OWNER, ADMIN, MANAGER |
| PATCH | `/api/v1/tables/:id` | OWNER, ADMIN, MANAGER |
| PATCH | `/api/v1/tables/:id/status` | OWNER, ADMIN, MANAGER, WAITER |
| DELETE | `/api/v1/tables/:id` | OWNER, ADMIN, MANAGER |

Table status: `AVAILABLE | OCCUPIED | RESERVED | CLEANING`.
Setting `AVAILABLE` returns `409` while active orders remain. Deleting a table with historical orders deactivates it instead of hard-deleting.

### Menu
| Method | Path | Roles |
|---|---|---|
| GET | `/api/v1/menu` | all staff |
| POST/PATCH/DELETE | `/api/v1/menu/categories[/:id]` | OWNER, ADMIN, MANAGER |
| POST/PATCH/DELETE | `/api/v1/menu/items[/:id]` | OWNER, ADMIN, MANAGER |
| PATCH | `/api/v1/menu/items/:id/availability` | OWNER, ADMIN, MANAGER, KITCHEN_STAFF |
| POST | `/api/v1/menu/upload` | OWNER, ADMIN, MANAGER (multipart `file`, PNG/JPEG/WEBP, max 5 MB) |

Deleting a dish archives it (`isArchived: true`) so historical order items keep their snapshots.

### Inventory
| Method | Path | Roles |
|---|---|---|
| GET | `/api/v1/inventory/ingredients` | all staff |
| POST/PATCH | `/api/v1/inventory/ingredients[/:id]` | OWNER, ADMIN, MANAGER |
| POST | `/api/v1/inventory/adjustments` | OWNER, ADMIN, MANAGER, KITCHEN_STAFF |
| GET | `/api/v1/inventory/transactions` | all staff |

Adjustment types: `PURCHASE`, `RESTOCK`, `ADJUSTMENT`, `WASTAGE`, `CONSUMPTION`.

### Analytics, expenses, refunds
| Method | Path | Roles |
|---|---|---|
| GET | `/api/v1/analytics/summary?range=today\|yesterday\|7d\|30d\|month\|custom&from=&to=` | all staff |
| GET | `/api/v1/analytics/export.csv?range=...` | OWNER, ADMIN, MANAGER |
| GET/POST | `/api/v1/expenses` | GET: all staff · POST: OWNER, ADMIN, MANAGER |
| DELETE | `/api/v1/expenses/:id` | OWNER, ADMIN, MANAGER |

`summary` returns `kpis` (gross/discount/refund/net sales, taxes, service charges, COGS, opex, gross profit, net profit, order counts, AOV, tables), `popularDishes`, `revenueByCategory`, `hourlySeries`, `recentOrders`, `recentReviews`.
Cancelled and rejected orders are excluded from sales figures.

### Reviews, staff, audit, notifications
| Method | Path | Roles |
|---|---|---|
| GET | `/api/v1/reviews` | all staff |
| POST | `/api/v1/reviews/:id/reply` | OWNER, ADMIN, MANAGER |
| GET/POST/PATCH | `/api/v1/staff[/:id]` | GET: OWNER/ADMIN/MANAGER · POST/PATCH: OWNER/ADMIN |
| GET | `/api/v1/audit-logs` | OWNER, ADMIN, MANAGER |
| GET | `/api/v1/notifications` | all staff |
| PATCH | `/api/v1/notifications/:id/read` | all staff |
| POST | `/api/v1/notifications/read-all` | all staff |

---

## 5. Error format

All errors use:
```json
{ "error": { "code": "CONFLICT", "message": "Cannot mark table AVAILABLE while 1 active order(s) remain", "details": {} } }
```
Codes: `BAD_REQUEST`, `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `INTERNAL_SERVER_ERROR`.

---

## 6. Static uploads

Uploaded images are served from `GET /uploads/<filename>`.

The customer-facing website is served from the same origin at `GET /` (see section 8).

---

## 7. Customer website compatibility API (`customer-site/`)

The bundled customer app (`customer-site/`) was built against its own contract. The backend
implements that contract verbatim, backed by the same database the restaurant app uses, so a
customer order appears live in the restaurant dashboard and status changes flow both ways.

All paths below are relative to the backend origin (e.g. `http://localhost:4000`) and need no
authentication (they are identified by an HMAC-signed table session).

**Money is expressed in dollars (numbers) on this surface**, unlike `/api/v1` which uses cents.

### 7.1 Table session
| Method | Path | Body |
|---|---|---|
| GET | `/api/session/demo-tokens` | – (returns `{ presets: [...] }` placard directory, no PINs) |
| POST | `/api/session/validate` | `{ token, gps? }` → `{ session }` |
| POST | `/api/session/verify-location` | `{ sessionId, sessionSignature, gps }` → `{ session }` |
| POST | `/api/session/verify-challenge` | `{ sessionId, sessionSignature, pin }` → `{ session }` |

`session` contains `sessionId`, `sessionSignature`, `restaurantId`, `tableId`, `tableNumber`,
`tableLabel`, `seats`, `entryMethod`, `restaurant { restaurantId, name, tagline, cuisine, address,
phone, hours, isActive, taxRate, serviceChargeRate, coordinates { lat, lng }, geofenceRadiusMeters }`,
`locationStatus`, `distanceMeters`, `requiresAdditionalVerification`, `challengeVerified`,
`createdAt`, `expiresAt`.

Behaviour:
- Unknown token → `401 INVALID_TOKEN`; inactive placard → `401 EXPIRED_TOKEN`.
- Sessions last 4 hours. The signature is an HMAC over `sessionId:restaurantId:tableId`, so a
  browser cannot swap the table or restaurant in later calls.
- If the guest's GPS is outside the geofence the session is flagged and ordering is blocked with
  `403 LOCATION_VERIFICATION_REQUIRED` until the 4-digit placard PIN is verified.

### 7.2 Menu
```
GET /api/restaurant/:restaurantId/menu?search=&category=&dietary=
GET /api/menu/items/:itemId
```
`:restaurantId` accepts the restaurant id returned by `/api/session/validate`, its slug, or the
legacy alias `REST_001`. Response: `{ restaurant, categories, items }` where each item has
`id, name, description, category, price (dollars), image, fallbackImage, isAvailable, dietary
(veg | non-veg | vegan), prepTimeMinutes, allergens, customizations[{ id, name, required, choices[{ id, label, priceDelta }] }]`.

Only available, non-archived dishes are returned. Restaurant categories are mapped onto the
customer vocabulary (`Wood-Fired Pizza` → `Wood-Fired`).

### 7.3 Orders
```
POST /api/orders
GET  /api/orders/:orderId
POST /api/orders/:orderId/cancel
```
Order submission body:
```json
{
  "restaurantId": "...", "tableId": "...",
  "sessionId": "...", "sessionSignature": "...",
  "idempotencyKey": "unique-client-key",
  "orderMode": "table_cart | only_this",
  "items": [
    { "itemId": "...", "quantity": 2,
      "selectedOptions": [
        { "groupId": "variations", "choiceId": "..." },
        { "groupId": "extras", "choiceId": "..." }
      ],
      "notes": "No onions" }
  ]
}
```
The server ignores any client price and rebuilds every line from the database. `restaurantId` /
`tableId` must match the session (`403 TABLE_MISMATCH` otherwise).

Response `201` (or `200` when the `idempotencyKey` was already used):
```json
{ "order": { "orderId": "...", "status": "RECEIVED", "subtotal": 60, "taxAmount": 5.1,
             "serviceCharge": 3, "grandTotal": 68.1, "cancellableUntil": "...", "items": [...] },
  "message": "Your order has been successfully placed!" }
```
Status mapping: internal `NEW`/`ACCEPTED` → `RECEIVED`, `PREPARING` → `PREPARING`, `READY` → `READY`,
`SERVED`/`COMPLETED` → `SERVED`, `CANCELLED`/`REJECTED` → `CANCELLED`.

Cancellation is allowed for 2 minutes after submission while the order is still `NEW`/`ACCEPTED`,
and only by the session that placed it (`403 ORDER_OWNERSHIP_MISMATCH` otherwise). Late attempts
return `409 CANCELLATION_WINDOW_CLOSED` / `409 ORDER_ALREADY_PREPARED`.

### 7.4 Restaurant management integration
```
GET   /api/integration/orders?restaurantId=&limit=
PATCH /api/integration/orders/:orderId/status   body { "status": "RECEIVED|PREPARING|READY|SERVED|CANCELLED" }
```
Pull/push surface for an external management system. If `INTEGRATION_API_KEY` is configured, send it
as the `X-Integration-Key` header. Status pushes emit the same `order.updated` realtime event the
restaurant app consumes.

### 7.5 Errors
Customer endpoints use the customer envelope:
```json
{ "error": { "code": "TABLE_MISMATCH", "message": "...", "requiresReverification": true } }
```

### 7.6 Running the customer website
- **Same origin (default):** start the backend and open <http://localhost:4000/>. The app is served
  statically and its relative `/api/...` calls hit the same server.
- **Separately hosted (Netlify and a separate API host):** host `customer-site/` on its own site,
  deploy `frontend/` on another, and set the API origin at build time. See
  [DEPLOYMENT.md](DEPLOYMENT.md). The customer build writes
  `window.__MV_CONFIG__ = { apiBaseUrl: "https://api.example.com" }` before `js/config.js`, which is
  the runtime override the app already supports. No code changes are needed.
- **Separately hosted (manual):** host `customer-site/` on any static host, set its
  `<meta name="api-base-url" content="http://localhost:4000">` (or `window.__MV_CONFIG__.apiBaseUrl`),
  and add that origin to `CORS_ORIGIN` in `backend/.env`.

Menu `image` URLs in this surface are absolute (`https://api.example.com/uploads/...`) whenever the
request reaches the backend through a different host, so photos keep working when the site and the
API live on different domains. Values in the database remain origin-relative.

Demo placards (customer app **Table Info** dialog):

| Token | Table | Method | PIN |
|---|---|---|---|
| `QR_MV_T08_VALID` | T-08 | QR | 4082 |
| `NFC_MV_T04_VALID` | T-04 | NFC | 4041 |
| `QR_MV_T12_VALID` | T-12 | QR | 4126 |
| `QR_MV_EXPIRED` | T-02 | QR | – (expired example) |

---

## 8. Changelog / versioning

Breaking changes bump the `/api/v1` prefix to `/api/v2`. Additive changes (new optional fields, new endpoints) are safe within v1.
