#!/bin/sh
# Container boot sequence.
#
#   1. bring the schema up to date on the persistent disk
#   2. optionally seed the demo catalogue, but only into a database that has
#      never been seeded (SEED_ON_BOOT=true, set by render.yaml)
#   3. start the API
#
# `prisma db push` is idempotent: on an existing /data/app.db it is a no-op.
set -eu

echo "==> prisma db push"
npx prisma db push --skip-generate

if [ "${SEED_ON_BOOT:-false}" = "true" ]; then
  echo "==> seed: filling an empty database (skipped if data exists)"
  SEED_IF_EMPTY=true node dist/db/seed.js
fi

echo "==> starting the API"
exec node dist/server.js
