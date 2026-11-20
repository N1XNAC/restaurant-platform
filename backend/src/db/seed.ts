import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';

interface MenuDefinition {
  name: string;
  category: string;
  description: string;
  priceCents: number;
  prepTimeMinutes: number;
  dietaryType: 'VEG' | 'NON_VEG' | 'VEGAN';
  allergens: string[];
  image: string;
  isAvailable?: boolean;
  variations?: Array<{ name: string; priceDeltaCents: number }>;
  extras?: Array<{ name: string; priceCents: number }>;
  ingredients?: Array<{ name: string; quantityRequired: number }>;
}

/**
 * Demo catalogue shared by both applications. The customer website and the
 * restaurant app read the exact same rows, so a dish edited in the restaurant
 * app shows up on the customer site immediately.
 */
const MENU: MenuDefinition[] = [
  {
    name: 'Margherita Classica',
    category: 'Wood-Fired Pizza',
    description: 'San Marzano tomatoes, fior di latte mozzarella, fresh basil, EVOO.',
    priceCents: 1650,
    prepTimeMinutes: 12,
    dietaryType: 'VEG',
    allergens: ['Dairy', 'Gluten'],
    image: '/uploads/dish-woodfired-flatbread.webp',
    variations: [
      { name: 'Regular 12"', priceDeltaCents: 0 },
      { name: 'Large 16"', priceDeltaCents: 550 },
    ],
    extras: [
      { name: 'Extra Burrata', priceCents: 450 },
      { name: 'Truffle Oil Drizzle', priceCents: 300 },
    ],
    ingredients: [
      { name: 'Sourdough Dough Ball', quantityRequired: 1 },
      { name: 'San Marzano Tomato Sauce', quantityRequired: 120 },
      { name: 'Fresh Mozzarella', quantityRequired: 150 },
    ],
  },
  {
    name: 'Pan-Seared Atlantic Salmon',
    category: 'Mains',
    description: 'Crispy skin salmon with charred broccolini and lemon herb butter.',
    priceCents: 2600,
    prepTimeMinutes: 18,
    dietaryType: 'NON_VEG',
    allergens: ['Fish', 'Dairy'],
    image: '/uploads/dish-chef-tasting.webp',
    ingredients: [{ name: 'Atlantic Salmon Fillet', quantityRequired: 220 }],
  },
  {
    name: 'Wild Mushroom Risotto',
    category: 'Mains',
    description: 'Slow-simmered Arborio rice, porcini & cremini mushrooms, aged parmesan.',
    priceCents: 2100,
    prepTimeMinutes: 20,
    dietaryType: 'VEG',
    allergens: ['Dairy'],
    image: '/uploads/dish-appetizer.webp',
    extras: [{ name: 'Shaved Black Truffle', priceCents: 600 }],
    ingredients: [
      { name: 'Arborio Rice', quantityRequired: 180 },
      { name: 'Wild Mushrooms', quantityRequired: 120 },
    ],
  },
  {
    name: 'Little Gem Caesar',
    category: 'Starters',
    description: 'Crisp romaine, sourdough croutons, white anchovy dressing, parmigiano.',
    priceCents: 1300,
    prepTimeMinutes: 8,
    dietaryType: 'NON_VEG',
    allergens: ['Dairy', 'Gluten', 'Fish'],
    image: '/uploads/dish-appetizer.webp',
    ingredients: [{ name: 'Romaine Lettuce', quantityRequired: 150 }],
  },
  {
    name: 'Double Espresso Tonic',
    category: 'Beverages',
    description: 'Single-origin espresso over artisanal botanical tonic and orange peel.',
    priceCents: 650,
    prepTimeMinutes: 4,
    dietaryType: 'VEGAN',
    allergens: [],
    image: '/uploads/dish-botanical-spritz.webp',
    ingredients: [{ name: 'Espresso Beans', quantityRequired: 18 }],
  },
  {
    name: 'Classic Brioche Burger',
    category: 'Mains',
    description:
      'Dry-aged chuck patty, aged cave cheddar, charred sweet shallots, butter lettuce, house brioche.',
    priceCents: 2400,
    prepTimeMinutes: 16,
    dietaryType: 'NON_VEG',
    allergens: ['Gluten', 'Dairy', 'Egg'],
    image: '/uploads/dish-burger.webp',
    variations: [
      { name: 'Medium Rare', priceDeltaCents: 0 },
      { name: 'Medium', priceDeltaCents: 0 },
      { name: 'Well Done', priceDeltaCents: 0 },
    ],
    extras: [
      { name: 'Herb Pommes Frites', priceCents: 600 },
      { name: 'Extra Cave Cheddar', priceCents: 300 },
    ],
  },
  {
    name: 'Hokkaido Scallops & Sea Fennel',
    category: 'Starters',
    description:
      'Pan-seared diver scallops over roasted sunchoke purée, Meyer lemon brown butter, crisp caper leaf.',
    priceCents: 2600,
    prepTimeMinutes: 12,
    dietaryType: 'NON_VEG',
    allergens: ['Shellfish', 'Dairy'],
    image: '/uploads/dish-scallops.webp',
  },
  {
    name: 'Dry-Aged Côte de Boeuf',
    category: 'Mains',
    description:
      '35-day pasture-raised ribeye seared over almond wood, bone marrow jus, charred cipollini.',
    priceCents: 4800,
    prepTimeMinutes: 22,
    dietaryType: 'NON_VEG',
    allergens: [],
    image: '/uploads/dish-steak.webp',
    variations: [
      { name: 'Rare', priceDeltaCents: 0 },
      { name: 'Medium Rare', priceDeltaCents: 0 },
      { name: 'Medium', priceDeltaCents: 0 },
    ],
  },
  {
    name: 'Crisp Liberty Duck Breast',
    category: 'Mains',
    description:
      'Honey-lavender lacquered duck, sour cherry reduction, roasted baby turnips, crispy skin.',
    priceCents: 3900,
    prepTimeMinutes: 20,
    dietaryType: 'NON_VEG',
    allergens: [],
    image: '/uploads/dish-duck.webp',
  },
  {
    name: 'Warm Valrhona Hazelnut Tart',
    category: 'Desserts',
    description:
      'Bittersweet dark chocolate ganache, roasted Piedmont hazelnut praline, cultured crème fraîche.',
    priceCents: 1600,
    prepTimeMinutes: 9,
    dietaryType: 'VEG',
    allergens: ['Gluten', 'Dairy', 'Egg', 'Tree Nuts'],
    image: '/uploads/dish-dessert.webp',
  },
  {
    name: 'Yuzu & Lemon Verbena Spritz',
    category: 'Beverages',
    description:
      'Cold-pressed yuzu juice, garden lemon verbena infusion, dry botanical verjus, sparkling mineral water.',
    priceCents: 1300,
    prepTimeMinutes: 4,
    dietaryType: 'VEGAN',
    allergens: [],
    image: '/uploads/dish-botanical-spritz.webp',
    variations: [
      { name: 'Zero-Proof Botanical', priceDeltaCents: 0 },
      { name: 'With Franciacorta Brut', priceDeltaCents: 500 },
    ],
  },
  {
    name: 'Reserve Cellar Sommelier Flight',
    category: 'Beverages',
    description:
      'Three curated half-glasses from biodynamic hillside vineyards (selected tableside by our sommelier).',
    priceCents: 3400,
    prepTimeMinutes: 5,
    dietaryType: 'VEGAN',
    allergens: ['Sulfites'],
    image: '/uploads/dish-wine.webp',
  },
  {
    name: 'Foraged Morel & Egg Yolk Raviolo',
    category: 'Mains',
    description:
      'Seasonal mountain morels, handmade pasta sheet, aged comté emulsion. Limited nightly harvest.',
    priceCents: 3100,
    prepTimeMinutes: 18,
    dietaryType: 'VEG',
    allergens: ['Gluten', 'Dairy', 'Egg'],
    image: '/uploads/dish-chef-tasting.webp',
    isAvailable: false,
  },
];

