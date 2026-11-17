import type { MenuItem, RestaurantInfo } from './types';

export interface TableTokenDefinition {
  token: string;
  restaurantId: string;
  tableId: string;
  tableNumber: string;
  tableLabel: string;
  seats: number;
  entryMethod: 'QR' | 'NFC';
  placardPin: string;
  status: 'active' | 'expired' | 'revoked';
}

export const RESTAURANTS: Record<string, RestaurantInfo> = {
  REST_001: {
    restaurantId: 'REST_001',
    name: 'Maison Verbena',
    tagline: 'Seasonal Hearth & Botanical Kitchen',
    cuisine: 'Contemporary Seasonal European',
    address: '42 Linden Courtyard, San Francisco, CA 94102',
    phone: '+1 (415) 555-0184',
    hours: 'Wed–Sun · 17:00 – 22:30',
    isActive: true,
    taxRate: 0.085,
    serviceChargeRate: 0.05,
    coordinates: {
      lat: 37.7749,
      lng: -122.4194,
    },
    geofenceRadiusMeters: Number(process.env.DEFAULT_GEOFENCE_RADIUS_METERS || 250),
  },
};

export const TABLE_TOKENS: Record<string, TableTokenDefinition> = {
  QR_MV_T08_VALID: {
    token: 'QR_MV_T08_VALID',
    restaurantId: 'REST_001',
    tableId: 'TABLE_08',
    tableNumber: '08',
    tableLabel: 'Table 08 · Window Booth',
    seats: 4,
    entryMethod: 'QR',
    placardPin: '4082',
    status: 'active',
  },
  NFC_MV_T04_VALID: {
    token: 'NFC_MV_T04_VALID',
    restaurantId: 'REST_001',
    tableId: 'TABLE_04',
    tableNumber: '04',
    tableLabel: 'Table 04 · Courtyard Terrace',
    seats: 2,
    entryMethod: 'NFC',
    placardPin: '4041',
    status: 'active',
  },
  QR_MV_T12_VALID: {
    token: 'QR_MV_T12_VALID',
    restaurantId: 'REST_001',
    tableId: 'TABLE_12',
    tableNumber: '12',
    tableLabel: "Table 12 · Chef's Counter",
    seats: 6,
    entryMethod: 'QR',
    placardPin: '4126',
    status: 'active',
  },
  QR_MV_EXPIRED: {
    token: 'QR_MV_EXPIRED',
    restaurantId: 'REST_001',
    tableId: 'TABLE_02',
    tableNumber: '02',
    tableLabel: 'Table 02 · Archive Booth',
    seats: 2,
    entryMethod: 'QR',
    placardPin: '4020',
    status: 'expired',
  },
};

