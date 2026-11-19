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
RUN mkdir -p /data/uploads
EXPOSE 4000
# `db push` keeps the SQLite schema current on boot; for a server-grade
# deployment replace this with `prisma migrate deploy` and committed migrations.
CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/server.js"]