const TABLE_TOKENS = [
  {
    token: 'QR_MV_T08_VALID',
    tableNumber: 'T-08',
    entryMethod: 'QR',
    placardPin: '4082',
    status: 'active',
  },
  {
    token: 'NFC_MV_T04_VALID',
    tableNumber: 'T-04',
    entryMethod: 'NFC',
    placardPin: '4041',
    status: 'active',
  },
  {
    token: 'QR_MV_T12_VALID',
    tableNumber: 'T-12',
    entryMethod: 'QR',
    placardPin: '4126',
    status: 'active',
  },
  {
    token: 'QR_MV_EXPIRED',
    tableNumber: 'T-02',
    entryMethod: 'QR',
    placardPin: '4020',
    status: 'expired',
  },
];

async function main() {
  // The container can seed itself on first boot (SEED_ON_BOOT). Catalogue rows
  // are upserted, but demo orders and reviews are inserts, so only populate a
  // database that has never been seeded. Set SEED_FORCE=true to reseed anyway.
  if (process.env.SEED_IF_EMPTY === 'true' && process.env.SEED_FORCE !== 'true') {
    const existing = await prisma.restaurant.count();
    if (existing > 0) {
      console.log('Seed skipped: the database already contains a restaurant.');
      return;
    }
  }

  const restaurant = await prisma.restaurant.upsert({
    where: { slug: 'bistro-lumiere' },
    update: {
      tagline: 'Seasonal Hearth & Botanical Kitchen',
      cuisine: 'Contemporary Seasonal European',
      hours: 'Wed–Sun · 17:00 – 22:30',
      taxRateBps: 850, // 8.50%
      serviceChargeBps: 500, // 5.00%
      address: '42 Linden Courtyard, San Francisco, CA 94102',
      phone: '+1 (415) 555-0184',
      latitude: 37.7749,
      longitude: -122.4194,
      geofenceRadiusMeters: 250,
    },
    create: {
      id: 'rest-bistro-lumiere',
      name: 'Bistro Lumiere',
      slug: 'bistro-lumiere',
      tagline: 'Seasonal Hearth & Botanical Kitchen',
      cuisine: 'Contemporary Seasonal European',
      hours: 'Wed–Sun · 17:00 – 22:30',
      taxRateBps: 850,
      serviceChargeBps: 500,
      currency: 'USD',
      address: '42 Linden Courtyard, San Francisco, CA 94102',
      phone: '+1 (415) 555-0184',
      email: 'ops@bistrolumiere.local',
      timezone: 'America/Los_Angeles',
      latitude: 37.7749,
      longitude: -122.4194,
      geofenceRadiusMeters: 250,
    },
  });

  const passwordHash = await bcrypt.hash('Password123!', 10);

  const staffAccounts = [
    { email: 'owner@bistro.local', name: 'Elena Vance', role: 'OWNER' },
    { email: 'admin@bistro.local', name: 'Marcus Chen', role: 'ADMIN' },
    { email: 'manager@bistro.local', name: 'Priya Nair', role: 'MANAGER' },
    { email: 'waiter@bistro.local', name: 'Lucas Morales', role: 'WAITER' },
    { email: 'kitchen@bistro.local', name: 'Chef Marco Rossi', role: 'KITCHEN_STAFF' },
  ];

  let waiterId: string | undefined;
  for (const s of staffAccounts) {
    const user = await prisma.staffUser.upsert({
      where: { email: s.email },
      update: { name: s.name, role: s.role, isActive: true },
      create: {
        restaurantId: restaurant.id,
        email: s.email,
        name: s.name,
        passwordHash,
        role: s.role,
      },
    });
    if (s.role === 'WAITER') waiterId = user.id;
  }

  // Tables (T-01 … T-12). T-04, T-08 and T-12 back the demo QR/NFC placards.
  const tableLabels: Record<string, string> = {
    'T-04': 'Table 04 · Courtyard Terrace',
    'T-08': 'Table 08 · Window Booth',
    'T-12': "Table 12 · Chef's Counter",
  };
  const tables: Record<string, string> = {};
  for (let i = 1; i <= 12; i++) {
    const tableNumber = `T-${String(i).padStart(2, '0')}`;
    const saved = await prisma.restaurantTable.upsert({
      where: {
        restaurantId_tableNumber: { restaurantId: restaurant.id, tableNumber },
      },
      update: {
        label: tableLabels[tableNumber] ?? (i <= 4 ? `Main Hall ${i}` : `Patio ${i - 4}`),
      },
      create: {
        restaurantId: restaurant.id,
        tableNumber,
        label: tableLabels[tableNumber] ?? (i <= 4 ? `Main Hall ${i}` : `Patio ${i - 4}`),
        capacity: i % 2 === 0 ? 4 : 2,
        status: 'AVAILABLE',
        assignedWaiterId: i <= 4 ? waiterId : null,
      },
    });
    tables[tableNumber] = saved.id;
  }

  // Menu categories. "Wood-Fired Pizza" is kept for the restaurant app; the
  // customer adapter maps it onto "Wood-Fired".
  const categoryDefs = [
    { name: 'Starters', sortOrder: 1, description: 'Appetizers and small plates' },
    { name: 'Mains', sortOrder: 2, description: 'Signature entrees and grill' },
    { name: 'Wood-Fired Pizza', sortOrder: 3, description: 'Hand-stretched sourdough pizzas' },
    { name: 'Desserts', sortOrder: 4, description: 'Pastry and sweet finishes' },
    { name: 'Beverages', sortOrder: 5, description: 'Craft sodas, coffee, and mocktails' },
  ];

  const categories: Record<string, string> = {};
  for (const cat of categoryDefs) {
    const saved = await prisma.menuCategory.upsert({
      where: { restaurantId_name: { restaurantId: restaurant.id, name: cat.name } },
      update: { sortOrder: cat.sortOrder, description: cat.description },
      create: {
        restaurantId: restaurant.id,
        name: cat.name,
        sortOrder: cat.sortOrder,
        description: cat.description,
      },
    });
    categories[cat.name] = saved.id;
  }

  // Ingredients
  const ingredientDefs = [
    { name: 'Sourdough Dough Ball', unit: 'pcs', stockQty: 80, lowStockThreshold: 15, costPerUnitCents: 120 },
    { name: 'San Marzano Tomato Sauce', unit: 'ml', stockQty: 12000, lowStockThreshold: 2000, costPerUnitCents: 1 },
    { name: 'Fresh Mozzarella', unit: 'g', stockQty: 8000, lowStockThreshold: 1500, costPerUnitCents: 2 },
    { name: 'Atlantic Salmon Fillet', unit: 'g', stockQty: 5000, lowStockThreshold: 1000, costPerUnitCents: 4 },
    { name: 'Arborio Rice', unit: 'g', stockQty: 9000, lowStockThreshold: 1500, costPerUnitCents: 1 },
    { name: 'Wild Mushrooms', unit: 'g', stockQty: 3500, lowStockThreshold: 800, costPerUnitCents: 3 },
    { name: 'Romaine Lettuce', unit: 'g', stockQty: 4000, lowStockThreshold: 800, costPerUnitCents: 1 },
    { name: 'Espresso Beans', unit: 'g', stockQty: 3000, lowStockThreshold: 500, costPerUnitCents: 3 },
  ];

  const ingredients: Record<string, string> = {};
  for (const ing of ingredientDefs) {
    const saved = await prisma.ingredient.upsert({
      where: { restaurantId_name: { restaurantId: restaurant.id, name: ing.name } },
      update: {},
      create: {
        restaurantId: restaurant.id,
        ...ing,
      },
    });
    ingredients[ing.name] = saved.id;
  }

  // Menu items: upsert by name so re-seeding never duplicates dishes and never
  // throws away historical order snapshots.
  for (const def of MENU) {
    const existing = await prisma.menuItem.findFirst({
      where: { restaurantId: restaurant.id, name: def.name },
      include: { variations: true, extras: true },
    });

    const base = {
      categoryId: categories[def.category],
      description: def.description,
      priceCents: def.priceCents,
      prepTimeMinutes: def.prepTimeMinutes,
      dietaryType: def.dietaryType,
      allergensJson: JSON.stringify(def.allergens),
      imageUrl: def.image,
      isAvailable: def.isAvailable ?? true,
      isArchived: false,
    };

    const item = existing
      ? await prisma.menuItem.update({ where: { id: existing.id }, data: base })
      : await prisma.menuItem.create({
          data: { restaurantId: restaurant.id, name: def.name, ...base },
        });

    if (!existing) {
      if (def.variations?.length) {
        await prisma.menuItemVariation.createMany({
          data: def.variations.map((v) => ({ menuItemId: item.id, ...v })),
        });
      }
      if (def.extras?.length) {
        await prisma.menuItemExtra.createMany({
          data: def.extras.map((e) => ({ menuItemId: item.id, ...e })),
        });
      }
      if (def.ingredients?.length) {
        await prisma.menuItemIngredient.createMany({
          data: def.ingredients.map((i) => ({
            menuItemId: item.id,
            ingredientId: ingredients[i.name],
            quantityRequired: i.quantityRequired,
          })),
        });
      }
    }
  }

  // QR / NFC table placards used by the customer website.
  for (const def of TABLE_TOKENS) {
    const tableId = tables[def.tableNumber];
    if (!tableId) continue;
    await prisma.tableToken.upsert({
      where: { token: def.token },
      update: {
        tableId,
        entryMethod: def.entryMethod,
        placardPin: def.placardPin,
        status: def.status,
      },
      create: {
        restaurantId: restaurant.id,
        tableId,
        token: def.token,
        entryMethod: def.entryMethod,
        placardPin: def.placardPin,
        status: def.status,
      },
    });
  }

  const reviewCount = await prisma.review.count({ where: { restaurantId: restaurant.id } });
  if (reviewCount === 0) {
    await prisma.review.create({
      data: {
        restaurantId: restaurant.id,
        customerName: 'Sophia Patel',
        rating: 5,
        comment: 'Loved the Margherita Classica and super fast table service!',
      },
    });
  }

  console.log('Seed completed for restaurant:', restaurant.name, `(${restaurant.id})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
