#!/usr/bin/env bash
# Deploy Netlify site B — the restaurant operations & statistics website.
#
#   ./deploy/netlify/deploy-restaurant.sh https://api.your-domain.com [--prod]
#
# Prerequisites:
#   npm i -g netlify-cli        (or use npx, as below)
#   netlify login               (or export NETLIFY_AUTH_TOKEN=...)
#   netlify link                (once, inside the repo, to pick the site)
#
# Or set NETLIFY_SITE_ID directly instead of linking.
set -euo pipefail

API_BASE_URL="${1:-}"
if [[ -z "$API_BASE_URL" ]]; then
  echo "usage: $0 https://api.your-domain.com [--prod]" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROD_FLAG=()
if [[ "${2:-}" == "--prod" ]]; then
  PROD_FLAG=(--prod)
fi

echo "Building restaurant ops site for API $API_BASE_URL"
VITE_API_BASE_URL="$API_BASE_URL" npm --prefix "$ROOT/frontend" run build

echo "Deploying frontend/dist"
npx --yes netlify deploy --dir "$ROOT/frontend/dist" "${PROD_FLAG[@]}"
