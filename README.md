# Restaurant Management Platform

Two-sided restaurant ordering platform. This repository contains the **shared backend**, the
**restaurant operations website** (dashboard, kitchen, tables, menu, inventory, analytics, staff),
and the **customer-facing ordering website** that was built separately against the documented
contract in [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md). Both websites run on one database, so a
guest order appears in the restaurant dashboard in real time and status changes flow back to the
guest.

```
restaurant-platform/
├── backend/        Fastify + TypeScript + Prisma  (shared API, REST + WebSocket)
│                   also serves uploaded images (and the customer site in same-origin mode)
├── customer-site/  Netlify site A — diner ordering website (plain HTML/CSS/JS)
│                   netlify.toml + README.md, build via deploy/netlify/
├── frontend/       Netlify site B — staff operations & statistics website
│                   React 19 + Vite + Tailwind v4, netlify.toml + README.md
├── deploy/
│   └── netlify/    two build/deploy helpers + the two-site hosting guide
├── reference/
│   └── maison-verbena/   the customer app's original standalone Express server, kept for reference
├── docs/
│   ├── API_CONTRACT.md   <- both API surfaces, share with integrators
│   └── DEPLOYMENT.md     <- two Netlify sites + backend hosting
└── package.json    convenience scripts
```

---

## Tech stack

| Layer | Choice |
|---|---|
| Runtime | Node.js 22+ (tested on v26) |
| API | Fastify 5 + Zod validation |
| ORM | Prisma 6 |
| Database | SQLite for local dev (swap the datasource to PostgreSQL for production) |
| Auth | JWT (httpOnly cookie + Bearer token), bcrypt password hashing |
| Real-time | WebSocket (`/api/v1/realtime`) with persisted sequence numbers for replay |
| Frontend | React 19, TypeScript, Vite 6, Tailwind CSS v4, TanStack Query, Recharts |
| Tests | Vitest + Fastify `inject` |

All money is stored as **integer cents**. There is no floating-point currency arithmetic anywhere.

---

## Quick start

### 1. Backend

```bash
cd backend
npm install
npm run db:push        # create/refresh the SQLite schema
npm run db:seed        # seed demo restaurant, staff, tables, menu, ingredients
npm run dev            # http://localhost:4000
```

### 2. Restaurant website

```bash
cd frontend
npm install
npm run dev            # http://localhost:5173
```

Vite proxies `/api` and `/uploads` (including WebSocket upgrades) to `localhost:4000`.

### 3. Customer website

The backend serves `customer-site/` from its own origin:

```
http://localhost:4000/            home
http://localhost:4000/menu.html   full menu
http://localhost:4000/cart.html   table cart
```

