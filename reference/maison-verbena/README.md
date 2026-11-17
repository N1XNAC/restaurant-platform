# Maison Verbena — Customer Table Ordering Static App

A framework-free **HTML5, CSS3, and Vanilla JavaScript** customer-side restaurant ordering application paired with a CORS-ready **Express API backend** (`server.ts`). Designed for zero-dependency static hosting on **Netlify**, **Vercel**, **Cloudflare Pages**, or any CDN, while keeping all menu, session, pricing, and order integration logic authoritative on the backend.

## Directory Structure

```text
.
├── index.html                  # Home — Table greeting, live search, category/diet filters, FoodCards
├── menu.html                   # Full Menu — Dishes organized by culinary course
├── cart.html                   # Order Review — Virtual Table Cart & ?mode=only-this express checkout
├── order-confirmation.html     # Confirmation — Order ID, Table label, receipt, live status polling
├── css/
│   ├── global.css              # Design tokens, glass header, modal, toast, alerts, footer
│   ├── components.css          # Pill buttons, FoodCards, QuantitySelector, OrderSummary, FloatingCart
│   ├── responsive.css          # Mobile-first breakpoints (320px–1441px+)
│   └── animations.css          # Keyframe transitions and prefers-reduced-motion rules
├── js/
│   ├── config.js               # Configurable API base URL, filters, media resolver
│   ├── api.js                  # Fetch wrapper for all /api/* endpoints
│   ├── session.js              # QR/NFC validation, tamper detection, GPS & 4-digit PIN challenge
│   ├── cart.js                 # Virtual Table Cart, Only This isolation, integer-cent pricing
│   ├── menu.js                 # Menu rendering, WebP/JPEG fallback <picture>, options & quantity handlers
│   ├── orders.js               # Order Review & Order Confirmation controllers
│   └── app.js                  # Shared navigation, search, modal, floating badge & page bootstrap
├── assets/images/              # Compressed WebP + JPEG fallback food & dining photography
├── server/                     # Express routes, authoritative pricing, catalog & security store
├── server.ts                   # API server & static file host on port 3000
├── scripts/build-static.mjs    # Production minifier outputting dist/
├── netlify.toml                # Netlify static publish config
└── vercel.json                 # Vercel static publish config
```

## Configurable Backend API URL

By default, the static frontend sends requests to same-origin `/api/*` routes. When hosting the static frontend separately from the Express API server:

- Set `<meta name="api-base-url" content="https://api.your-restaurant-domain.com" />` in the HTML `<head>`, **or**
- Define `window.__MV_CONFIG__ = { apiBaseUrl: "https://api.your-restaurant-domain.com" }` before `js/config.js` loads.
- Set `CORS_ALLOWED_ORIGINS` in the backend `.env` to allow your static origin.

## Development & Verification

- **Run Local Dev Server (Static + API on port 3000)**: `npm run dev`
- **Verify TypeScript, JS Syntax & Unit Tests**: `npm run lint`
- **Build Minified Production Bundle (`dist/`)**: `npm run build`
- **Serve Production Bundle**: `npm start`

## Deployment

- **Netlify**: Connect repository or deploy `dist/` (`command = "npm run build"`, `publish = "dist"` via `netlify.toml`).
- **Vercel**: Auto-configured via `vercel.json` (`outputDirectory: "dist"`).
- **QR / NFC Table Testing Tokens**:
  - `?token=QR_MV_T08_VALID` — Table 08 (PIN `4082`)
  - `?token=NFC_MV_T04_VALID` — Table 04 (PIN `4041`)
  - `?token=QR_MV_T12_VALID` — Table 12 (PIN `4126`)
  - `?token=QR_MV_EXPIRED` — Expired token verification test
