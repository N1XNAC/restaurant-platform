import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';

async function main() {
  const restaurant = await prisma.restaurant.upsert({
    where: { slug: 'bistro-lumiere' },
    update: {},
    create: {
      id: 'rest-bistro-lumiere',
      name: 'Bistro Lumiere',
      slug: 'bistro-lumiere',
      taxRateBps: 800, // 8.00%
      currency: 'USD',
      address: '240 Market Street, San Francisco, CA',
      phone: '+1 (415) 555-0192',
      email: 'ops@bistrolumiere.local',
      timezone: 'America/Los_Angeles',
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

  // Tables
  for (let i = 1; i <= 8; i++) {
    const tableNumber = `T-${String(i).padStart(2, '0')}`;
    await prisma.restaurantTable.upsert({
      where: {
        restaurantId_tableNumber: {
          restaurantId: restaurant.id,
          tableNumber,
        },
      },
      update: {},
      create: {
        restaurantId: restaurant.id,
        tableNumber,
        label: i <= 4 ? `Main Hall ${i}` : `Patio ${i - 4}`,
        capacity: i % 2 === 0 ? 4 : 2,
        status: 'AVAILABLE',
        assignedWaiterId: i <= 4 ? waiterId : null,
      },
    });
  }

  // Menu Categories
  const categoryDefs = [
    { name: 'Starters', sortOrder: 1, description: 'Appetizers and small plates' },
    { name: 'Mains', sortOrder: 2, description: 'Signature entrees and grill' },
    { name: 'Wood-Fired Pizza', sortOrder: 3, description: 'Hand-stretched sourdough pizzas' },
    { name: 'Beverages', sortOrder: 4, description: 'Craft sodas, coffee, and mocktails' },
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

  // Menu Items (only seed if empty)
  const existingItemCount = await prisma.menuItem.count({ where: { restaurantId: restaurant.id } });
  if (existingItemCount === 0) {
    const margherita = await prisma.menuItem.create({
      data: {
        restaurantId: restaurant.id,
        categoryId: categories['Wood-Fired Pizza'],
        name: 'Margherita Classica',
        description: 'San Marzano tomatoes, fior di latte mozzarella, fresh basil, EVOO.',
        priceCents: 1650,
        prepTimeMinutes: 12,
        dietaryType: 'VEG',
        allergensJson: JSON.stringify(['Dairy', 'Gluten']),
        variations: {
          create: [
            { name: 'Regular 12"', priceDeltaCents: 0 },
            { name: 'Large 16"', priceDeltaCents: 550 },
          ],
        },
        extras: {
          create: [
            { name: 'Extra Burrata', priceCents: 450 },
            { name: 'Truffle Oil Drizzle', priceCents: 300 },
          ],
        },
        ingredients: {
          create: [
            { ingredientId: ingredients['Sourdough Dough Ball'], quantityRequired: 1 },
            { ingredientId: ingredients['San Marzano Tomato Sauce'], quantityRequired: 120 },
            { ingredientId: ingredients['Fresh Mozzarella'], quantityRequired: 150 },
          ],
        },
      },
    });

    await prisma.menuItem.create({
      data: {
        restaurantId: restaurant.id,
        categoryId: categories['Mains'],
        name: 'Pan-Seared Atlantic Salmon',
        description: 'Crispy skin salmon with charred broccolini and lemon herb butter.',
        priceCents: 2600,
        prepTimeMinutes: 18,
        dietaryType: 'NON_VEG',
        allergensJson: JSON.stringify(['Fish', 'Dairy']),
        ingredients: {
          create: [{ ingredientId: ingredients['Atlantic Salmon Fillet'], quantityRequired: 220 }],
        },
      },
    });

    await prisma.menuItem.create({
      data: {
        restaurantId: restaurant.id,
        categoryId: categories['Mains'],
        name: 'Wild Mushroom Risotto',
        description: 'Slow-simmered Arborio rice, porcini & cremini mushrooms, aged parmesan.',
        priceCents: 2100,
        prepTimeMinutes: 20,
        dietaryType: 'VEG',
        allergensJson: JSON.stringify(['Dairy']),
        extras: {
          create: [{ name: 'Shaved Black Truffle', priceCents: 600 }],
        },
        ingredients: {
          create: [
            { ingredientId: ingredients['Arborio Rice'], quantityRequired: 180 },
            { ingredientId: ingredients['Wild Mushrooms'], quantityRequired: 120 },
          ],
        },
      },
    });

    await prisma.menuItem.create({
      data: {
        restaurantId: restaurant.id,
        categoryId: categories['Starters'],
        name: 'Little Gem Caesar',
        description: 'Crisp romaine, sourdough croutons, white anchovy dressing, parmigiano.',
        priceCents: 1300,
        prepTimeMinutes: 8,
        dietaryType: 'NON_VEG',
        allergensJson: JSON.stringify(['Dairy', 'Gluten', 'Fish']),
        ingredients: {
          create: [{ ingredientId: ingredients['Romaine Lettuce'], quantityRequired: 150 }],
        },
      },
    });

    await prisma.menuItem.create({
      data: {
        restaurantId: restaurant.id,
        categoryId: categories['Beverages'],
        name: 'Double Espresso Tonic',
        description: 'Single-origin espresso over artisanal botanical tonic and orange peel.',
        priceCents: 650,
        prepTimeMinutes: 4,
        dietaryType: 'VEGAN',
        allergensJson: JSON.stringify([]),
        ingredients: {
          create: [{ ingredientId: ingredients['Espresso Beans'], quantityRequired: 18 }],
        },
      },
    });

    // Seed one sample review
    await prisma.review.create({
      data: {
        restaurantId: restaurant.id,
        customerName: 'Sophia Patel',
        rating: 5,
        comment: `Loved the ${margherita.name} and super fast table service!`,
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
