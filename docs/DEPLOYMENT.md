# Hosting the two websites separately (Netlify)

This project runs as **three deployments** on one database:

| Piece | Host | Example domain |
|---|---|---|
| Customer ordering website | Netlify (static) | `order.example.com` |
| Restaurant operations website | Netlify (static) | `admin.example.com` |
| Backend API (Fastify + SQLite + WebSockets) | Fly.io / Render / Railway / VPS | `api.example.com` |

Netlify cannot run the backend: it is a long-lived Node process that needs
WebSockets and a persistent disk. Netlify is a perfect fit for the two static
sites, which are the parts you asked to host separately.

```
Browser ──> order.example.com  (customer site)  ─┐
Browser ──> admin.example.com  (restaurant app) ─┼──> api.example.com
                                                   (one database)
```

Each site is self-contained and has its own host config: `customer-site/netlify.toml`
and `frontend/netlify.toml`. A one-page map of the two sites lives in
[deploy/netlify/README.md](../deploy/netlify/README.md). For a checklist of what
to sign up for (Render, optional Supabase) and the exact file each service
uses, see [HOSTING-SETUP.md](HOSTING-SETUP.md).

---

## 1. Deploy the backend first

Any host that gives you a persistent disk and WebSocket support works.

### Option A — Docker (Fly.io, Render, Railway, VPS)

```bash
docker build -t restaurant-backend ./backend
docker run -p 4000:4000 \
  -e PORT=4000 \
  -e DATABASE_URL=file:/data/app.db \
  -e UPLOADS_DIR=/data/uploads \
  -e JWT_SECRET="<long random>" \
  -e COOKIE_SECRET="<long random>" \
  -e SESSION_HMAC_SECRET="<long random>" \
  -e CORS_ORIGIN="https://order.example.com,https://admin.example.com" \
  -e TRUST_PROXY=true \
  -e SERVE_CUSTOMER_SITE=false \
  -v backend-data:/data \
  restaurant-backend
```

Seed the demo data once (or once per environment):

```bash
docker run --rm -v backend-data:/data \
  -e DATABASE_URL=file:/data/app.db \
  restaurant-backend npx tsx src/db/seed.ts
```

On Render/Fly, mount a disk at `/data` and set the same variables.

### Option B — Node directly on a VPS

```bash
cd backend
npm ci
npm run build
npm run db:push
npm run db:seed
NODE_ENV=production SERVE_CUSTOMER_SITE=false TRUST_PROXY=true \
  CORS_ORIGIN="https://order.example.com,https://admin.example.com" \
  node dist/server.js
```

Put Nginx/Caddy in front for TLS. WebSocket upgrades must be forwarded
(`proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";`).

### Required backend environment

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | SQLite file on the persistent disk, e.g. `file:/data/app.db` |
| `UPLOADS_DIR` | Uploaded dish photos on the same disk, e.g. `/data/uploads` |
| `JWT_SECRET`, `COOKIE_SECRET`, `SESSION_HMAC_SECRET` | Long random strings |
| `CORS_ORIGIN` | Comma-separated exact site origins |
| `TRUST_PROXY` | `true` behind a proxy (correct protocol/IP for cookies, rate limits) |
| `SERVE_CUSTOMER_SITE` | `false` when the customer site is on Netlify |
| `PORT` | Usually injected by the platform (`4000` locally) |

Optional: `CORS_ORIGIN_REGEX` for Netlify deploy previews, e.g.
`^https://[a-z0-9-]+--lumiere-order\.netlify\.app$`.
Optional: `COOKIE_CROSS_SITE=true` only if a client relies on the auth cookie
across domains (the restaurant app uses the Bearer token, so not required).
Optional: `INTEGRATION_API_KEY` to protect `/api/integration/*`.

Verify:

```bash
curl https://api.example.com/api/v1/health
curl -i -X OPTIONS https://api.example.com/api/session/validate \
  -H "Origin: https://order.example.com" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type"
# expect Access-Control-Allow-Origin: https://order.example.com
```

---

## 2. Netlify site A: customer ordering website

1. **Add new site → Import an existing project** from the repo.
2. **Base directory:** `customer-site`
3. **Build command:** `node build.mjs` (runs inside the base directory)
4. **Publish directory:** `dist`
5. **Environment variables:**
   - `API_BASE_URL = https://api.example.com`
   - `NODE_VERSION = 22` (already in `netlify.toml`)
6. Deploy, then add the custom domain `order.example.com`.

`netlify.toml` in `customer-site/` already contains the build command, SPA
fallback and security headers, so steps 3–5 are the main thing to check.

> **The base directory is mandatory.** Netlify only reads
> `customer-site/netlify.toml` when the site's base directory is
> `customer-site`. If it is empty, Netlify builds from the repo root, `publish`
> resolves to `/dist`, and the build fails with a module/path error. Set it in
> **Site configuration → Build & deploy → Build settings → Base directory**.
> Do not add a `netlify.toml` at the repo root — the two sites are separated by
> their base directories.

What the build script (`customer-site/build.mjs`) does:

