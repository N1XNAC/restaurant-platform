# GitHub Pages deployment (alternative to Netlify)

The two static websites can live on GitHub Pages instead of Netlify. The API
still runs on Render — Pages cannot host a Node process, WebSockets or SQLite.

| Site | Repository | Pages URL |
|---|---|---|
| Ordering | `github.com/N1XNAC/lumiere-ordering` | `https://n1xnac.github.io/lumiere-ordering/` |
| Operations & statistics | `github.com/N1XNAC/lumiere-ops` | `https://n1xnac.github.io/lumiere-ops/` |
| API (source of truth) | `github.com/N1XNAC/restaurant-platform` | Render |

The monorepo stays the source of truth for both sites. The two site repos are
deployment copies; refresh them with:

```bash
GH_TOKEN=<token with repo scope> ./deploy/github/publish-sites.sh
```

## One-time setup

### 1. Backend URL

Each site repo needs the API origin as a **repository variable**:

Settings → Secrets and variables → Actions → **Variables** → New variable:

| Name | Value |
|---|---|
| `API_BASE_URL` | `https://<your-service>.onrender.com` |

Both builds fail without it, by design — see
[the guard rationale](#why-the-build-fails-without-api_base_url).

### 2. Pages source

Settings → Pages → Build and deployment → Source: **GitHub Actions**.
(Already enabled for both repos by the setup script; re-check after renaming.)

### 3. Backend CORS

Both Pages sites share one origin, so one entry is enough:

```
CORS_ORIGIN=https://n1xnac.github.io
```

On Render: add it, then restart the service.

### 4. Deploy

Push to `main` (or run **Actions → Deploy … → Run workflow**) in each site
repo. First deploy takes a minute; the URLs above go live.

## Why the build fails without `API_BASE_URL`

A project Pages site is served under `/<repo>/`. Assets, routes and API calls
must not silently fall back to `n1xnac.github.io`, which has no API. Both build
pipelines therefore stop with a clear message when the variable is missing,
rather than publishing a site whose every request 404s.

## How the operations site handles the sub-path

- The workflow builds with `VITE_BASE_PATH=/lumiere-ops/`, which sets Vite's
  `base` so `/lumiere-ops/assets/...` resolves.
- `BrowserRouter` uses `import.meta.env.BASE_URL` as its basename, so routes
  work under the sub-path.
- `dist/index.html` is copied to `dist/404.html` so a page reload on a nested
  route (e.g. `/lumiere-ops/orders`) loads the app instead of a 404.

The ordering site uses relative links only, so it needs no base-path handling.

## Custom domain later

Pages supports custom domains per repository. If you add
`order.example.com` and `admin.example.com`:

1. Set the custom domain in each repo's Pages settings and create the DNS
   records GitHub shows.
2. Update `CORS_ORIGIN` on Render to the new origins.
3. Rebuild both sites (no code change needed).

## Netlify vs Pages

Both are supported from the same source; `netlify.toml` in each folder is
unused by the Pages workflow. Use one host per site, not both.
