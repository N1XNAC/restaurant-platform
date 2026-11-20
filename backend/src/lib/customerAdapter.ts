import crypto from 'node:crypto';
import type {
  CustomerSession,
  MenuItem,
  MenuItemExtra,
  MenuItemVariation,
  Order,
  OrderItem,
  Restaurant,
  RestaurantTable,
  TableToken,
} from '@prisma/client';
import { resolveAssetUrl } from './assetUrl.js';

export { resolveAssetUrl };

/**
 * Adapter between the platform's canonical data model and the contract expected
 * by the customer-facing website (`customer-site/`). The customer app speaks
 * dollars (floats) and a fixed vocabulary for statuses / categories / diets.
 *
 * The database stays the single source of truth: nothing here invents prices or
 * menu content, it only reshapes rows (cents -> dollars, enum casing, ...).
 */

export const CUSTOMER_CATEGORIES = [
  'Starters',
  'Mains',
  'Wood-Fired',
  'Desserts',
  'Beverages',
] as const;

export type CustomerCategory = (typeof CUSTOMER_CATEGORIES)[number];
export type CustomerDietary = 'veg' | 'non-veg' | 'vegan';
export type CustomerOrderStatus =
  | 'RECEIVED'
  | 'PREPARING'
  | 'READY'
  | 'SERVED'
  | 'CANCELLED';

export type CustomerLocationStatus =
  | 'unverified'
  | 'verified'
  | 'flagged_outside_geofence'
  | 'unavailable';

/** Category names used by the restaurant app mapped onto the fixed customer set. */
const CATEGORY_ALIASES: Record<string, CustomerCategory> = {
  Starters: 'Starters',
  Mains: 'Mains',
  'Wood-Fired': 'Wood-Fired',
  'Wood-Fired Pizza': 'Wood-Fired',
  Pizza: 'Wood-Fired',
  Desserts: 'Desserts',
  Dessert: 'Desserts',
  Beverages: 'Beverages',
  Drinks: 'Beverages',
};

export function toCustomerCategory(name: string): CustomerCategory {
  return CATEGORY_ALIASES[name] ?? 'Mains';
}

const DIETARY_MAP: Record<string, CustomerDietary> = {
  VEG: 'veg',
  VEGETARIAN: 'veg',
  NON_VEG: 'non-veg',
  'NON-VEG': 'non-veg',
  VEGAN: 'vegan',
};

export function toCustomerDietary(value: string): CustomerDietary {
  return DIETARY_MAP[value.toUpperCase()] ?? 'veg';
}

/** Internal lifecycle -> customer-facing lifecycle. */
export function toCustomerStatus(status: string): CustomerOrderStatus {
  switch (status) {
    case 'NEW':
    case 'ACCEPTED':
      return 'RECEIVED';
    case 'PREPARING':
      return 'PREPARING';
    case 'READY':
      return 'READY';
    case 'SERVED':
    case 'COMPLETED':
      return 'SERVED';
    case 'CANCELLED':
    case 'REJECTED':
      return 'CANCELLED';
    default:
      return 'RECEIVED';
  }
}

/** Customer lifecycle -> internal lifecycle (used by the integration surface). */
export function fromCustomerStatus(status: string): string {
  switch (status.toUpperCase()) {
    case 'RECEIVED':
      return 'NEW';
    case 'PREPARING':
      return 'PREPARING';
    case 'READY':
      return 'READY';
    case 'SERVED':
      return 'SERVED';
    case 'CANCELLED':
      return 'CANCELLED';
    default:
      return status.toUpperCase();
  }
}

export function centsToDollars(cents: number): number {
  return Math.round(cents) / 100;
}

// ---------------------------------------------------------------------------
// Restaurant
// ---------------------------------------------------------------------------

export interface CustomerRestaurant {
  restaurantId: string;
  name: string;
  tagline: string;
  cuisine: string;
  address: string;
  phone: string;
  hours: string;
  isActive: boolean;
  taxRate: number;
  serviceChargeRate: number;
  coordinates: { lat: number; lng: number };
  geofenceRadiusMeters: number;
}

