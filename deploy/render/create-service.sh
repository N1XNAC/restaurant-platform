#!/usr/bin/env bash
# Create (or reuse) the Render web service that runs the restaurant API.
#
#   RENDER_API_KEY=rnd_... ./deploy/render/create-service.sh
#
# Optional overrides:
#   RENDER_OWNER_ID   workspace id      (auto-detected when the key sees one)
#   SERVICE_NAME      lumiere-api
#   REGION            oregon
#   RENDER_PLAN       starter        (use "free" for a no-card, ephemeral demo:
#                                    SQLite lives in the container and resets on
#                                    every deploy/restart; SEED_ON_BOOT refills
#                                    the demo data)
#   BRANCH            master
#   GITHUB_REPO       https://github.com/N1XNAC/restaurant-platform
#   CORS_ORIGIN       https://n1xnac.github.io
#
# It is safe to run twice: an existing service with the same name is reused.
# The blueprint (render.yaml) describes the same service; this script exists so
# the deployment can be created without clicking through the dashboard.
set -euo pipefail

: "${RENDER_API_KEY:?set RENDER_API_KEY to a Render API key}"

API="https://api.render.com/v1"
SERVICE_NAME="${SERVICE_NAME:-lumiere-api}"
REGION="${REGION:-oregon}"
BRANCH="${BRANCH:-master}"
GITHUB_REPO="${GITHUB_REPO:-https://github.com/N1XNAC/restaurant-platform}"
CORS_ORIGIN="${CORS_ORIGIN:-https://n1xnac.github.io}"
PLAN="${RENDER_PLAN:-starter}"

api() {
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -sS -X "$method" "$API$path" \
      -H "Authorization: Bearer $RENDER_API_KEY" \
      -H "Content-Type: application/json" \
      -d "$body" -w '\n%{http_code}'
  else
    curl -sS -X "$method" "$API$path" \
      -H "Authorization: Bearer $RENDER_API_KEY" \
      -w '\n%{http_code}'
  fi
}

# --- workspace -------------------------------------------------------------
if [ -z "${RENDER_OWNER_ID:-}" ]; then
  RENDER_OWNER_ID=$(api GET "/owners?limit=20" | sed '$d' |
    jq -r '.[0].owner.id // empty')
fi
if [ -z "$RENDER_OWNER_ID" ]; then
  echo "Could not detect a Render workspace for this key." >&2
  echo "Set RENDER_OWNER_ID (Dashboard → Workspace Settings → ID)." >&2
  exit 1
fi
echo "workspace: $RENDER_OWNER_ID"

# --- reuse an existing service --------------------------------------------
existing=$(api GET "/services?limit=100" | sed '$d' |
  jq -r --arg n "$SERVICE_NAME" '.[] | .service | select(.name == $n) | "\(.id)\t\(.serviceDetails.url // "")"' |
  head -1)
if [ -n "$existing" ]; then
  service_id="${existing%%$'\t'*}"
  service_url="${existing#*$'\t'}"
  echo "service already exists: $service_id $service_url"
else
  payload=$(jq -n \
    --arg name "$SERVICE_NAME" \
    --arg owner "$RENDER_OWNER_ID" \
    --arg repo "$GITHUB_REPO" \
    --arg branch "$BRANCH" \
    --arg region "$REGION" \
    --arg plan "$PLAN" \
    --arg cors "$CORS_ORIGIN" \
    '{
      type: "web_service",
      name: $name,
      ownerId: $owner,
      repo: $repo,
      branch: $branch,
      autoDeployTrigger: "commit",
      rootDir: "backend",
      envVars: [
        { key: "NODE_ENV", value: "production" },
        { key: "DATABASE_URL", value: "file:/data/app.db" },
        { key: "UPLOADS_DIR", value: "/data/uploads" },
        { key: "SEED_ON_BOOT", value: "true" },
        { key: "SERVE_CUSTOMER_SITE", value: "false" },
        { key: "TRUST_PROXY", value: "true" },
        { key: "CORS_ORIGIN", value: $cors },
        { key: "JWT_SECRET", generateValue: true },
        { key: "COOKIE_SECRET", generateValue: true },
        { key: "SESSION_HMAC_SECRET", generateValue: true }
      ],
      serviceDetails: ({
        runtime: "docker",
        plan: $plan,
        region: $region,
        healthCheckPath: "/api/v1/health",
        envSpecificDetails: {
          dockerfilePath: "./Dockerfile",
          dockerContext: "."
        }
      }
      # A persistent disk requires a paid plan. On the free plan the disk is
      # omitted; Render gives every container a writable /data for its lifetime.
      | if $plan == "free" then .
        else . + { disk: { name: "lumiere-data", mountPath: "/data", sizeGB: 1 } }
        end)
    }')

  response=$(api POST "/services" "$payload")
  status=$(printf '%s' "$response" | tail -1)
  body=$(printf '%s' "$response" | sed '$d')

  # Render's newer accounts reject the legacy "starter" name; retry once with
  # the equivalent current plan (512 MB / 0.5 CPU, the smallest with a disk).
  if [ "$status" = "400" ] && [ "$PLAN" = "starter" ]; then
    echo "plan 'starter' rejected, retrying with '0.5c-512mb'"
    payload=$(printf '%s' "$payload" | jq '.serviceDetails.plan = "0.5c-512mb"')
    response=$(api POST "/services" "$payload")
    status=$(printf '%s' "$response" | tail -1)
    body=$(printf '%s' "$response" | sed '$d')
  fi

  if [ "$status" != "201" ]; then
    echo "create failed (HTTP $status):" >&2
    printf '%s\n' "$body" | jq . >&2 || printf '%s\n' "$body" >&2
    exit 1
  fi

  service_id=$(printf '%s' "$body" | jq -r '.service.id')
  service_url=$(printf '%s' "$body" | jq -r '.service.serviceDetails.url // ""')
  echo "created service: $service_id"
fi

echo "dashboard: https://dashboard.render.com/web/$service_id"
if [ "$PLAN" = "free" ]; then
  echo "note: free plan — no persistent disk. The demo data is reseeded on every"
  echo "      boot; orders and uploaded photos are lost on deploy or restart."
  echo "      Add a payment method, then re-run with RENDER_PLAN=starter."
fi

# --- wait for the first deploy --------------------------------------------
printf 'waiting for the deploy'
for _ in $(seq 1 80); do
  latest=$(api GET "/services/$service_id/deploys?limit=1" | sed '$d' |
    jq -r '.[0].deploy | "\(.status)\t\(.id)"' 2>/dev/null || true)
  deploy_status="${latest%%$'\t'*}"
  case "$deploy_status" in
    live) echo " live"; break ;;
    build_failed|pre_deploy_failed|canceled|deactivated)
      echo " $deploy_status"
      echo "deploy failed — check the logs: https://dashboard.render.com/web/$service_id/deploys" >&2
      exit 1
      ;;
  esac
  printf '.'
  sleep 15
done

if [ "${deploy_status:-}" != "live" ]; then
  echo
  echo "Deploy is still running. Follow it in the dashboard:" >&2
  echo "  https://dashboard.render.com/web/$service_id/deploys" >&2
fi

url=$(api GET "/services/$service_id" | sed '$d' | jq -r '.serviceDetails.url // empty')
echo
echo "service URL: ${url:-$service_url}"
echo "health:      ${url:-$service_url}/api/v1/health"
