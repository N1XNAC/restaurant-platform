# What to set up, and where the files are

Short version: you need **Netlify (2 free sites) + one backend host (Render)**.
**Supabase is optional** — only if you want PostgreSQL instead of SQLite. The
code as committed runs on Render with a persistent disk and no Supabase.

```
diners ──> order.example.com   (Netlify site A: customer-site/)  ─┐
staff  ──> admin.example.com   (Netlify site B: frontend/)       ─┼──> api.example.com
                                                                   │    (Render: backend/)
                                                                   └──> one database
                                                                        (SQLite on disk,
                                                                         or Supabase Postgres)
```

---

## 1. Accounts / services

| Service | Needed? | What it hosts | Plan |
|---|---|---|---|
| **Netlify** | Yes, ×2 sites | the two static websites | Free |
| **Render** | Yes | the Fastify API, WebSocket, uploads, DB file | Starter + 1 GB disk (persistent disks are not on the free tier) |
| **Supabase** | Optional | PostgreSQL database only | Free is fine to start |
| Domain registrar | Optional | `order.` and `admin.` subdomains | — |

Minimum setup: **Netlify + Render**. Skip Supabase unless you specifically want
a managed Postgres with backups.

Alternatives to Render: Fly.io, Railway, or any VPS with Docker. Render is the
least clicking because `render.yaml` already describes the service.

---

## 2. File locations (this repo: `/home/nix/Projects/restaurant-platform`)

| Path | Used by | Purpose |
|---|---|---|
| `render.yaml` | Render | Blueprint: Docker build, `/data` disk, env vars |
| `backend/Dockerfile` | Render | Production image; runs `prisma db push` then the API |
| `backend/.dockerignore` | Render | Keeps tests/db/uploads out of the image |
| `backend/.env.example` | you | Every supported environment variable |
| `backend/prisma/schema.prisma` | API | Datasource: **SQLite** by default |
| `backend/prisma/dev.db` | local only | Local demo database (git-ignored) |
| `backend/uploads/` | local only | Local dish photos (git-ignored except demo seeds) |
| `customer-site/` | Netlify **site A** | Ordering website source |
| `customer-site/netlify.toml` | Netlify site A | Build command, publish dir, headers |
| `customer-site/README.md` | you | Site A host settings |
| `frontend/` | Netlify **site B** | Operations/statistics website source |
| `frontend/netlify.toml` | Netlify site B | Build command, publish dir, headers |
| `frontend/README.md` | you | Site B host settings |
| `frontend/src/lib/endpoints.ts` | site B | Resolves API/media/WebSocket origin |
| `customer-site/build.mjs` | Netlify site A | Copies site, injects `API_BASE_URL` |
| `deploy/netlify/build-customer-site.mjs` | CLI | Wrapper so the build runs from the repo root |
| `deploy/netlify/deploy-*.sh` | CLI | One-command deploys |
| `deploy/netlify/README.md` | you | Two-site map |
| `docs/DEPLOYMENT.md` | you | Full hosting walkthrough |
| `docs/API_CONTRACT.md` | integrators | Both API surfaces |

---

## 3. Render — the backend

### 3.1 Push the repo to GitHub

Render deploys from a Git repository.

```bash
cd /home/nix/Projects/restaurant-platform
git remote add origin git@github.com:<you>/restaurant-platform.git
git push -u origin main
```

### 3.2 Create the service from the blueprint

1. Render dashboard → **New → Blueprint** → select the repository.
2. Render reads `render.yaml`: Docker build from `backend/`, 1 GB disk at
   `/data`, health check `/api/v1/health`.
3. It asks for **`CORS_ORIGIN`** (the only manual value). Enter the origins of
   the websites that will call the API, exactly, comma-separated:
   ```
   https://n1xnac.github.io
   ```
   Both GitHub Pages sites (ordering and operations) share the
   `https://<user>.github.io` origin, so one entry covers them. For Netlify, use
   the two site origins instead:
   ```
   https://order.your-domain.com,https://admin.your-domain.com
   ```
   (Use the `*.netlify.app` URLs for now if you have no domain yet.)
4. **Apply**. First deploy takes a few minutes.

`render.yaml` sets `SEED_ON_BOOT=true`, so a brand-new database is filled with
the demo restaurant during that first boot — see 3.4.

Prefer the command line? The same service can be created with the API:

```bash
RENDER_API_KEY=rnd_... ./deploy/render/create-service.sh
```

It reuses an existing `lumiere-api` service, waits for the deploy and prints the
URL.

### 3.3 Environment variables Render creates

| Variable | Value | Why |
|---|---|---|
| `DATABASE_URL` | `file:/data/app.db` | SQLite on the persistent disk |
| `UPLOADS_DIR` | `/data/uploads` | dish photos on the same disk |
| `SERVE_CUSTOMER_SITE` | `false` | the ordering site is on Netlify |
| `TRUST_PROXY` | `true` | correct protocol/IP behind Render's TLS proxy |
| `SEED_ON_BOOT` | `true` | fills an empty database with the demo restaurant |
| `JWT_SECRET`, `COOKIE_SECRET`, `SESSION_HMAC_SECRET` | generated | auth + customer session signing |
| `CORS_ORIGIN` | your site origins | browser access from both sites |
| `NODE_ENV` | `production` | — |