export function toCustomerRestaurant(restaurant: Restaurant): CustomerRestaurant {
  return {
    restaurantId: restaurant.id,
    name: restaurant.name,
    tagline: restaurant.tagline ?? '',
    cuisine: restaurant.cuisine ?? '',
    address: restaurant.address ?? '',
    phone: restaurant.phone ?? '',
    hours: restaurant.hours ?? '',
    isActive: true,
    taxRate: restaurant.taxRateBps / 10000,
    serviceChargeRate: restaurant.serviceChargeBps / 10000,
    coordinates: {
      lat: restaurant.latitude ?? 0,
      lng: restaurant.longitude ?? 0,
    },
    geofenceRadiusMeters: restaurant.geofenceRadiusMeters,
  };
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

export type MenuItemWithOptions = MenuItem & {
  variations: MenuItemVariation[];
  extras: MenuItemExtra[];
  category?: { name: string } | null;
};

export interface CustomerCustomizationChoice {
  id: string;
  label: string;
  priceDelta: number;
}

export interface CustomerCustomizationGroup {
  id: string;
  name: string;
  required: boolean;
  choices: CustomerCustomizationChoice[];
}

export interface CustomerMenuItem {
  id: string;
  restaurantId: string;
  name: string;
  description: string;
  category: CustomerCategory;
  price: number;
  image: string;
  fallbackImage: string;
  isAvailable: boolean;
  dietary: CustomerDietary;
  prepTimeMinutes: number;
  allergens: string[];
  popular: boolean;
  customizations: CustomerCustomizationGroup[];
}

export const VARIATIONS_GROUP_ID = 'variations';
export const EXTRAS_GROUP_ID = 'extras';

export function toCustomerMenuItem(
  item: MenuItemWithOptions,
  assetBaseUrl?: string
): CustomerMenuItem {
  const customizations: CustomerCustomizationGroup[] = [];

  const variations = (item.variations ?? []).filter((v) => v.isAvailable);
  if (variations.length > 0) {
    customizations.push({
      id: VARIATIONS_GROUP_ID,
      name: 'Options',
      required: false,
      choices: variations.map((v) => ({
        id: v.id,
        label: v.name,
        priceDelta: centsToDollars(v.priceDeltaCents),
      })),
    });
  }

  const extras = (item.extras ?? []).filter((e) => e.isAvailable);
  if (extras.length > 0) {
    customizations.push({
      id: EXTRAS_GROUP_ID,
      name: 'Extras',
      required: false,
      choices: [
        // The customer app preselects the first choice of every group, so a
        // zero-priced "no extras" default keeps the base price intact.
        { id: 'no_extra', label: 'No extras', priceDelta: 0 },
        ...extras.map((e) => ({
          id: e.id,
          label: e.name,
          priceDelta: centsToDollars(e.priceCents),
        })),
      ],
    });
  }

  return {
    id: item.id,
    restaurantId: item.restaurantId,
    name: item.name,
    description: item.description ?? '',
    category: toCustomerCategory(item.category?.name ?? 'Mains'),
    price: centsToDollars(item.priceCents),
    // Empty image => the customer app renders its house photo instead of a
    // broken <picture> element.
    image: resolveAssetUrl(item.imageUrl, assetBaseUrl),
    fallbackImage: '',
    isAvailable: item.isAvailable && !item.isArchived,
    dietary: toCustomerDietary(item.dietaryType),
    prepTimeMinutes: item.prepTimeMinutes,
    allergens: JSON.parse(item.allergensJson || '[]') as string[],
    popular: false,
    customizations,
  };
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface CustomerSelectedOption {
  groupId: string;
  groupName: string;
  choiceId: string;
  choiceLabel: string;
  priceDelta: number;
}

export interface CustomerSessionPayload {
  sessionId: string;
  sessionSignature: string;
  restaurantId: string;
  tableId: string;
  tableNumber: string;
  tableLabel: string;
  seats: number;
  entryMethod: 'QR' | 'NFC';
  restaurant: CustomerRestaurant;
  locationStatus: CustomerLocationStatus;
  distanceMeters: number | null;
  requiresAdditionalVerification: boolean;
  challengeVerified: boolean;
  createdAt: string;
  expiresAt: string;
}

export interface SessionContext {
  session: CustomerSession;
  restaurant: Restaurant;
  table: RestaurantTable;
  token: TableToken;
}

export function toCustomerSession(
  ctx: SessionContext,
  extra: {
    distanceMeters?: number | null;
    locationStatus?: CustomerLocationStatus;
  } = {}
): CustomerSessionPayload {
  const locationStatus: CustomerLocationStatus =
    extra.locationStatus ??
    (ctx.session.locationStatus as CustomerLocationStatus) ??
    'unverified';

  return {
    sessionId: ctx.session.id,
    sessionSignature: ctx.session.sessionSignature,
    restaurantId: ctx.restaurant.id,
    tableId: ctx.table.id,
    tableNumber: ctx.table.tableNumber,
    tableLabel: ctx.table.label ?? `Table ${ctx.table.tableNumber}`,
    seats: ctx.table.capacity,
    entryMethod: ctx.token.entryMethod === 'NFC' ? 'NFC' : 'QR',
    restaurant: toCustomerRestaurant(ctx.restaurant),
    locationStatus,
    distanceMeters: extra.distanceMeters ?? null,
    requiresAdditionalVerification:
      locationStatus === 'flagged_outside_geofence' && !ctx.session.challengeVerified,
    challengeVerified: ctx.session.challengeVerified,
    createdAt: ctx.session.createdAt.toISOString(),
    expiresAt: ctx.session.expiresAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export interface CustomerOrderLine {
  itemId: string;
  name: string;
  image: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  selectedOptions: CustomerSelectedOption[];
  notes?: string;
}

export interface CustomerOrder {
  orderId: string;
  restaurantId: string;
  restaurantName: string;
  tableId: string;
  tableNumber: string;
  tableLabel: string;
  sessionId: string;
  items: CustomerOrderLine[];
  subtotal: number;
  taxAmount: number;
  serviceCharge: number;
  grandTotal: number;
  status: CustomerOrderStatus;
  orderMode: 'table_cart' | 'only_this';
  locationStatus: CustomerLocationStatus;
  createdAt: string;
  updatedAt: string;
  estimatedMinutes: number;
  cancellableUntil: string;
  cancellationReason?: string;
}

type OrderForCustomer = Order & {
  table: Pick<RestaurantTable, 'id' | 'tableNumber' | 'label'>;
  items: (OrderItem & { menuItem?: { imageUrl: string | null } | null })[];
};

export const CANCELLATION_GRACE_MS = 2 * 60 * 1000;

export function toCustomerOrder(
  order: OrderForCustomer,
  ctx: {
    restaurantName: string;
    locationStatus?: CustomerLocationStatus;
    estimatedMinutes?: number;
    assetBaseUrl?: string;
  }
): CustomerOrder {
  const items: CustomerOrderLine[] = order.items.map((item) => {
    const variations = JSON.parse(item.variationsSnapshotJson || '[]') as Array<{
      id: string;
      name: string;
      priceDeltaCents: number;
    }>;
    const extras = JSON.parse(item.extrasSnapshotJson || '[]') as Array<{
      id: string;
      name: string;
      priceCents: number;
    }>;

    const selectedOptions: CustomerSelectedOption[] = [
      ...variations.map((v) => ({
        groupId: VARIATIONS_GROUP_ID,
        groupName: 'Options',
        choiceId: v.id,
        choiceLabel: v.name,
        priceDelta: centsToDollars(v.priceDeltaCents),
      })),
      ...extras.map((e) => ({
        groupId: EXTRAS_GROUP_ID,
        groupName: 'Extras',
        choiceId: e.id,
        choiceLabel: e.name,
        priceDelta: centsToDollars(e.priceCents),
      })),
    ];

    const effectiveUnitCents = item.unitPriceCents + item.extrasTotalCents;

    return {
      itemId: item.menuItemId ?? '',
      name: item.itemNameSnapshot,
      image: resolveAssetUrl(item.menuItem?.imageUrl, ctx.assetBaseUrl),
      unitPrice: centsToDollars(effectiveUnitCents),
      quantity: item.quantity,
      lineTotal: centsToDollars(item.lineTotalCents),
      selectedOptions,
      ...(item.specialInstructions ? { notes: item.specialInstructions } : {}),
    };
  });

  const estimatedMinutes =
    ctx.estimatedMinutes ??
    Math.max(8, ...order.items.map((i) => i.prepTimeMinutes ?? 0));

  return {
    orderId: order.id,
    restaurantId: order.restaurantId,
    restaurantName: ctx.restaurantName,
    tableId: order.tableId,
    tableNumber: order.table.tableNumber,
    tableLabel: order.table.label ?? `Table ${order.table.tableNumber}`,
    sessionId: order.customerSessionId ?? '',
    items,
    subtotal: centsToDollars(order.subtotalCents),
    taxAmount: centsToDollars(order.taxCents),
    serviceCharge: centsToDollars(order.serviceChargeCents),
    grandTotal: centsToDollars(order.totalCents),
    status: toCustomerStatus(order.status),
    orderMode: order.orderMode === 'only_this' ? 'only_this' : 'table_cart',
    locationStatus: ctx.locationStatus ?? 'unverified',
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    estimatedMinutes,
    cancellableUntil: new Date(
      order.createdAt.getTime() + CANCELLATION_GRACE_MS
    ).toISOString(),
    ...(order.status === 'CANCELLED' || order.status === 'REJECTED'
      ? {
          cancellationReason:
            order.rejectionReason ?? 'This ticket has been cancelled.',
        }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Session signatures & geofence
// ---------------------------------------------------------------------------

const SESSION_HMAC_SECRET =
  process.env.SESSION_HMAC_SECRET ?? 'maison-verbena-dev-session-secret-key';

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

export function verifySessionBinding(
  session: Pick<CustomerSession, 'id' | 'restaurantId' | 'tableId' | 'sessionSignature'>
): boolean {
  const expected = signSessionBinding(session.id, session.restaurantId, session.tableId);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(session.sessionSignature ?? '', 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function haversineDistanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
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
  return Math.round(earthRadiusMeters * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

export interface GpsInput {
  lat?: number;
  lng?: number;
  accuracy?: number;
}

export function evaluateGeofence(
  restaurant: Restaurant,
  gps?: GpsInput | null
): {
  status: CustomerLocationStatus;
  distanceMeters: number | null;
  requiresAdditionalVerification: boolean;
} {
  const hasCoordinates =
    restaurant.latitude != null && restaurant.longitude != null;

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

  if (!hasCoordinates) {
    // The restaurant has not configured coordinates: we cannot evaluate a
    // geofence, so we do not block the guest.
    return {
      status: 'unavailable',
      distanceMeters: null,
      requiresAdditionalVerification: false,
    };
  }

  const distance = haversineDistanceMeters(
    { lat: restaurant.latitude as number, lng: restaurant.longitude as number },
    { lat: gps.lat, lng: gps.lng }
  );

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
