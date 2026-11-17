import type { OrderPricingBreakdown, SelectedOption } from './types';

export function computeEffectiveUnitPrice(
  basePrice: number,
  selectedOptions: SelectedOption[] = []
): number {
  const baseCents = Math.round(basePrice * 100);
  const deltaCents = selectedOptions.reduce(
    (sum, opt) => sum + Math.round((opt.priceDelta || 0) * 100),
    0
  );
  return Math.max(0, baseCents + deltaCents) / 100;
}

export function calculateOrderBreakdown(
  items: Array<{ unitPrice: number; quantity: number; selectedOptions: SelectedOption[] }>,
  taxRate: number,
  serviceChargeRate: number
): OrderPricingBreakdown {
  const subtotalCents = items.reduce((sum, item) => {
    const unitCents = Math.round(
      computeEffectiveUnitPrice(item.unitPrice, item.selectedOptions) * 100
    );
    const qty = Math.max(0, Math.floor(item.quantity));
    return sum + unitCents * qty;
  }, 0);

  const taxCents = Math.round(subtotalCents * Math.max(0, taxRate));
  const serviceCents = Math.round(subtotalCents * Math.max(0, serviceChargeRate));
  const totalUnits = items.reduce(
    (sum, item) => sum + Math.max(0, Math.floor(item.quantity)),
    0
  );

  return {
    subtotal: subtotalCents / 100,
    taxAmount: taxCents / 100,
    serviceCharge: serviceCents / 100,
    grandTotal: (subtotalCents + taxCents + serviceCents) / 100,
    totalUnits,
  };
}
