# Backend image. Netlify cannot host this (it needs a long-lived process,
# WebSockets and a persistent disk for SQLite + uploads); run it on a host such
# as Fly.io, Render, Railway or a VPS.
#
# Build:  docker build -t restaurant-backend ./backend
# Run:    docker run -p 4000:4000 \
#           -e DATABASE_URL=file:/data/app.db \
#           -e UPLOADS_DIR=/data/uploads \
#           -v backend-data:/data restaurant-backend
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY --from=build /app/dist ./dist
# Demo dish photos referenced by the seed. Copied into UPLOADS_DIR at boot when
# missing, so a fresh disk still serves the menu images.
COPY uploads ./demo-uploads
COPY docker-entrypoint.sh ./
RUN mkdir -p /data/uploads
EXPOSE 4000
# The entrypoint applies the SQLite schema, seeds an empty database when
# SEED_ON_BOOT=true, then starts the API.
CMD ["sh", "docker-entrypoint.sh"]
