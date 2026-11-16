import type { Prisma } from '@prisma/client';
import { emitRealtimeEvent } from './realtime.js';

export async function deductInventoryForOrderTx(
  tx: Prisma.TransactionClient,
  params: {
    restaurantId: string;
    orderId: string;
    orderNumber: string;
    actorId?: string | null;
  }
): Promise<Array<{ ingredientId: string; name: string; stockQty: number; lowStockThreshold: number }>> {
  const order = await tx.order.findFirst({
    where: { id: params.orderId, restaurantId: params.restaurantId },
    include: {
      items: {
        include: {
          menuItem: {
            include: {
              ingredients: {
                include: { ingredient: true },
              },
            },
          },
        },
      },
    },
  });

  if (!order || order.inventoryDeductedAt) {
    return [];
  }

  // Aggregate total required per ingredient across all items in the order
  const requiredByIngredient = new Map<
    string,
    { qty: number; costPerUnitCents: number; name: string; lowStockThreshold: number }
  >();

  for (const item of order.items) {
    if (!item.menuItem) continue;
    for (const recipe of item.menuItem.ingredients) {
      const totalNeed = recipe.quantityRequired * item.quantity;
      const prev = requiredByIngredient.get(recipe.ingredientId);
      if (prev) {
        prev.qty += totalNeed;
      } else {
        requiredByIngredient.set(recipe.ingredientId, {
          qty: totalNeed,
          costPerUnitCents: recipe.ingredient.costPerUnitCents,
          name: recipe.ingredient.name,
          lowStockThreshold: recipe.ingredient.lowStockThreshold,
        });
      }
    }
  }

  const lowStockAlerts: Array<{
    ingredientId: string;
    name: string;
    stockQty: number;
    lowStockThreshold: number;
  }> = [];

  for (const [ingredientId, info] of requiredByIngredient.entries()) {
    const deductionKey = `${order.id}:${ingredientId}:CONSUMPTION`;
    const alreadyExists = await tx.inventoryTransaction.findUnique({
      where: { deductionKey },
      select: { id: true },
    });
    if (alreadyExists) continue;

    await tx.inventoryTransaction.create({
      data: {
        restaurantId: params.restaurantId,
        ingredientId,
        orderId: order.id,
        type: 'CONSUMPTION',
        quantityDelta: -info.qty,
        unitCostCents: info.costPerUnitCents,
        notes: `Order ${params.orderNumber} consumption`,
        deductionKey,
        createdById: params.actorId ?? null,
      },
    });

    const updatedIng = await tx.ingredient.update({
      where: { id: ingredientId },
      data: {
        stockQty: { decrement: info.qty },
      },
    });

    if (updatedIng.stockQty <= updatedIng.lowStockThreshold) {
      lowStockAlerts.push({
        ingredientId: updatedIng.id,
        name: updatedIng.name,
        stockQty: updatedIng.stockQty,
        lowStockThreshold: updatedIng.lowStockThreshold,
      });

      const notifKey = `low-stock:${updatedIng.id}:${new Date().toISOString().slice(0, 13)}`;
      await tx.notification.upsert({
        where: { dedupeKey: notifKey },
        update: {},
        create: {
          restaurantId: params.restaurantId,
          type: 'LOW_INVENTORY',
          title: `Low stock: ${updatedIng.name}`,
          message: `Remaining ${updatedIng.stockQty} ${updatedIng.unit} (threshold ${updatedIng.lowStockThreshold} ${updatedIng.unit})`,
          entityType: 'Ingredient',
          entityId: updatedIng.id,
          dedupeKey: notifKey,
        },
      });
    }
  }

  await tx.order.update({
    where: { id: order.id },
    data: { inventoryDeductedAt: new Date() },
  });

  return lowStockAlerts;
}

export async function emitLowStockAlerts(
  restaurantId: string,
  alerts: Array<{ ingredientId: string; name: string; stockQty: number; lowStockThreshold: number }>
) {
  for (const alert of alerts) {
    await emitRealtimeEvent(restaurantId, 'inventory.low_stock', alert);
    await emitRealtimeEvent(restaurantId, 'notification.created', {
      type: 'LOW_INVENTORY',
      title: `Low stock: ${alert.name}`,
    });
  }
}