export const MENU_CATALOG: MenuItem[] = [
  {
    id: 'ITEM_001',
    restaurantId: 'REST_001',
    name: 'Classic Brioche Burger',
    description:
      'Dry-aged chuck patty, aged cave cheddar, charred sweet shallots, butter lettuce, house brioche.',
    category: 'Mains',
    price: 24.0,
    image: 'assets/images/dish_classic_burger_1794906232431.webp',
    fallbackImage: 'assets/images/dish_classic_burger_1794906232431.jpg',
    isAvailable: true,
    dietary: 'non-veg',
    prepTimeMinutes: 16,
    allergens: ['Gluten', 'Dairy', 'Egg'],
    popular: true,
    customizations: [
      {
        id: 'doneness',
        name: 'Preparation',
        required: true,
        choices: [
          { id: 'mr', label: 'Medium Rare', priceDelta: 0 },
          { id: 'med', label: 'Medium', priceDelta: 0 },
          { id: 'well', label: 'Well Done', priceDelta: 0 },
        ],
      },
      {
        id: 'add_on',
        name: 'Table Add-On',
        choices: [
          { id: 'none', label: 'Standard Plating', priceDelta: 0 },
          { id: 'truffle_fries', label: 'Herb Pommes Frites', priceDelta: 6.0 },
          { id: 'raclette', label: 'Extra Cave Cheddar', priceDelta: 3.0 },
        ],
      },
    ],
  },
  {
    id: 'ITEM_002',
    restaurantId: 'REST_001',
    name: 'Wood-Fired Margherita Flatbread',
    description:
      '48-hour sourdough crust blistered over white oak, San Marzano passata, fior di latte, sweet basil.',
    category: 'Wood-Fired',
    price: 21.0,
    image: 'assets/images/dish_woodfired_flatbread_1794906233483.webp',
    fallbackImage: 'assets/images/dish_woodfired_flatbread_1794906233483.jpg',
    isAvailable: true,
    dietary: 'veg',
    prepTimeMinutes: 14,
    allergens: ['Gluten', 'Dairy'],
    popular: true,
    customizations: [
      {
        id: 'cheese',
        name: 'Cheese Finish',
        choices: [
          { id: 'fior', label: 'Fior di Latte', priceDelta: 0 },
          { id: 'burrata', label: 'Whole Puglia Burrata', priceDelta: 4.5 },
          { id: 'vegan_cashew', label: 'Aged Cashew Mozzarella', priceDelta: 1.5 },
        ],
      },
    ],
  },
  {
    id: 'ITEM_003',
    restaurantId: 'REST_001',
    name: 'Yuzu & Lemon Verbena Spritz',
    description:
      'Cold-pressed yuzu juice, garden lemon verbena infusion, dry botanical verjus, sparkling mineral water.',
    category: 'Beverages',
    price: 13.0,
    image: 'assets/images/dish_botanical_spritz_1794906286060.webp',
    fallbackImage: 'assets/images/dish_botanical_spritz_1794906286060.jpg',
    isAvailable: true,
    dietary: 'vegan',
    prepTimeMinutes: 4,
    popular: true,
    customizations: [
      {
        id: 'spirit',
        name: 'Pour Style',
        required: true,
        choices: [
          { id: 'zero_proof', label: 'Zero-Proof Botanical', priceDelta: 0 },
          { id: 'prosecco', label: 'With Franciacorta Brut', priceDelta: 5.0 },
        ],
      },
    ],
  },
  {
    id: 'ITEM_004',
    restaurantId: 'REST_001',
    name: 'Hokkaido Scallops & Sea Fennel',
    description:
      'Pan-seared diver scallops over roasted sunchoke purée, Meyer lemon brown butter, crisp caper leaf.',
    category: 'Starters',
    price: 26.0,
    image: 'assets/images/wiki-scallops.webp',
    fallbackImage: 'assets/images/wiki-scallops.jpg',
    isAvailable: true,
    dietary: 'non-veg',
    prepTimeMinutes: 12,
    allergens: ['Shellfish', 'Dairy'],
    popular: true,
  },
  {
    id: 'ITEM_005',
    restaurantId: 'REST_001',
    name: 'Charred Leek & Herb Terrine',
    description:
      'Slow-braised heirloom leeks pressed with tarragon oil, toasted hazelnut crumble, aged sherry vinaigrette.',
    category: 'Starters',
    price: 18.0,
    image: 'assets/images/pexels-appetizer.webp',
    fallbackImage: 'assets/images/pexels-appetizer.jpg',
    isAvailable: true,
    dietary: 'vegan',
    prepTimeMinutes: 10,
    allergens: ['Tree Nuts'],
  },
  {
    id: 'ITEM_006',
    restaurantId: 'REST_001',
    name: 'Dry-Aged Côte de Boeuf',
    description:
      '35-day pasture-raised ribeye seared over almond wood, bone marrow jus, charred cipollini.',
    category: 'Mains',
    price: 48.0,
    image: 'assets/images/pexels-steak-wine.webp',
    fallbackImage: 'assets/images/pexels-steak-wine.jpg',
    isAvailable: true,
    dietary: 'non-veg',
    prepTimeMinutes: 22,
    customizations: [
      {
        id: 'doneness',
        name: 'Sear Temperature',
        required: true,
        choices: [
          { id: 'rare', label: 'Rare', priceDelta: 0 },
          { id: 'mr', label: 'Medium Rare', priceDelta: 0 },
          { id: 'med', label: 'Medium', priceDelta: 0 },
        ],
      },
    ],
  },
  {
    id: 'ITEM_007',
    restaurantId: 'REST_001',
    name: 'Crisp Liberty Duck Breast',
    description:
      'Honey-lavender lacquered duck, sour cherry reduction, roasted baby turnips, crispy skin.',
    category: 'Mains',
    price: 39.0,
    image: 'assets/images/wiki-duck.webp',
    fallbackImage: 'assets/images/wiki-duck.jpg',
    isAvailable: true,
    dietary: 'non-veg',
    prepTimeMinutes: 20,
  },
  {
    id: 'ITEM_008',
    restaurantId: 'REST_001',
    name: 'Artisanal Chef Tasting Plate',
    description:
      'Hand-rolled buckwheat agnolotti, glazed winter roots, smoked ricotta, toasted pistachio.',
    category: 'Wood-Fired',
    price: 29.0,
    image: 'assets/images/pexels-culinary-tokyo.webp',
    fallbackImage: 'assets/images/pexels-culinary-tokyo.jpg',
    isAvailable: true,
    dietary: 'veg',
    prepTimeMinutes: 16,
    allergens: ['Dairy', 'Tree Nuts'],
  },
  {
    id: 'ITEM_009',
    restaurantId: 'REST_001',
    name: 'Warm Valrhona Hazelnut Tart',
    description:
      'Bittersweet dark chocolate ganache, roasted Piedmont hazelnut praline, cultured crème fraîche.',
    category: 'Desserts',
    price: 16.0,
    image: 'assets/images/pexels-dessert-2.webp',
    fallbackImage: 'assets/images/pexels-dessert-2.jpg',
    isAvailable: true,
    dietary: 'veg',
    prepTimeMinutes: 9,
    allergens: ['Gluten', 'Dairy', 'Egg', 'Tree Nuts'],
  },
  {
    id: 'ITEM_010',
    restaurantId: 'REST_001',
    name: 'Reserve Cellar Sommelier Flight',
    description:
      'Three curated half-glasses from biodynamic hillside vineyards (selected tableside by our sommelier).',
    category: 'Beverages',
    price: 34.0,
    image: 'assets/images/wiki-wine-cellar.webp',
    fallbackImage: 'assets/images/wiki-wine-cellar.jpg',
    isAvailable: true,
    dietary: 'vegan',
    prepTimeMinutes: 5,
    allergens: ['Sulfites'],
  },
  {
    id: 'ITEM_011',
    restaurantId: 'REST_001',
    name: 'Foraged Morel & Egg Yolk Raviolo',
    description:
      'Seasonal mountain morels, handmade pasta sheet, aged comté emulsion. Limited nightly harvest.',
    category: 'Mains',
    price: 31.0,
    image: 'assets/images/pexels-interior-setup.webp',
    fallbackImage: 'assets/images/pexels-interior-setup.jpg',
    isAvailable: false,
    dietary: 'veg',
    prepTimeMinutes: 18,
    allergens: ['Gluten', 'Dairy', 'Egg'],
  },
];
