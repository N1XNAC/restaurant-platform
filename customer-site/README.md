# Netlify site A — Customer ordering website

Guest-facing ordering app. This is the site you give to diners (QR/NFC table
placards, menu, cart, order status). It is plain HTML/CSS/JS, so it deploys as
a static site.

| Setting | Value |
|---|---|
| Netlify base directory | `customer-site` |
| Build command | `node ../deploy/netlify/build-customer-site.mjs` |
| Publish directory | `dist` |
| Environment variable | `API_BASE_URL=https://api.your-domain.com` |
| Suggested domain | `order.your-domain.com` |

`API_BASE_URL` is the **backend** origin (Fastify API + WebSocket + uploads),
which is **not** hosted on Netlify. See [../docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md).

The build script copies this folder to `dist`, writes
`js/runtime-config.js` with `window.__MV_CONFIG__ = { apiBaseUrl: "..." }`, and
injects that script before `js/config.js` on every page. No application code is
modified.

## Deploy with the CLI

```bash
# from the repo root
./deploy/netlify/deploy-customer.sh https://api.your-domain.com
```

## Local preview (split-origin, exactly like production)

```bash
cd ..
API_BASE_URL=http://127.0.0.1:4000 node deploy/netlify/build-customer-site.mjs
python3 -m http.server 5000 -d customer-site/dist
```

Open <http://127.0.0.1:5000/>.
