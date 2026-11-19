import path from 'node:path';

/**
 * Directory for uploaded dish photos.
 *
 * Locally this is `backend/uploads`. On a host with a persistent disk (Render,
 * Fly, Railway, VPS) point `UPLOADS_DIR` at the mounted volume, e.g.
 * `/data/uploads`, so both the upload route and the `/uploads/*` static route
 * use the same durable location.
 */
export function uploadsDir(): string {
  return process.env.UPLOADS_DIR ?? path.resolve(process.cwd(), 'uploads');
}
