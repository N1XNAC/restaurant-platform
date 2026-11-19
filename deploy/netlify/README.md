# Two Netlify sites, one backend

The project is deliberately split into two independent websites so each can
live on its own domain. Both talk to the same backend and the same database.

| | Site A — ordering | Site B — operations & statistics |
|---|---|---|
| Folder | `customer-site/` | `frontend/` |
| Audience | diners at the table | restaurant staff/managers |
| Stack | plain HTML/CSS/JS | React 19 + Vite 6 |
| Netlify base dir | `customer-site` | `frontend` |
| Build command | `node build.mjs` | `npm run build` |
| Publish dir | `dist` | `dist` |
| Env var | `API_BASE_URL` | `VITE_API_BASE_URL` |
| Example domain | `order.example.com` | `admin.example.com` |
| Config file | `customer-site/netlify.toml` | `frontend/netlify.toml` |

The **backend** (Fastify + SQLite + WebSockets + uploads) is a separate
deployment — Fly.io, Render, Railway or a VPS — because Netlify cannot run a
long-lived Node process with WebSockets and a persistent disk. The two Netlify
sites only need its origin.

```
diners  ──> order.example.com  (customer-site)  ─┐
staff   ──> admin.example.com  (frontend)       ─┼──> api.example.com  (backend)
                                                  └──> /api, /uploads, /api/v1/realtime
```

## 1. Point both sites at the backend

In **each** Netlify site: Site configuration → Environment variables.

```
Site A (customer-site):  API_BASE_URL      = https://api.example.com
Site B (frontend):       VITE_API_BASE_URL = https://api.example.com
```

Both builds refuse to deploy on Netlify without their variable, so a missing
setting fails fast instead of shipping a site that calls Netlify's own domain.

## 2. Allow both domains in the backend

```
CORS_ORIGIN=https://order.example.com,https://admin.example.com
TRUST_PROXY=true
SERVE_CUSTOMER_SITE=false
```

Restart the backend after changing it, then check:

```bash
curl -i -X OPTIONS https://api.example.com/api/session/validate \
  -H "Origin: https://order.example.com" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type"
# expect access-control-allow-origin: https://order.example.com
```

## 3. Deploy

Netlify UI: two separate sites from the same repository, each with the base
directory / build command / publish directory from the table above.

Or with the CLI:

```bash
./deploy/netlify/deploy-customer.sh  https://api.example.com --prod
./deploy/netlify/deploy-restaurant.sh https://api.example.com --prod
```

Full walkthrough, backend options and troubleshooting: [../../docs/DEPLOYMENT.md](../../docs/DEPLOYMENT.md).
