# Netlify site B — Restaurant operations & statistics

Staff-facing app: dashboard/KPIs, orders, kitchen display, tables, menu,
inventory, sales analytics and CSV export, reviews, staff and settings. Built
with React + Vite, so it deploys as a static site.

| Setting | Value |
|---|---|
| Netlify base directory | `frontend` |
| Build command | `npm run build` |
| Publish directory | `dist` |
| Environment variable | `VITE_API_BASE_URL=https://api.your-domain.com` |
| Suggested domain | `admin.your-domain.com` |

`VITE_API_BASE_URL` is the **backend** origin (Fastify API + WebSocket +
uploads), which is **not** hosted on Netlify. Vite inlines it at build time, so
rebuild after changing it. The build fails on Netlify if the variable is
missing (see `vite.config.ts`), because a same-origin default would point at
Netlify itself and every API call would 404.

Every request — `fetch`, dish photos and the realtime WebSocket
(`wss://api.your-domain.com/api/v1/realtime`) — follows that origin through
`src/lib/endpoints.ts`.

## Deploy with the CLI

```bash
# from the repo root
./deploy/netlify/deploy-restaurant.sh https://api.your-domain.com
```

## Local preview (split-origin, exactly like production)

```bash
cd ..
cd frontend
VITE_API_BASE_URL=http://127.0.0.1:4000 npm run build
python3 -m http.server 5001 -d dist
```

Open <http://127.0.0.1:5001/> and log in with a demo staff account.
