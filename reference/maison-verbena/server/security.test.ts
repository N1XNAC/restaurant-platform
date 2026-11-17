import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { RestaurantStore } from './store';
import { evaluateGeofence, haversineDistanceMeters } from './security';
import { RESTAURANTS } from './catalog';

function createTempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-store-'));
  const dbPath = path.join(dir, 'db.json');
  return new RestaurantStore(dbPath);
}

test('valid QR token creates authenticated session bound to REST_001 and TABLE_08', () => {
  const store = createTempStore();
  const session = store.validateQrNfcToken({
    token: 'QR_MV_T08_VALID',
    gps: { lat: 37.7749, lng: -122.4194, accuracy: 20 },
    clientIp: '127.0.0.1',
  });

  assert.equal(session.restaurantId, 'REST_001');
  assert.equal(session.tableId, 'TABLE_08');
  assert.equal(session.entryMethod, 'QR');
  assert.equal(session.locationStatus, 'verified');
  assert.equal(session.requiresAdditionalVerification, false);
  assert.ok(session.sessionId.startsWith('SESSION_'));
});

test('geofence flags outside coordinates and unlocks only with matching 4-digit table placard PIN', () => {
  const store = createTempStore();
  // ~2.4 km away from 37.7749, -122.4194
  const session = store.validateQrNfcToken({
    token: 'QR_MV_T08_VALID',
    gps: { lat: 37.795, lng: -122.405, accuracy: 15 },
    clientIp: '127.0.0.2',
  });

  assert.equal(session.locationStatus, 'flagged_outside_geofence');
  assert.equal(session.requiresAdditionalVerification, true);
  assert.equal(session.challengeVerified, false);

  assert.throws(
    () =>
      store.submitOrder({
        restaurantId: session.restaurantId,
        tableId: session.tableId,
        sessionId: session.sessionId,
        sessionSignature: session.sessionSignature,
        idempotencyKey: 'idem-blocked-1',
        orderMode: 'table_cart',
        items: [{ itemId: 'ITEM_001', quantity: 1 }],
        clientIp: '127.0.0.2',
      }),
    /placard code/i
  );

  // Wrong PIN rejected
  assert.throws(
    () =>
      store.verifyTableChallenge({
        sessionId: session.sessionId,
        sessionSignature: session.sessionSignature,
        pin: '9999',
        clientIp: '127.0.0.2',
      }),
    /does not match/i
  );

  // Valid Table 08 PIN (4082) unlocks session
  const unlocked = store.verifyTableChallenge({
    sessionId: session.sessionId,
    sessionSignature: session.sessionSignature,
    pin: '4082',
    clientIp: '127.0.0.2',
  });
  assert.equal(unlocked.challengeVerified, true);
  assert.equal(unlocked.requiresAdditionalVerification, false);
});

test('server rejects table spoofing, unavailable dishes, and ignores tampered client prices', () => {
  const store = createTempStore();
  const session = store.validateQrNfcToken({
    token: 'NFC_MV_T04_VALID',
    gps: null,
    clientIp: '127.0.0.3',
  });

  // 1. Tampering with tableId must be rejected and logged
  assert.throws(
    () =>
      store.submitOrder({
        restaurantId: 'REST_001',
        tableId: 'TABLE_99',
        sessionId: session.sessionId,
        sessionSignature: session.sessionSignature,
        idempotencyKey: 'idem-spoof-1',
        orderMode: 'table_cart',
        items: [{ itemId: 'ITEM_001', quantity: 1 }],
        clientIp: '127.0.0.3',
      }),
    /mismatch/i
  );

  // 2. Ordering sold-out dish ITEM_011 must fail
  assert.throws(
    () =>
      store.submitOrder({
        restaurantId: session.restaurantId,
        tableId: session.tableId,
        sessionId: session.sessionId,
        sessionSignature: session.sessionSignature,
        idempotencyKey: 'idem-soldout-1',
        orderMode: 'only_this',
        items: [{ itemId: 'ITEM_011', quantity: 1 }],
        clientIp: '127.0.0.3',
      }),
    /sold out/i
  );

  // 3. Tampered $0.01 frontend price must be ignored; server computes $24 x 2 = $48 + tax + service
  const order = store.submitOrder({
    restaurantId: session.restaurantId,
    tableId: session.tableId,
    sessionId: session.sessionId,
    sessionSignature: session.sessionSignature,
    idempotencyKey: 'idem-valid-1',
    orderMode: 'table_cart',
    items: [{ itemId: 'ITEM_001', quantity: 2, unitPrice: 0.01 }],
    clientIp: '127.0.0.3',
  });

  assert.equal(order.subtotal, 48);
  assert.equal(order.taxAmount, 4.08);
  assert.equal(order.serviceCharge, 2.4);
  assert.equal(order.grandTotal, 54.48);

  // 4. Duplicate idempotencyKey returns original order without creating a second order
  const duplicate = store.submitOrder({
    restaurantId: session.restaurantId,
    tableId: session.tableId,
    sessionId: session.sessionId,
    sessionSignature: session.sessionSignature,
    idempotencyKey: 'idem-valid-1',
    orderMode: 'table_cart',
    items: [{ itemId: 'ITEM_001', quantity: 2 }],
    clientIp: '127.0.0.3',
  });
  assert.equal(duplicate.orderId, order.orderId);

  const logs = store.getSecurityLogs();
  assert.ok(logs.some((l) => l.eventType === 'TABLE_SPOOFING_ATTEMPT'));
  assert.ok(logs.some((l) => l.eventType === 'PRICE_TAMPERING_DETECTED'));
  assert.ok(logs.some((l) => l.eventType === 'UNAVAILABLE_ITEM_ATTEMPT'));
});

test('expired QR tokens and repeated invalid token attempts are flagged in security logs', () => {
  const store = createTempStore();
  assert.throws(
    () =>
      store.validateQrNfcToken({
        token: 'QR_MV_EXPIRED',
        clientIp: '127.0.0.9',
      }),
    /expired/i
  );

  for (let i = 0; i < 2; i++) {
    assert.throws(
      () => store.validateQrNfcToken({ token: 'BAD_TOK_' + i, clientIp: '127.0.0.10' }),
      /could not be verified/i
    );
  }
  assert.throws(
    () => store.validateQrNfcToken({ token: 'BAD_TOK_3', clientIp: '127.0.0.10' }),
    /Multiple invalid/i
  );
  assert.ok(
    store.getSecurityLogs().some((l) => l.eventType === 'REPEATED_INVALID_TOKEN')
  );
});

test('haversineDistanceMeters and evaluateGeofence calculate boundary cleanly', () => {
  const restaurant = RESTAURANTS.REST_001;
  const zeroDist = haversineDistanceMeters(
    restaurant.coordinates,
    restaurant.coordinates
  );
  assert.equal(zeroDist, 0);
  const res = evaluateGeofence(restaurant, {
    lat: restaurant.coordinates.lat,
    lng: restaurant.coordinates.lng,
    accuracy: 10,
  });
  assert.equal(res.status, 'verified');
});
