import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const cartSource = fs.readFileSync(path.resolve(process.cwd(), 'js/cart.js'), 'utf8');
const sandbox = {
  window: {},
  Intl,
  Date,
  Math,
  Number,
  String,
  Array,
  JSON,
  setTimeout,
  clearTimeout,
};
sandbox.globalThis = sandbox;
vm.runInNewContext(cartSource, sandbox);
const cartLogic = sandbox.window.MaisonVerbena.cart;

test('calculateTotalUnits sums quantities across virtual table items (2 + 1 + 3 = 6)', () => {
  const items = [
    { itemId: 'ITEM_001', quantity: 2, unitPrice: 24 },
    { itemId: 'ITEM_002', quantity: 1, unitPrice: 21 },
    { itemId: 'ITEM_003', quantity: 3, unitPrice: 13 },
  ];
  assert.equal(cartLogic.calculateTotalUnits(items), 6);
});

test('computeEffectiveUnitPrice and calculateOrderBreakdown handle option deltas and rounding cleanly', () => {
  const unitPrice = cartLogic.computeEffectiveUnitPrice(24, [
    { groupId: 'add_on', choiceId: 'truffle_fries', priceDelta: 6 },
  ]);
  assert.equal(unitPrice, 30);

  const breakdown = cartLogic.calculateOrderBreakdown(
    [
      {
        unitPrice: 24,
        quantity: 2,
        selectedOptions: [{ groupId: 'add_on', choiceId: 'raclette', priceDelta: 3 }],
      },
      {
        unitPrice: 13,
        quantity: 1,
        selectedOptions: [],
      },
    ],
    0.085,
    0.05
  );

  // Subtotal = (27 * 2) + 13 = 67.00
  // Tax = 67.00 * 0.085 = 5.695 -> 5.70
  // Service = 67.00 * 0.05 = 3.35
  // Grand Total = 76.05
  assert.equal(breakdown.subtotal, 67);
  assert.equal(breakdown.taxAmount, 5.7);
  assert.equal(breakdown.serviceCharge, 3.35);
  assert.equal(breakdown.grandTotal, 76.05);
  assert.equal(breakdown.totalUnits, 3);
});

test('buildCartKey normalizes customization option order and notes', () => {
  const k1 = cartLogic.buildCartKey(
    'ITEM_001',
    [
      { groupId: 'b', choiceId: '2' },
      { groupId: 'a', choiceId: '1' },
    ],
    '  No Onions '
  );
  const k2 = cartLogic.buildCartKey(
    'ITEM_001',
    [
      { groupId: 'a', choiceId: '1' },
      { groupId: 'b', choiceId: '2' },
    ],
    'no onions'
  );
  assert.equal(k1, k2);
});

test('canSubmitOrder enforces active session, geofence PIN verification, and valid quantities', () => {
  const activeSession = {
    sessionId: 'SESSION_1',
    restaurant: { isActive: true },
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    requiresAdditionalVerification: false,
    challengeVerified: true,
  };

  assert.equal(cartLogic.canSubmitOrder(null, []).valid, false);
  assert.equal(cartLogic.canSubmitOrder(activeSession, []).valid, false);

  const flaggedSession = {
    ...activeSession,
    requiresAdditionalVerification: true,
    challengeVerified: false,
  };
  assert.equal(
    cartLogic.canSubmitOrder(flaggedSession, [{ itemId: 'ITEM_001', quantity: 1 }]).valid,
    false
  );

  assert.equal(
    cartLogic.canSubmitOrder(activeSession, [{ itemId: 'ITEM_001', quantity: 2 }]).valid,
    true
  );
  assert.equal(
    cartLogic.canSubmitOrder(activeSession, [{ itemId: 'ITEM_001', quantity: 0 }]).valid,
    false
  );
});
