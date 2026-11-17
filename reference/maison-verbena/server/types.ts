export type DietaryType = 'veg' | 'non-veg' | 'vegan';

export type MenuCategory =
  | 'Starters'
  | 'Mains'
  | 'Wood-Fired'
  | 'Desserts'
  | 'Beverages';

export interface CustomizationChoice {
  id: string;
  label: string;
  priceDelta: number;
}

export interface CustomizationGroup {
  id: string;
  name: string;
  required?: boolean;
  choices: CustomizationChoice[];
}

export interface MenuItem {
  id: string;
  restaurantId: string;
  name: string;
  description: string;
  category: MenuCategory;
  price: number;
  image: string;
  fallbackImage?: string;
  isAvailable: boolean;
  dietary: DietaryType;
  prepTimeMinutes: number;
  allergens?: string[];
  popular?: boolean;
  customizations?: CustomizationGroup[];
}

export interface RestaurantCoordinates {
  lat: number;
  lng: number;
}

export interface RestaurantInfo {
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
  coordinates: RestaurantCoordinates;
  geofenceRadiusMeters: number;
}

export type LocationVerificationStatus =
  | 'unverified'
  | 'verified'
  | 'flagged_outside_geofence'
  | 'unavailable';

export interface TableSession {
  sessionId: string;
  sessionSignature: string;
  restaurantId: string;
  tableId: string;
  tableNumber: string;
  tableLabel: string;
  seats: number;
  entryMethod: 'QR' | 'NFC';
  restaurant: RestaurantInfo;
  locationStatus: LocationVerificationStatus;
  distanceMeters: number | null;
  requiresAdditionalVerification: boolean;
  challengeVerified: boolean;
  createdAt: string;
  expiresAt: string;
}

export interface SelectedOption {
  groupId: string;
  groupName: string;
  choiceId: string;
  choiceLabel: string;
  priceDelta: number;
}

export interface OrderPricingBreakdown {
  subtotal: number;
  taxAmount: number;
  serviceCharge: number;
  grandTotal: number;
  totalUnits: number;
}

export type OrderStatus =
  | 'RECEIVED'
  | 'PREPARING'
  | 'READY'
  | 'SERVED'
  | 'CANCELLED';

export interface OrderLineItem {
  itemId: string;
  name: string;
  image: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  selectedOptions: SelectedOption[];
  notes?: string;
}

export interface OrderRecord {
  orderId: string;
  restaurantId: string;
  restaurantName: string;
  tableId: string;
  tableNumber: string;
  tableLabel: string;
  sessionId: string;
  items: OrderLineItem[];
  subtotal: number;
  taxAmount: number;
  serviceCharge: number;
  grandTotal: number;
  status: OrderStatus;
  orderMode: 'table_cart' | 'only_this';
  locationStatus: LocationVerificationStatus;
  createdAt: string;
  updatedAt: string;
  estimatedMinutes: number;
  cancellableUntil: string;
  cancellationReason?: string;
}
