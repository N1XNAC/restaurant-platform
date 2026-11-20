import type { FastifyRequest } from 'fastify';

/**
 * Public origin (scheme + host) a request arrived on.
 *
 * Render/Netlify style proxies terminate TLS in front of the app, so the
 * forwarded headers are preferred over `request.protocol`.
 */
export function requestOrigin(request: FastifyRequest): string {
  const first = (value: string | string[] | undefined): string | undefined =>
    Array.isArray(value) ? value[0] : value;
  const proto =
    first(request.headers['x-forwarded-proto'])?.split(',')[0]?.trim() ||
    request.protocol ||
    'http';
  const host = first(request.headers['x-forwarded-host']) || request.headers.host;
  return host ? `${proto}://${host}` : '';
}

/**
 * Turn a stored origin-relative upload path into an absolute URL.
 *
 * The customer app resolves image paths against its own origin, which breaks
 * when the site and the API are hosted on different hosts. Returning absolute
 * URLs keeps the same database values working in both same-origin and split
 * deployments.
 */
export function resolveAssetUrl(
  imagePath: string | null | undefined,
  assetBaseUrl?: string
): string {
  if (!imagePath) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(imagePath) || imagePath.startsWith('//')) {
    return imagePath;
  }
  if (!assetBaseUrl) return imagePath;
  return `${assetBaseUrl.replace(/\/+$/, '')}${
    imagePath.startsWith('/') ? imagePath : `/${imagePath}`
  }`;
}
