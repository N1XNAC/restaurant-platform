(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  var globalObj = typeof window !== 'undefined' ? window : root;
  globalObj.MaisonVerbena = globalObj.MaisonVerbena || {};
  globalObj.MaisonVerbena.cart = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var ONLY_THIS_STORAGE_KEY = 'mv_only_this_draft_v1';
  var LAST_ORDER_STORAGE_KEY = 'mv_last_order_snapshot_v1';

  // --- Pure Pricing, Cart Key & Validation Helpers (Unit Tested) ---

  function roundCurrency(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  }

  function formatCurrency(value) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(roundCurrency(value || 0));
  }

  function computeEffectiveUnitPrice(basePrice, selectedOptions) {
    var baseCents = Math.round(Number(basePrice || 0) * 100);
    var deltaCents = 0;
    if (Array.isArray(selectedOptions)) {
      for (var i = 0; i < selectedOptions.length; i++) {
        deltaCents += Math.round(Number(selectedOptions[i].priceDelta || 0) * 100);
      }
    }
    return Math.max(0, baseCents + deltaCents) / 100;
  }

  function calculateLineTotal(unitPrice, quantity) {
    var safeQty = Math.max(0, Math.floor(Number(quantity) || 0));
    return (Math.round(Number(unitPrice || 0) * 100) * safeQty) / 100;
  }

  function calculateOrderBreakdown(items, taxRate, serviceChargeRate) {
    var safeTaxRate = taxRate == null ? 0.085 : Number(taxRate);
    var safeServiceRate = serviceChargeRate == null ? 0.05 : Number(serviceChargeRate);
    var subtotalCents = 0;
    var totalUnits = 0;

    var list = Array.isArray(items) ? items : [];
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      var safeQty = Math.max(0, Math.floor(Number(item.quantity) || 0));
      var effectiveUnit = computeEffectiveUnitPrice(item.unitPrice, item.selectedOptions);
      subtotalCents += Math.round(effectiveUnit * 100) * safeQty;
      totalUnits += safeQty;
    }

    var taxCents = Math.round(subtotalCents * safeTaxRate);
    var serviceCents = Math.round(subtotalCents * safeServiceRate);
    var grandTotalCents = subtotalCents + taxCents + serviceCents;

    return {
      subtotal: subtotalCents / 100,
      taxAmount: taxCents / 100,
      serviceCharge: serviceCents / 100,
      grandTotal: grandTotalCents / 100,
      totalUnits: totalUnits,
    };
  }

  function calculateTotalUnits(items) {
    var list = Array.isArray(items) ? items : [];
    var sum = 0;
    for (var i = 0; i < list.length; i++) {
      sum += Math.max(0, Math.floor(Number(list[i].quantity) || 0));
    }
    return sum;
  }

  function buildCartKey(itemId, selectedOptions, notes) {
    var sortedOpts = Array.isArray(selectedOptions)
      ? selectedOptions
          .slice()
          .sort(function (a, b) {
            return String(a.groupId).localeCompare(String(b.groupId));
          })
          .map(function (o) {
            return o.groupId + ':' + o.choiceId;
          })
          .join('|')
      : '';
    var cleanNote = String(notes || '').trim().toLowerCase();
    return itemId + '__' + sortedOpts + '__' + cleanNote;
  }

  function sanitizeKitchenNote(note) {
    return String(note || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
  }

  function isValidQuantity(quantity) {
    return Number.isInteger(quantity) && quantity >= 1 && quantity <= 25;
  }

  function isSessionActive(session) {
    if (!session) return false;
    if (!session.restaurant || !session.restaurant.isActive) return false;
    var expiresAtMs = Date.parse(session.expiresAt);
    if (Number.isNaN(expiresAtMs) || expiresAtMs <= Date.now()) {
      return false;
    }
    return true;
  }

  function canSubmitOrder(session, items) {
    if (!session) {
      return {
        valid: false,
        reason: 'No active table session. Please scan your table QR code or tap NFC.',
      };
    }
    if (!session.restaurant || !session.restaurant.isActive) {
      return {
        valid: false,
        reason: 'This restaurant is currently not accepting new orders.',
      };
    }
    if (!isSessionActive(session)) {
      return {
        valid: false,
        reason: 'Your table session has expired. Please re-scan the QR code on your table.',
      };
    }
    if (session.requiresAdditionalVerification && !session.challengeVerified) {
      return {
        valid: false,
        reason:
          'Additional table verification is required before placing an order. Enter the 4-digit table placard code.',
      };
    }
    if (!Array.isArray(items) || items.length === 0) {
      return {
        valid: false,
        reason: 'Select at least one dish before confirming your order.',
      };
    }
    for (var i = 0; i < items.length; i++) {
      if (!isValidQuantity(items[i].quantity)) {
        return {
          valid: false,
          reason: 'Item quantities must be between 1 and 25 per dish.',
        };
      }
    }
    return { valid: true };
  }

  // --- Browser Cart State & Persistence ---

  function getTableStorageKey(restaurantId, tableId) {
    return (
      'mv_table_cart_v1:' +
      (restaurantId || 'REST_001') +
      ':' +
      (tableId || 'TABLE_08')
    );
  }

  function readTableCart(key) {
    if (typeof localStorage === 'undefined') return [];
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_err) {
      return [];
    }
  }

  function writeTableCart(key, items) {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(key, JSON.stringify(items));
    } catch (_err) {
      // Non-fatal
    }
  }

  function readOnlyThisDraft() {
    if (typeof sessionStorage === 'undefined') return null;
    try {
      var raw = sessionStorage.getItem(ONLY_THIS_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_err) {
      return null;
    }
  }

  function writeOnlyThisDraft(item) {
    if (typeof sessionStorage === 'undefined') return;
    try {
      if (item) {
        sessionStorage.setItem(ONLY_THIS_STORAGE_KEY, JSON.stringify(item));
      } else {
        sessionStorage.removeItem(ONLY_THIS_STORAGE_KEY);
      }
    } catch (_err) {
      // Non-fatal
    }
  }

  var state = {
    storageKey: getTableStorageKey('REST_001', 'TABLE_08'),
    tableItems: [],
    onlyThisItem: readOnlyThisDraft(),
    lastAddedStamp: 0,
    toastMessage: null,
  };
  state.tableItems = readTableCart(state.storageKey);

  var toastTimer = null;
  var listeners = [];

  function getSnapshot() {
    return {
      storageKey: state.storageKey,
      tableItems: state.tableItems.slice(),
      onlyThisItem: state.onlyThisItem,
      totalUnits: calculateTotalUnits(state.tableItems),
      lastAddedStamp: state.lastAddedStamp,
      toastMessage: state.toastMessage,
    };
  }

  function notify() {
    var snap = getSnapshot();
    for (var i = 0; i < listeners.length; i++) {
      try {
        listeners[i](snap);
      } catch (_err) {
        // Ignore subscriber error
      }
    }
  }

  function showToast(message) {
    state.toastMessage = message;
    if (toastTimer && typeof clearTimeout === 'function') {
      clearTimeout(toastTimer);
    }
    if (typeof setTimeout === 'function') {
      toastTimer = setTimeout(function () {
        state.toastMessage = null;
        notify();
      }, 2600);
    }
  }

  function dismissToast() {
    state.toastMessage = null;
    if (toastTimer && typeof clearTimeout === 'function') {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    notify();
  }

  function bindSession(session) {
    var nextKey = getTableStorageKey(
      session && session.restaurantId,
      session && session.tableId
    );
    if (nextKey !== state.storageKey) {
      state.storageKey = nextKey;
      state.tableItems = readTableCart(nextKey);
      notify();
    }
  }

  function addToTable(item, quantity, selectedOptions, notes) {
    var safeQty = Math.max(1, Math.min(25, Math.floor(quantity == null ? 1 : quantity)));
    var opts = Array.isArray(selectedOptions) ? selectedOptions : [];
    var cleanNote = sanitizeKitchenNote(notes || '');
    var cartKey = buildCartKey(item.id, opts, cleanNote);

    var next = state.tableItems.slice();
    var idx = -1;
    for (var i = 0; i < next.length; i++) {
      if (next[i].cartKey === cartKey) {
        idx = i;
        break;
      }
    }

    if (idx >= 0) {
      next[idx] = Object.assign({}, next[idx], {
        quantity: Math.min(25, next[idx].quantity + safeQty),
      });
    } else {
      next.push({
        cartKey: cartKey,
        itemId: item.id,
        name: item.name,
        image: item.image,
        fallbackImage: item.fallbackImage,
        unitPrice: item.price,
        dietary: item.dietary,
        quantity: safeQty,
        selectedOptions: opts,
        notes: cleanNote || undefined,
      });
    }

    state.tableItems = next;
    writeTableCart(state.storageKey, next);
    state.lastAddedStamp = Date.now();
    showToast((safeQty > 1 ? safeQty + '× ' : '') + item.name + ' added to your table');
    notify();
  }

  function startOnlyThis(item, quantity, selectedOptions, notes) {
    var safeQty = Math.max(1, Math.min(25, Math.floor(quantity == null ? 1 : quantity)));
    var opts = Array.isArray(selectedOptions) ? selectedOptions : [];
    var cleanNote = sanitizeKitchenNote(notes || '');
    var cartKey = buildCartKey(item.id, opts, cleanNote);

    var draft = {
      cartKey: cartKey,
      itemId: item.id,
      name: item.name,
      image: item.image,
      fallbackImage: item.fallbackImage,
      unitPrice: item.price,
      dietary: item.dietary,
      quantity: safeQty,
      selectedOptions: opts,
      notes: cleanNote || undefined,
    };

    state.onlyThisItem = draft;
    writeOnlyThisDraft(draft);
    notify();
  }

  function updateTableItemQuantity(cartKey, nextQuantity) {
    var next;
    if (nextQuantity <= 0) {
      next = state.tableItems.filter(function (item) {
        return item.cartKey !== cartKey;
      });
    } else {
      var clamped = Math.min(25, Math.floor(nextQuantity));
      next = state.tableItems.map(function (item) {
        return item.cartKey === cartKey
          ? Object.assign({}, item, { quantity: clamped })
          : item;
      });
    }
    state.tableItems = next;
    writeTableCart(state.storageKey, next);
    notify();
  }

  function updateTableItemOptions(cartKey, nextOptions) {
    var target = null;
    for (var i = 0; i < state.tableItems.length; i++) {
      if (state.tableItems[i].cartKey === cartKey) {
        target = state.tableItems[i];
        break;
      }
    }
    if (!target) return;

    var nextKey = buildCartKey(target.itemId, nextOptions, target.notes || '');
    var withoutOld = state.tableItems.filter(function (entry) {
      return entry.cartKey !== cartKey;
    });

    var merged = false;
    var next = withoutOld.map(function (entry) {
      if (entry.cartKey === nextKey) {
        merged = true;
        return Object.assign({}, entry, {
          quantity: Math.min(25, entry.quantity + target.quantity),
        });
      }
      return entry;
    });

    if (!merged) {
      next.push(
        Object.assign({}, target, {
          cartKey: nextKey,
          selectedOptions: nextOptions,
        })
      );
    }

    state.tableItems = next;
    writeTableCart(state.storageKey, next);
    notify();
  }

  function removeTableItem(cartKey) {
    var next = state.tableItems.filter(function (item) {
      return item.cartKey !== cartKey;
    });
    state.tableItems = next;
    writeTableCart(state.storageKey, next);
    notify();
  }

  function clearTableCart() {
    state.tableItems = [];
    writeTableCart(state.storageKey, []);
    notify();
  }

  function updateOnlyThisQuantity(nextQuantity) {
    if (nextQuantity <= 0 || !state.onlyThisItem) {
      state.onlyThisItem = null;
      writeOnlyThisDraft(null);
      notify();
      return;
    }
    var clamped = Math.min(25, Math.floor(nextQuantity));
    state.onlyThisItem = Object.assign({}, state.onlyThisItem, { quantity: clamped });
    writeOnlyThisDraft(state.onlyThisItem);
    notify();
  }

  function updateOnlyThisOptions(nextOptions) {
    if (!state.onlyThisItem) return;
    state.onlyThisItem = Object.assign({}, state.onlyThisItem, {
      cartKey: buildCartKey(
        state.onlyThisItem.itemId,
        nextOptions,
        state.onlyThisItem.notes || ''
      ),
      selectedOptions: nextOptions,
    });
    writeOnlyThisDraft(state.onlyThisItem);
    notify();
  }

  function clearOnlyThis() {
    state.onlyThisItem = null;
    writeOnlyThisDraft(null);
    notify();
  }

  function mergeOnlyThisIntoTable() {
    if (!state.onlyThisItem) return;
    var draft = state.onlyThisItem;
    var next = state.tableItems.slice();
    var idx = -1;
    for (var i = 0; i < next.length; i++) {
      if (next[i].cartKey === draft.cartKey) {
        idx = i;
        break;
      }
    }
    if (idx >= 0) {
      next[idx] = Object.assign({}, next[idx], {
        quantity: Math.min(25, next[idx].quantity + draft.quantity),
      });
    } else {
      next.push(draft);
    }
    state.tableItems = next;
    writeTableCart(state.storageKey, next);
    state.onlyThisItem = null;
    writeOnlyThisDraft(null);
    state.lastAddedStamp = Date.now();
    showToast('Merged ' + draft.name + ' into your table order');
    notify();
  }

  function saveLastOrderSnapshot(order) {
    if (typeof sessionStorage === 'undefined') return;
    try {
      sessionStorage.setItem(LAST_ORDER_STORAGE_KEY, JSON.stringify(order));
    } catch (_err) {
      // Non-fatal
    }
  }

  function readLastOrderSnapshot(orderId) {
    if (typeof sessionStorage === 'undefined') return null;
    try {
      var raw = sessionStorage.getItem(LAST_ORDER_STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && parsed.orderId === orderId ? parsed : null;
    } catch (_err) {
      return null;
    }
  }

  return {
    roundCurrency: roundCurrency,
    formatCurrency: formatCurrency,
    computeEffectiveUnitPrice: computeEffectiveUnitPrice,
    calculateLineTotal: calculateLineTotal,
    calculateOrderBreakdown: calculateOrderBreakdown,
    calculateTotalUnits: calculateTotalUnits,
    buildCartKey: buildCartKey,
    sanitizeKitchenNote: sanitizeKitchenNote,
    isValidQuantity: isValidQuantity,
    isSessionActive: isSessionActive,
    canSubmitOrder: canSubmitOrder,
    subscribe: function (listener) {
      listeners.push(listener);
      listener(getSnapshot());
      return function () {
        listeners = listeners.filter(function (fn) {
          return fn !== listener;
        });
      };
    },
    getState: getSnapshot,
    bindSession: bindSession,
    addToTable: addToTable,
    startOnlyThis: startOnlyThis,
    updateTableItemQuantity: updateTableItemQuantity,
    updateTableItemOptions: updateTableItemOptions,
    removeTableItem: removeTableItem,
    clearTableCart: clearTableCart,
    updateOnlyThisQuantity: updateOnlyThisQuantity,
    updateOnlyThisOptions: updateOnlyThisOptions,
    clearOnlyThis: clearOnlyThis,
    mergeOnlyThisIntoTable: mergeOnlyThisIntoTable,
    dismissToast: dismissToast,
    saveLastOrderSnapshot: saveLastOrderSnapshot,
    readLastOrderSnapshot: readLastOrderSnapshot,
  };
});
