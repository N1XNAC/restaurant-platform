/**
 * Where the API lives.
 *
 * When the restaurant app is served by the backend (or through the Vite dev
 * proxy) this stays empty and every request is same-origin. On a separate host
 * (e.g. Netlify) set `VITE_API_BASE_URL` at build time to the backend origin,
 * for example `https://api.example.com`.
 */
const configuredBase = (import.meta.env.VITE_API_BASE_URL ?? '').trim();
export const API_BASE_URL = configuredBase.replace(/\/+$/, '');

/** Absolute URL for an API path such as `/api/v1/orders`. */
export function apiUrl(path: string): string {
  if (!API_BASE_URL) return path;
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('//')) return path;
  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Absolute URL for a file path returned by the API (menu photos, uploads).
 * Values stored in the database stay origin-relative; only rendering changes.
 */
export function mediaUrl(path: string | null | undefined): string {
  if (!path) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('//')) return path;
  return apiUrl(path);
}

/** WebSocket URL for the realtime channel, following the API origin if set. */
export function realtimeUrl(params: URLSearchParams): string {
  if (API_BASE_URL) {
    const api = new URL(API_BASE_URL);
    const protocol = api.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${api.host}/api/v1/realtime?${params.toString()}`;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/v1/realtime?${params.toString()}`;
}