`PORT` is injected by Render; the app already reads it. WebSockets work on
Render with no extra configuration.

### 3.4 Seed the demo data once

Nothing to do on a fresh service: with `SEED_ON_BOOT=true` the container seeds
itself on first boot, and only while the database has no restaurant. Later
deploys leave existing data alone.

To seed a service that was created with `SEED_ON_BOOT=false`, use the dashboard
**Shell**:

```bash
SEED_FORCE=true node dist/db/seed.js     # dist/, not src/: the image has no tsx
```

Demo logins are then available (password `Password123!`):
`owner@bistro.local`, `admin@bistro.local`, `manager@bistro.local`,
`waiter@bistro.local`, `kitchen@bistro.local`.

### 3.5 Check it

```bash
curl https://lumiere-api.onrender.com/api/v1/health
# {"status":"ok",...}
```

Optional: add a custom domain `api.your-domain.com`, then use that everywhere
below instead of the `onrender.com` URL.

### 3.6 Backups

SQLite lives on the Render disk. Render disks are not a backup strategy — copy
`/data/app.db` and `/data/uploads` somewhere periodically (cron or manual), or
move to Postgres (next section).

---

## 4. Supabase — optional, database only

Only worth it if you want managed PostgreSQL (backups, no single-file DB).
It does **not** store the dish photos: uploads stay on the Render disk because
the code writes them to `UPLOADS_DIR` and serves `/uploads/*` from there.

### 4.1 Create the project and copy both connection strings

Supabase → Project Settings → Database:

- **Transaction pooler**, port `6543`, append `?pgbouncer=true&connection_limit=1`
- **Direct connection**, port `5432`

### 4.2 Switch the Prisma datasource

`backend/prisma/schema.prisma`:

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
```

Commit and push. On Render, set:

| Variable | Value |
|---|---|
| `DATABASE_URL` | the pooler URL (port 6543) |
| `DIRECT_URL` | the direct URL (port 5432) |
| `UPLOADS_DIR` | `/data/uploads` (keep the disk) |

`directUrl` is what `prisma db push` (run on container boot) uses for schema
changes; the app itself uses the pooled URL. Then run `npx tsx src/db/seed.ts`
once from the Render shell.

Notes:

- Local dev against Supabase works the same way — put both URLs in
  `backend/.env`; Prisma is already installed.
- Existing SQLite data is not copied automatically. Re-seed, or export/import
  manually.
- On Supabase's free plan projects pause after inactivity; the first API call
  may wake it up slowly.
- Prefer staying inside Render? Use **Render Postgres** instead; the Prisma
  change is identical.

---

## 5. Netlify — the two websites

Create **two separate sites from the same repository**.

### Site A — ordering (`customer-site/`)

| Setting | Value |
|---|---|
| Base directory | `customer-site` |
| Build command | `node build.mjs` |
| Publish directory | `dist` |
| Env var | `API_BASE_URL = https://api.your-domain.com` |
| Domain | `order.your-domain.com` |

### Site B — operations & statistics (`frontend/`)

| Setting | Value |
|---|---|
| Base directory | `frontend` |
| Build command | `npm run build` |
| Publish directory | `dist` |
| Env var | `VITE_API_BASE_URL = https://api.your-domain.com` |
| Domain | `admin.your-domain.com` |

Both `netlify.toml` files are already committed, so the build command and
publish directory are usually picked up automatically. If the env var is
missing, the build fails on purpose instead of shipping a broken site.

After the domains are live, make sure `CORS_ORIGIN` on Render lists **both**
origins exactly (no trailing slash), then restart the service.

### If the Netlify build says "Cannot find module ... build.mjs"

The site's **base directory** is empty. Netlify then builds from the repo root.
Set **Site configuration → Build & deploy → Build settings → Base directory** to
`customer-site` (site A) or `frontend` (site B), clear any UI build-command
override, and redeploy. Do not add a `netlify.toml` at the repo root — one root
config cannot describe two sites.

---

## 6. Smoke test

```bash
API=https://api.your-domain.com

curl $API/api/v1/health

curl -i -X OPTIONS $API/api/session/validate \
  -H "Origin: https://order.your-domain.com" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type"
# expect: access-control-allow-origin: https://order.your-domain.com

curl -i -X OPTIONS $API/api/v1/auth/login \
  -H "Origin: https://admin.your-domain.com" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type,authorization"
# expect: access-control-allow-origin: https://admin.your-domain.com
```

Then open both sites: the ordering site should show the menu with photos from
the API host, and the ops site should log in and show the dashboard.

For deploy previews, add `CORS_ORIGIN_REGEX` on Render, e.g.
`^https://[a-z0-9-]+--lumiere-order\.netlify\.app$`.

### No payment method? free plan (ephemeral demo)

Render refuses a persistent disk without billing (`402 Payment information is
required`). The service can still run on the free plan:

```bash
RENDER_API_KEY=rnd_... RENDER_PLAN=free ./deploy/render/create-service.sh
```

Trade-offs: `/data` is container-local, so every deploy or restart starts from
an empty SQLite file. `SEED_ON_BOOT=true` refills the demo restaurant each
time, but orders and uploaded photos are lost; the service also sleeps after
15 minutes idle (the first request afterwards takes ~50 s). Add a payment
method and re-run with `RENDER_PLAN=starter` to get the disk-backed service
from `render.yaml`.
