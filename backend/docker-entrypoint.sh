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

# The seed references demo dish photos that ship with the image. Copy them into
# the (possibly empty) uploads folder without overwriting real uploads.
UPLOADS="${UPLOADS_DIR:-/app/uploads}"
if [ -d /app/demo-uploads ]; then
  echo "==> demo photos -> $UPLOADS"
  mkdir -p "$UPLOADS"
  for photo in /app/demo-uploads/*; do
    [ -e "$photo" ] || continue
    target="$UPLOADS/$(basename "$photo")"
    [ -e "$target" ] || cp "$photo" "$target"
  done
fi

if [ "${SEED_ON_BOOT:-false}" = "true" ]; then
  echo "==> seed: filling an empty database (skipped if data exists)"
  SEED_IF_EMPTY=true node dist/db/seed.js
fi

echo "==> starting the API"
exec node dist/server.js
