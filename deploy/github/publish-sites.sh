#!/usr/bin/env bash
# Sync the two site folders from this monorepo into their GitHub Pages repos.
#
#   GH_TOKEN=... ./deploy/github/publish-sites.sh
#
# This monorepo is the source of truth. The site repos only hold the site
# source, their own Pages workflow and README; GitHub Actions builds and
# deploys them on push.
set -euo pipefail

: "${GH_TOKEN:?set GH_TOKEN to a token with repo scope}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OWNER="${GITHUB_OWNER:-N1XNAC}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

sync_site() {
  local repo="$1" source="$2"
  local clone="$WORK/$repo"

  echo "== $repo"
  git clone --depth 1 "https://github.com/$OWNER/$repo.git" "$clone" >/dev/null 2>&1

  rsync -a --delete \
    --exclude '.git/' \
    --exclude '.github/' \
    --exclude 'README.md' \
    --exclude 'dist/' \
    --exclude 'node_modules/' \
    --exclude '*.tsbuildinfo' \
    --exclude 'netlify.toml' \
    --exclude '.DS_Store' \
    "$source/" "$clone/"

  if git -C "$clone" diff --quiet; then
    echo "  no changes"
    return
  fi

  git -C "$clone" add -A
  git -C "$clone" -c user.name="Restaurant Platform" \
    -c user.email="dev@restaurant.local" \
    commit -q -m "Sync from restaurant-platform@$(git -C "$ROOT" rev-parse --short HEAD)"

  local auth
  auth=$(printf 'x-access-token:%s' "$GH_TOKEN" | base64 -w0)
  git -C "$clone" -c http.extraheader="AUTHORIZATION: basic $auth" push origin HEAD:main
  echo "  pushed"
}

sync_site lumiere-ordering "$ROOT/customer-site"
sync_site lumiere-ops "$ROOT/frontend"
