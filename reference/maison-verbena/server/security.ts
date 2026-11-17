import crypto from 'node:crypto';
import type {
  LocationVerificationStatus,
  RestaurantCoordinates,
  RestaurantInfo,
} from './types';

const SESSION_HMAC_SECRET =
  process.env.SESSION_HMAC_SECRET || 'maison-verbena-dev-session-secret-key';

export type SecurityEventType =
  | 'INVALID_TOKEN'
  | 'EXPIRED_TOKEN'
  | 'REPEATED_INVALID_TOKEN'
  | 'OUTSIDE_GEOFENCE'
  | 'TABLE_SPOOFING_ATTEMPT'
  | 'MISSING_SESSION'
  | 'EXPIRED_SESSION'
  | 'UNAVAILABLE_ITEM_ATTEMPT'
  | 'PRICE_TAMPERING_DETECTED'
  | 'DUPLICATE_ORDER_ATTEMPT'
  | 'CHALLENGE_FAILED'
  | 'CHALLENGE_PASSED';

export interface SecurityLogEntry {
  id: string;
  timestamp: string;
  eventType: SecurityEventType;
  severity: 'info' | 'warning' | 'critical';
  clientIp: string;
  restaurantId?: string;
  tableId?: string;
  sessionId?: string;
  detail: string;
}

export function generateSecureId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
}

export function signSessionBinding(
  sessionId: string,
  restaurantId: string,
  tableId: string
): string {
  return crypto
    .createHmac('sha256', SESSION_HMAC_SECRET)
    .update(`${sessionId}:${restaurantId}:${tableId}`)
    .digest('hex');
}

export function verifySessionSignature(
  sessionId: string,
  restaurantId: string,
  tableId: string,
  providedSignature: string
): boolean {
  if (!sessionId || !restaurantId || !tableId || !providedSignature) {
    return false;
  }
  const expected = signSessionBinding(sessionId, restaurantId, tableId);
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(providedSignature, 'utf8');
  if (expectedBuf.length !== providedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

export function haversineDistanceMeters(
  a: RestaurantCoordinates,
  b: RestaurantCoordinates
): number {
  const earthRadiusMeters = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return Math.round(earthRadiusMeters * c);
}

export function evaluateGeofence(
  restaurant: RestaurantInfo,
  gps?: { lat?: number; lng?: number; accuracy?: number } | null
): {
  status: LocationVerificationStatus;
  distanceMeters: number | null;
  requiresAdditionalVerification: boolean;
} {
  if (
    !gps ||
    typeof gps.lat !== 'number' ||
    typeof gps.lng !== 'number' ||
    !Number.isFinite(gps.lat) ||
    !Number.isFinite(gps.lng)
  ) {
    return {
      status: 'unavailable',
      distanceMeters: null,
      requiresAdditionalVerification: false,
    };
  }

  const distance = haversineDistanceMeters(restaurant.coordinates, {
    lat: gps.lat,
    lng: gps.lng,
  });

  // Account reasonably for browser GPS horizontal accuracy (capped at 100m buffer)
  const accuracyBuffer =
    typeof gps.accuracy === 'number' && Number.isFinite(gps.accuracy)
      ? Math.min(Math.max(0, gps.accuracy), 100)
      : 0;

  const withinGeofence =
    distance <= restaurant.geofenceRadiusMeters + accuracyBuffer;

  return {
    status: withinGeofence ? 'verified' : 'flagged_outside_geofence',
    distanceMeters: distance,
    requiresAdditionalVerification: !withinGeofence,
  };
}
