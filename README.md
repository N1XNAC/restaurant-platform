# Restaurant Management Platform

Two-sided restaurant ordering platform. This repository contains the **shared backend** and the
**restaurant operations website** (dashboard, kitchen, tables, menu, inventory, analytics, staff).
The customer-facing website is a separate application that talks to the same backend over the
documented API contract in [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md).

```
restaurant-platform/
├── backend/        Fastify + TypeScript + Prisma  (shared API, REST + WebSocket)
├── frontend/       React 19 + Vite + Tailwind v4  (restaurant operations website)
├── docs/
│   └── API_CONTRACT.md   <- share this with the customer-side developer
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

### 3. Or run both from the repo root

```bash
npm run dev:backend
npm run dev:frontend
```

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

1. Log in as `waiter@bistro.local` at <http://localhost:5173>.
2. Open **Live Orders** and click **Place Test Customer Order**. This hits the *public* customer
   endpoint (`POST /api/v1/public/restaurants/:slug/orders`) — exactly the endpoint the customer
   website will use.
3. The order appears in real time on the **Live Orders** board, in the **Kitchen Display**, and the
   notification bell shows a `NEW_ORDER` notification.
4. Advance it: Accept → Start Prep → Mark Ready → Mark Served → Complete Order.
5. Watch **Inventory** — dough/tomato/mozzarella stock drops exactly once when the order is
   accepted. **Analytics** reflects the sale immediately.

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
| Restaurant settings (tax rate, currency) | `frontend/src/pages/SettingsPage.tsx` |

---

## Tests

```bash
cd backend && npm test
```

Covers: order creation with server-side totals, invalid table rejection, idempotent duplicate
prevention, status-transition validation, role-based permission matrix, restaurant isolation,
single-time inventory deduction, payment + partial/full refund handling, and exclusion of
cancelled orders from sales analytics.

---

## Production notes

* Change `DATABASE_URL` in `backend/.env` to a PostgreSQL connection string and set
  `provider = "postgresql"` in `backend/prisma/schema.prisma`.
* Set a strong `JWT_SECRET` and `COOKIE_SECRET`.
* Set `CORS_ORIGIN` to the exact origins of the customer website.
* Serve uploaded images from object storage rather than the local `uploads/` directory.
* Run the API behind TLS so the `access_token` cookie can use `Secure`.