Its relative `/api/...` calls therefore hit the same server, with no CORS setup. To host the
customer site separately instead, set its `<meta name="api-base-url">` to the backend origin and add
that origin to `CORS_ORIGIN`. The customer app binds a table through a QR/NFC placard — the demo
placards are listed in [docs/API_CONTRACT.md](docs/API_CONTRACT.md#76-running-the-customer-website)
(`QR_MV_T08_VALID`, PIN `4082`, …).

### 4. Or run both from the repo root

```bash
npm run dev:backend
npm run dev:frontend
```

### 5. Host the two websites separately

Both sites can be deployed to their own Netlify site (or subdomain), with the
backend on a host that supports WebSockets and a persistent disk. See
**[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** for the full walkthrough and the
exact environment variables.

---

## Demo accounts

Password for all: `Password123!`

| Role | Email | Can do |
|---|---|---|
| OWNER | `owner@bistro.local` | Everything |
| ADMIN | `admin@bistro.local` | Admin + staff management |
| MANAGER | `manager@bistro.local` | Orders, tables, menu, reports |
| WAITER | `waiter@bistro.local` | Accept / serve / complete / payment |
| KITCHEN_STAFF | `kitchen@bistro.local` | Kitchen prep, item readiness, menu availability |

---

## Try the live order flow end to end

**Customer side → restaurant side**

1. Open <http://localhost:4000/>. The app binds table **T-08** from the demo placard.
2. Add a dish (with options/extras) to the table cart and place the order.
3. The ticket appears instantly on the restaurant **Live Orders** board, in the **Kitchen Display**,
   and the notification bell shows `NEW_ORDER` — delivered over the WebSocket, not by polling.
4. Advance it in the restaurant app: Accept → Start Prep → Mark Ready → Mark Served → Complete.
   The customer confirmation page shows the same progression (`RECEIVED → PREPARING → READY → SERVED`)
   and the cancel button disappears once the kitchen starts.

**Restaurant side self-test**

1. Log in as `waiter@bistro.local` at <http://localhost:5173>.
2. Open **Live Orders** and click **Place Test Customer Order** (this uses the public API).
3. Accept it and watch **Inventory** drop exactly once, and **Analytics** update immediately.

---

## Feature map

| Area | Where |
|---|---|
| Operational dashboard, KPIs, date filters, charts | `frontend/src/pages/DashboardPage.tsx` |
| Live order management + lifecycle actions | `frontend/src/pages/OrdersPage.tsx` |
| Kitchen display (item-level prep, delay highlight) | `frontend/src/pages/KitchenPage.tsx` |
| Table management (occupancy, outstanding totals) | `frontend/src/pages/TablesPage.tsx` |
| Menu management (dish CRUD, image upload, availability) | `frontend/src/pages/MenuPage.tsx` |
| Inventory (stock, adjustments, wastage, transactions) | `frontend/src/pages/InventoryPage.tsx` |
| Sales & profit analytics (P&L, expenses, CSV export) | `frontend/src/pages/AnalyticsPage.tsx` |
| Reviews + responses | `frontend/src/pages/ReviewsPage.tsx` |
| Staff management + audit log | `frontend/src/pages/StaffPage.tsx` |
| Restaurant settings (tagline, hours, tax rate, service charge, currency) | `frontend/src/pages/SettingsPage.tsx` |

---

## Tests

```bash
cd backend && npm test
```

Covers: order creation with server-side totals, invalid table rejection, idempotent duplicate
prevention, status-transition validation, role-based permission matrix, restaurant isolation,
single-time inventory deduction, payment + partial/full refund handling, and exclusion of
cancelled orders from sales analytics.

`tests/customer-compat.test.ts` additionally exercises the customer website contract end to end:
placard validation and HMAC-signed sessions, geofence + placard PIN challenge, menu vocabulary and
dollar pricing, server-side price tampering rejection, idempotency, ownership-scoped cancellation,
status mapping in both directions, and static hosting of `customer-site/`.

---

## Production notes

* Deploy the two websites to Netlify as **two separate sites with different
  domains**, both pointing at the same backend:
  - **Site A — ordering** (`customer-site/`, e.g. `order.example.com`)
  - **Site B — operations & statistics** (`frontend/`, e.g. `admin.example.com`)
  
  Netlify base dir, build command and env var for each are in
  [deploy/netlify/README.md](deploy/netlify/README.md); the full walkthrough is
  [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Each site has its own `netlify.toml`
  and fails the build if its API-origin variable is missing.
* The backend needs a long-lived process, WebSockets and a persistent disk, so
  run it on Fly.io/Render/Railway/a VPS rather than Netlify. A `backend/Dockerfile`
  is included.
* Change `DATABASE_URL` in `backend/.env` to a PostgreSQL connection string and set
  `provider = "postgresql"` in `backend/prisma/schema.prisma`.
* Set a strong `JWT_SECRET`, `COOKIE_SECRET` and `SESSION_HMAC_SECRET` (used to sign customer table sessions).
* Set `CORS_ORIGIN` to the exact origins of the customer website.
* Set `INTEGRATION_API_KEY` if an external management system uses `/api/integration/*`.
* Serve uploaded images from object storage rather than the local `uploads/` directory.
* Run the API behind TLS so the `access_token` cookie can use `Secure`.