- copies the untouched customer app into `customer-site/dist`
- writes `js/runtime-config.js` containing `window.__MV_CONFIG__.apiBaseUrl`
- injects that script before `js/config.js` on every page

The app then calls `${API_BASE_URL}/api/...`, and the backend returns **absolute
photo URLs** (`https://api.example.com/uploads/...`) so dish images render from
the API host instead of looking for `uploads/` on Netlify.

If `API_BASE_URL` is missing during a Netlify build, the build **fails** with a
message naming the variable, instead of publishing a site that calls Netlify's
own domain.

---

## 3. Netlify site B: restaurant operations & statistics website

1. **Add new site → Import an existing project** (same repo).
2. **Base directory:** `frontend`
3. **Build command:** `npm run build`
4. **Publish directory:** `dist`
5. **Environment variables:**
   - `VITE_API_BASE_URL = https://api.example.com`
   - `NODE_VERSION = 22` (already in `netlify.toml`)
6. Deploy, then add the custom domain `admin.example.com`.

`VITE_API_BASE_URL` is inlined by Vite at build time, so changing it requires a
redeploy. API requests, menu photos and the realtime WebSocket
(`wss://api.example.com/api/v1/realtime`) all follow that origin.

If `VITE_API_BASE_URL` is missing during a Netlify build, `vite.config.ts`
**fails the build** with a message naming the variable, instead of publishing an
app that calls Netlify's own domain.

---

## 4. Alternative: one subdomain each on `*.netlify.app`

No custom DNS needed:

| Netlify site | Suggested name | URL |
|---|---|---|
| customer | `lumiere-order` | `https://lumiere-order.netlify.app` |
| restaurant | `lumiere-ops` | `https://lumiere-ops.netlify.app` |

Then set on the backend:

```
CORS_ORIGIN=https://lumiere-order.netlify.app,https://lumiere-ops.netlify.app
```

and in each Netlify site's environment:

```
customer-site: API_BASE_URL=https://api.example.com
frontend:      VITE_API_BASE_URL=https://api.example.com
```

---

## 5. Local check without deploying

Build both sites exactly as Netlify would and serve them on different ports:

```bash
# customer site (different origin than the API)
API_BASE_URL=http://127.0.0.1:4000 node deploy/netlify/build-customer-site.mjs
python3 -m http.server 5000 -d customer-site/dist

# restaurant app
cd frontend
VITE_API_BASE_URL=http://127.0.0.1:4000 npm run build
python3 -m http.server 5001 -d dist
```

Start the backend with both origins allowed:

```bash
cd backend
CORS_ORIGIN="http://127.0.0.1:5000,http://127.0.0.1:5001" SERVE_CUSTOMER_SITE=false npm run dev
```

Open <http://127.0.0.1:5000/> and <http://127.0.0.1:5001/>. The customer site
talks to port 4000, the restaurant app logs in against `127.0.0.1:4000`, menu
images come from `/uploads` on 4000, and realtime updates still arrive over the
WebSocket.

---

## 6. Troubleshooting the Netlify builds

**`Cannot find module '/opt/build/deploy/netlify/build-customer-site.mjs'`**
(or `'/opt/build/repo/build.mjs'`)

The site's **base directory is not set**. Netlify then builds from the repo
root: `../deploy/...` escapes the checkout, and `publish = "dist"` resolves to
`/opt/build/repo/dist`. Fix it in **Site configuration → Build & deploy → Build
settings → Base directory**:

| Site | Base directory |
|---|---|
| A — ordering | `customer-site` |
| B — operations | `frontend` |

Then trigger "Clear cache and deploy site". The build command comes from the
`netlify.toml` inside that folder (`node build.mjs` for site A,
`npm run build` for site B); leave the UI's command/publish overrides empty.

**`API_BASE_URL is not set` / `VITE_API_BASE_URL is not set`**

Add the variable under Site configuration → Environment variables and redeploy.
This is intentional: without it the site would call Netlify's own domain.

**The sites load but API calls fail with a CORS error**

The backend's `CORS_ORIGIN` must list the exact site origins, scheme + host, no
trailing slash. Update it on Render, then restart the service. Deploy previews
need `CORS_ORIGIN_REGEX`.

**A repo-root `netlify.toml` was added**

Remove it. One repo-root config cannot describe two different sites; each site
is defined by its own base directory + `netlify.toml`.

---

## Notes and limits

- **Cookies:** the restaurant app authenticates every request with the Bearer
  token in `localStorage`. This is intentional so cross-site hosting works
  without third-party cookie rules. The httpOnly cookie is a convenience for
  same-origin deployments.
- **CORS:** both Netlify origins must be listed exactly (scheme + host, no
  trailing slash). Deploy previews need `CORS_ORIGIN_REGEX`.
- **SQLite:** fine for a single backend instance with a disk. For horizontal
  scaling switch `prisma/schema.prisma` to PostgreSQL and set `DATABASE_URL`
  accordingly.
- **Uploads:** stored under `UPLOADS_DIR`; keep that on a persistent volume (or
  move to object storage and return absolute URLs).
- **WebSockets on Netlify:** not applicable — the sites are static; the socket
  connects directly to `api.example.com`.
