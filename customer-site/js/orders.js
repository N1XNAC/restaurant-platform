(function (global) {
  'use strict';

  var NS = (global.MaisonVerbena = global.MaisonVerbena || {});

  function createIdempotencyKey() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'req-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  }

  function initCartPage(options) {
    var rootEl = options.rootEl;
    var subtitleEl = options.subtitleEl;
    var pageTitleEl = options.pageTitleEl;
    var modeActionsEl = options.modeActionsEl;
    var onOpenTableModal = options.onOpenTableModal;

    var params = new URLSearchParams(global.location.search);
    var isOnlyThisMode = params.get('mode') === 'only-this';
    var catalogMap = {};
    var isSubmitting = false;
    var submitError = null;
    var idempotencyKey = createIdempotencyKey();
    var lastLineSignature = '';

    function getActiveItems(cartState) {
      if (isOnlyThisMode) {
        return cartState.onlyThisItem ? [cartState.onlyThisItem] : [];
      }
      return cartState.tableItems;
    }

    function render() {
      var esc = NS.config.escapeHtml;
      var cart = NS.cart;
      var sessionState = NS.session.getState();
      var session = sessionState.session;
      var cartState = cart.getState();
      var activeItems = getActiveItems(cartState);

      var lineSignature =
        (isOnlyThisMode ? 'only' : 'table') + ':' + activeItems.length;
      if (lineSignature !== lastLineSignature) {
        lastLineSignature = lineSignature;
        idempotencyKey = createIdempotencyKey();
        submitError = null;
      }

      if (pageTitleEl) {
        pageTitleEl.textContent = isOnlyThisMode
          ? 'Express Single-Item Order'
          : 'Virtual Table Review';
      }

      if (subtitleEl) {
        subtitleEl.textContent = session
          ? 'Ordering for ' + session.restaurant.name + ' · ' + session.tableLabel
          : 'Verify your table session before submitting';
      }

      if (modeActionsEl) {
        if (isOnlyThisMode && cartState.tableItems.length > 0) {
          modeActionsEl.innerHTML =
            '<button type="button" class="pill-btn pill-btn--outline pill-btn--sm" data-cart-action="merge-only-this">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>' +
            '<span>Merge with Table Cart (' +
            cartState.tableItems.length +
            ')</span>' +
            '</button>' +
            '<button type="button" class="pill-btn pill-btn--linen pill-btn--sm" data-cart-action="switch-to-table">View Table Cart</button>';
        } else {
          modeActionsEl.innerHTML = '';
        }
      }

      var alertsHtml = '';
      if (isOnlyThisMode && activeItems.length > 0) {
        var savedText =
          cartState.tableItems.length > 0
            ? ' Your ' +
              cartState.tableItems.length +
              ' previously selected table item(s) remain saved separately.'
            : '';
        alertsHtml +=
          '<div class="mode-banner"><strong>Only This Mode:</strong> Ordering this dish independently.' +
          esc(savedText) +
          '</div>';
      }

      if (
        session &&
        session.requiresAdditionalVerification &&
        !session.challengeVerified
      ) {
        alertsHtml +=
          '<div class="tamper-alert" style="margin-top: 1.25rem; padding: 0.9rem 1rem;">' +
          '<div class="tamper-alert-content">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>' +
          '<span>Your location appears outside the dining room geofence. Please confirm your 4-digit table placard code before submitting.</span>' +
          '</div>' +
          '<button type="button" class="pill-btn pill-btn--burgundy pill-btn--sm" data-cart-action="open-table-modal">Enter Table Code</button>' +
          '</div>';
      }

      if (activeItems.length === 0) {
        var emptyTitle = isOnlyThisMode
          ? 'No express item selected'
          : 'Your virtual table is currently empty';
        var extraBtn =
          isOnlyThisMode && cartState.tableItems.length > 0
            ? '<button type="button" class="pill-btn pill-btn--outline pill-btn--lg" data-cart-action="switch-to-table">Review Table Cart (' +
              cartState.tableItems.length +
              ')</button>'
            : '';

        rootEl.innerHTML =
          alertsHtml +
          '<div class="empty-state-card">' +
          '<div class="empty-state-icon" aria-hidden="true">' +
          '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m16 2-2.3 2.3a3 3 0 0 0 0 4.2l1.8 1.8a3 3 0 0 0 4.2 0L22 8"/><path d="M15 15 3.3 3.3a4.2 4.2 0 0 0 0 6l7.3 7.3c.7.7 2 .7 2.8 0L15 15Zm0 0 7 7"/><path d="m2.1 21.8 6.4-6.3"/><path d="m19 5-7 7"/></svg>' +
          '</div>' +
          '<h2 class="empty-state-title">' +
          emptyTitle +
          '</h2>' +
          '<p class="empty-state-desc">Browse tonight’s courses and tap Add to Table to build your shared order, or select Only This on any single plate.</p>' +
          '<div class="empty-state-actions">' +
          '<a href="index.html" class="pill-btn pill-btn--olive pill-btn--lg">Explore Menu</a>' +
          extraBtn +
          '</div>' +
          '</div>';
        return;
      }

      var itemsHtml = activeItems
        .map(function (entry) {
          var catalogItem = catalogMap[entry.itemId];
          var effectiveUnit = cart.computeEffectiveUnitPrice(
            entry.unitPrice,
            entry.selectedOptions
          );
          var lineTotal = cart.calculateLineTotal(effectiveUnit, entry.quantity);

          var optionsEditorHtml = '';
          if (
            catalogItem &&
            Array.isArray(catalogItem.customizations) &&
            catalogItem.customizations.length > 0
          ) {
            optionsEditorHtml =
              '<div class="review-options-wrap">' +
              catalogItem.customizations
                .map(function (group) {
                  var currentChoice =
                    (entry.selectedOptions || []).find(function (o) {
                      return o.groupId === group.id;
                    }) || {};
                  var currentId =
                    currentChoice.choiceId ||
                    (group.choices[0] && group.choices[0].id);

                  var choiceOpts = group.choices
                    .map(function (c) {
                      var deltaStr =
                        c.priceDelta > 0
                          ? ' (+' + cart.formatCurrency(c.priceDelta) + ')'
                          : '';
                      return (
                        '<option value="' +
                        esc(c.id) +
                        '"' +
                        (c.id === currentId ? ' selected' : '') +
                        '>' +
                        esc(c.label + deltaStr) +
                        '</option>'
                      );
                    })
                    .join('');

                  return (
                    '<label class="review-option-label">' +
                    '<span>' +
                    esc(group.name) +
                    ':</span>' +
                    '<select class="option-select" data-review-option-group="' +
                    esc(group.id) +
                    '" data-cart-key="' +
                    esc(entry.cartKey) +
                    '" data-item-id="' +
                    esc(entry.itemId) +
                    '" aria-label="' +
                    esc(group.name + ' for ' + entry.name) +
                    '">' +
                    choiceOpts +
                    '</select>' +
                    '</label>'
                  );
                })
                .join('') +
              '</div>';
          }

          return (
            '<article class="review-item-card" data-testid="review-item-' +
            esc(entry.itemId) +
            '">' +
            '<div class="review-item-thumb">' +
            NS.menu.renderPictureMarkup(
              entry.image,
              entry.fallbackImage,
              entry.name,
              true
            ) +
            '</div>' +
            '<div class="review-item-body">' +
            '<div>' +
            '<div class="review-item-head">' +
            '<div>' +
            NS.menu.renderDietBadge(entry.dietary) +
            '<h3 class="review-item-title">' +
            esc(entry.name) +
            '</h3>' +
            '<p class="review-item-unit tabular-nums">' +
            esc(cart.formatCurrency(effectiveUnit)) +
            ' each</p>' +
            '</div>' +
            '<span class="review-item-total tabular-nums">' +
            esc(cart.formatCurrency(lineTotal)) +
            '</span>' +
            '</div>' +
            optionsEditorHtml +
            '</div>' +
            '<div class="review-item-actions">' +
            '<div class="qty-stepper" role="group" aria-label="Quantity for ' +
            esc(entry.name) +
            '">' +
            '<button type="button" class="qty-btn" data-review-qty="dec" data-cart-key="' +
            esc(entry.cartKey) +
            '" aria-label="Decrease quantity of ' +
            esc(entry.name) +
            '"' +
            (entry.quantity <= 1 ? ' disabled' : '') +
            '>&minus;</button>' +
            '<span class="qty-value tabular-nums">' +
            entry.quantity +
            '</span>' +
            '<button type="button" class="qty-btn" data-review-qty="inc" data-cart-key="' +
            esc(entry.cartKey) +
            '" aria-label="Increase quantity of ' +
            esc(entry.name) +
            '"' +
            (entry.quantity >= 25 ? ' disabled' : '') +
            '>+</button>' +
            '</div>' +
            '<button type="button" class="remove-btn" data-cart-action="remove-item" data-cart-key="' +
            esc(entry.cartKey) +
            '" aria-label="Remove ' +
            esc(entry.name) +
            '">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>' +
            '<span>Remove</span>' +
            '</button>' +
            '</div>' +
            '</div>' +
            '</article>'
          );
        })
        .join('');

      var taxRate =
        session && session.restaurant
          ? session.restaurant.taxRate
          : NS.config.defaultTaxRate;
      var serviceRate =
        session && session.restaurant
          ? session.restaurant.serviceChargeRate
          : NS.config.defaultServiceChargeRate;
      var breakdown = cart.calculateOrderBreakdown(activeItems, taxRate, serviceRate);
      var preflight = cart.canSubmitOrder(session, activeItems);
      var validationText = submitError || (!preflight.valid ? preflight.reason : '');

      var summaryHtml =
        '<aside class="summary-card summary-sticky">' +
        '<h2 class="summary-title">Order Summary</h2>' +
        '<p class="summary-note">Final totals are verified by the restaurant server upon confirmation.</p>' +
        '<dl class="summary-ledger">' +
        '<div class="summary-row">' +
        '<dt>Subtotal (' +
        breakdown.totalUnits +
        ' ' +
        (breakdown.totalUnits === 1 ? 'unit' : 'units') +
        ')</dt>' +
        '<dd class="tabular-nums">' +
        esc(cart.formatCurrency(breakdown.subtotal)) +
        '</dd>' +
        '</div>' +
        '<div class="summary-row">' +
        '<dt>Applicable Taxes (' +
        (taxRate * 100).toFixed(1) +
        '%)</dt>' +
        '<dd class="tabular-nums">' +
        esc(cart.formatCurrency(breakdown.taxAmount)) +
        '</dd>' +
        '</div>' +
        '<div class="summary-row">' +
        '<dt>Dining Room Service (' +
        (serviceRate * 100).toFixed(0) +
        '%)</dt>' +
        '<dd class="tabular-nums">' +
        esc(cart.formatCurrency(breakdown.serviceCharge)) +
        '</dd>' +
        '</div>' +
        '<div class="summary-grand-row">' +
        '<dt>Grand Total</dt>' +
        '<dd data-testid="order-grand-total" class="tabular-nums">' +
        esc(cart.formatCurrency(breakdown.grandTotal)) +
        '</dd>' +
        '</div>' +
        '</dl>' +
        (validationText
          ? '<p role="alert" class="validation-box">' + esc(validationText) + '</p>'
          : '') +
        '<div class="summary-submit-wrap">' +
        '<button type="button" id="confirm-order-btn" data-testid="confirm-order-button" data-cart-action="confirm-order" class="pill-btn pill-btn--burgundy pill-btn--lg pill-btn--full"' +
        (!preflight.valid || isSubmitting ? ' disabled' : '') +
        '>' +
        (isSubmitting ? 'Validating & Sending Order...' : 'Confirm Order') +
        '</button>' +
        '</div>' +
        '<p class="summary-trust-note">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>' +
        '<span>Protected against duplicate submissions &amp; table mismatch</span>' +
        '</p>' +
        '</aside>';

      rootEl.innerHTML =
        alertsHtml +
        '<div class="review-layout">' +
        '<div class="review-items-list">' +
        itemsHtml +
        '</div>' +
        summaryHtml +
        '</div>';
    }

    async function handleConfirmOrder() {
      var session = NS.session.getState().session;
      var activeItems = getActiveItems(NS.cart.getState());
      if (isSubmitting || !session) return;

      var preflight = NS.cart.canSubmitOrder(session, activeItems);
      if (!preflight.valid) {
        submitError = preflight.reason || 'Unable to confirm order.';
        render();
        if (session.requiresAdditionalVerification && !session.challengeVerified) {
          onOpenTableModal();
        }
        return;
      }

      isSubmitting = true;
      submitError = null;
      render();

      try {
        var response = await NS.api.submitCustomerOrder({
          restaurantId: session.restaurantId,
          tableId: session.tableId,
          sessionId: session.sessionId,
          sessionSignature: session.sessionSignature,
          idempotencyKey: idempotencyKey,
          orderMode: isOnlyThisMode ? 'only_this' : 'table_cart',
          items: activeItems.map(function (entry) {
            return {
              itemId: entry.itemId,
              name: entry.name,
              quantity: entry.quantity,
              selectedOptions: entry.selectedOptions,
              notes: entry.notes,
            };
          }),
        });

        NS.cart.saveLastOrderSnapshot(response.order);

        if (isOnlyThisMode) {
          NS.cart.clearOnlyThis();
        } else {
          NS.cart.clearTableCart();
        }

        global.location.href =
          'order-confirmation.html?orderId=' +
          encodeURIComponent(response.order.orderId);
      } catch (err) {
        submitError =
          err && err.message
            ? err.message
            : 'Network interruption while sending your order. Please retry.';
        isSubmitting = false;
        render();
        if (err && err.requiresReverification) {
          onOpenTableModal();
        }
      }
    }

    function bindEvents() {
      document.addEventListener('click', function (e) {
        var qtyBtn = e.target.closest('button[data-review-qty]');
        if (qtyBtn) {
          var cartKey = qtyBtn.getAttribute('data-cart-key');
          var dir = qtyBtn.getAttribute('data-review-qty');
          var activeItems = getActiveItems(NS.cart.getState());
          var entry = activeItems.find(function (item) {
            return item.cartKey === cartKey;
          });
          if (!entry) return;
          var nextQty =
            dir === 'inc' ? Math.min(25, entry.quantity + 1) : Math.max(1, entry.quantity - 1);
          if (isOnlyThisMode) {
            NS.cart.updateOnlyThisQuantity(nextQty);
          } else {
            NS.cart.updateTableItemQuantity(cartKey, nextQty);
          }
          return;
        }

        var actionBtn = e.target.closest('[data-cart-action]');
        if (!actionBtn) return;
        var action = actionBtn.getAttribute('data-cart-action');

        if (action === 'remove-item') {
          var key = actionBtn.getAttribute('data-cart-key');
          if (isOnlyThisMode) {
            NS.cart.clearOnlyThis();
          } else {
            NS.cart.removeTableItem(key);
          }
        } else if (action === 'merge-only-this') {
          NS.cart.mergeOnlyThisIntoTable();
          isOnlyThisMode = false;
          global.history.replaceState({}, '', 'cart.html');
          render();
        } else if (action === 'switch-to-table') {
          isOnlyThisMode = false;
          global.history.replaceState({}, '', 'cart.html');
          render();
        } else if (action === 'open-table-modal') {
          onOpenTableModal();
        } else if (action === 'confirm-order') {
          handleConfirmOrder();
        }
      });

      rootEl.addEventListener('change', function (e) {
        var select = e.target.closest('select[data-review-option-group]');
        if (!select) return;
        var cartKey = select.getAttribute('data-cart-key');
        var itemId = select.getAttribute('data-item-id');
        var groupId = select.getAttribute('data-review-option-group');
        var choiceId = select.value;

        var catalogItem = catalogMap[itemId];
        var group =
          catalogItem &&
          (catalogItem.customizations || []).find(function (g) {
            return g.id === groupId;
          });
        var choice =
          group &&
          group.choices.find(function (c) {
            return c.id === choiceId;
          });
        if (!group || !choice) return;

        var activeItems = getActiveItems(NS.cart.getState());
        var entry = activeItems.find(function (item) {
          return item.cartKey === cartKey;
        });
        if (!entry) return;

        var nextOptions = (entry.selectedOptions || [])
          .filter(function (o) {
            return o.groupId !== groupId;
          })
          .concat([
            {
              groupId: group.id,
              groupName: group.name,
              choiceId: choice.id,
              choiceLabel: choice.label,
              priceDelta: choice.priceDelta,
            },
          ]);

        if (isOnlyThisMode) {
          NS.cart.updateOnlyThisOptions(nextOptions);
        } else {
          NS.cart.updateTableItemOptions(cartKey, nextOptions);
        }
      });
    }

    bindEvents();
    NS.cart.subscribe(render);
    NS.session.subscribe(function (sState) {
      render();
      if (sState.session && Object.keys(catalogMap).length === 0) {
        NS.api
          .fetchRestaurantMenu(sState.session.restaurantId)
          .then(function (res) {
            (res.items || []).forEach(function (item) {
              catalogMap[item.id] = item;
            });
            render();
          })
          .catch(function () {
            // Non-blocking
          });
      }
    });
  }

  function initConfirmationPage(options) {
    var rootEl = options.rootEl;
    var params = new URLSearchParams(global.location.search);
    var orderId = params.get('orderId');

    var order = orderId ? NS.cart.readLastOrderSnapshot(orderId) : null;
    var loading = !order;
    var errorMsg = null;
    var cancelling = false;
    var cancelError = null;
    var pollTimer = null;

    function render() {
      var esc = NS.config.escapeHtml;
      var cart = NS.cart;
      var session = NS.session.getState().session;

      if (!orderId) {
        rootEl.innerHTML =
          '<div class="empty-state-card">' +
          '<h1 class="empty-state-title">Order record unavailable</h1>' +
          '<p class="empty-state-desc">No order confirmation identifier was specified.</p>' +
          '<div class="empty-state-actions">' +
          '<a href="menu.html" class="pill-btn pill-btn--olive pill-btn--lg">Return to Menu</a>' +
          '</div>' +
          '</div>';
        return;
      }

      if (loading) {
        rootEl.innerHTML =
          '<div class="skeleton-card animate-pulse-soft" style="height: 24rem;"></div>';
        return;
      }

      if (errorMsg || !order) {
        rootEl.innerHTML =
          '<div class="empty-state-card">' +
          '<h1 class="empty-state-title">Order record unavailable</h1>' +
          '<p class="empty-state-desc">' +
          esc(errorMsg || 'We could not locate this order confirmation.') +
          '</p>' +
          '<div class="empty-state-actions">' +
          '<a href="menu.html" class="pill-btn pill-btn--olive pill-btn--lg">Return to Menu</a>' +
          '</div>' +
          '</div>';
        return;
      }

      var isCancelled = order.status === 'CANCELLED';
      var steps = NS.config.orderStatusSteps;
      var activeStepIdx = steps.findIndex(function (s) {
        return s.key === order.status;
      });

      var canAttemptCancel =
        !isCancelled &&
        (order.status === 'RECEIVED' || order.status === 'PREPARING') &&
        Date.now() <= Date.parse(order.cancellableUntil) &&
        Boolean(session && session.sessionId === order.sessionId);

      var badgeHtml = isCancelled
        ? '<div class="confirm-badge-cancelled" aria-hidden="true">' +
          '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>' +
          '</div>'
        : '<div class="confirm-badge-circle animate-confirm-circle" aria-hidden="true">' +
          '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12" class="animate-confirm-check"/></svg>' +
          '</div>';

      var progressHtml = isCancelled
        ? ''
        : '<div class="progress-section">' +
          '<div class="progress-heading">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' +
          '<span>Live Kitchen Progress</span>' +
          '</div>' +
          '<div class="progress-steps">' +
          steps
            .map(function (step, idx) {
              var reached = idx <= activeStepIdx;
              return (
                '<div>' +
                '<div class="progress-bar' +
                (reached ? ' is-reached' : '') +
                '"></div>' +
                '<span class="progress-label' +
                (reached ? ' is-reached' : '') +
                '">' +
                esc(step.label) +
                '</span>' +
                '</div>'
              );
            })
            .join('') +
          '</div>' +
          '</div>';

      var dishesHtml = order.items
        .map(function (item) {
          var optsText =
            Array.isArray(item.selectedOptions) && item.selectedOptions.length > 0
              ? '<p class="ordered-dish-options">' +
                esc(
                  item.selectedOptions
                    .map(function (o) {
                      return o.choiceLabel;
                    })
                    .join(' · ')
                ) +
                '</p>'
              : '';

          return (
            '<div class="ordered-dish-row">' +
            '<div>' +
            '<p><strong><span class="tabular-nums">' +
            item.quantity +
            '&times;</span> ' +
            esc(item.name) +
            '</strong></p>' +
            optsText +
            '</div>' +
            '<span class="tabular-nums"><strong>' +
            esc(cart.formatCurrency(item.lineTotal)) +
            '</strong></span>' +
            '</div>'
          );
        })
        .join('');

      var submittedTime = new Date(order.createdAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });

      rootEl.innerHTML =
        '<section class="confirmation-card">' +
        '<div class="confirmation-hero">' +
        badgeHtml +
        '<p class="page-kicker" style="margin-top: 1rem;">' +
        esc(order.restaurantName + ' · Table ' + order.tableNumber) +
        '</p>' +
        '<h1 class="confirm-title">' +
        (isCancelled ? 'Order Cancelled' : 'Your order has been successfully placed!') +
        '</h1>' +
        '<p class="confirm-subtitle">' +
        esc(
          isCancelled
            ? order.cancellationReason || 'This ticket has been cancelled.'
            : 'Ticket transmitted to the kitchen for ' +
                order.tableLabel +
                '. Estimated preparation: ~' +
                order.estimatedMinutes +
                ' min.'
        ) +
        '</p>' +
        '</div>' +
        '<dl class="confirm-meta-grid">' +
        '<div><dt>Order ID</dt><dd data-testid="confirmed-order-id" class="font-mono-code">' +
        esc(order.orderId) +
        '</dd></div>' +
        '<div><dt>Table</dt><dd>' +
        esc(order.tableLabel) +
        '</dd></div>' +
        '<div><dt>Submitted</dt><dd class="tabular-nums">' +
        esc(submittedTime) +
        '</dd></div>' +
        '<div><dt>Current Status</dt><dd data-testid="confirmed-order-status" style="color: var(--accent-olive); font-weight: 600;">' +
        esc(order.status) +
        '</dd></div>' +
        '</dl>' +
        progressHtml +
        '<div class="ordered-dishes-section">' +
        '<h2 class="ordered-dishes-heading">Ordered Dishes</h2>' +
        dishesHtml +
        '</div>' +
        '<dl class="summary-ledger">' +
        '<div class="summary-row"><dt>Subtotal</dt><dd class="tabular-nums">' +
        esc(cart.formatCurrency(order.subtotal)) +
        '</dd></div>' +
        '<div class="summary-row"><dt>Taxes</dt><dd class="tabular-nums">' +
        esc(cart.formatCurrency(order.taxAmount)) +
        '</dd></div>' +
        '<div class="summary-row"><dt>Dining Room Service</dt><dd class="tabular-nums">' +
        esc(cart.formatCurrency(order.serviceCharge)) +
        '</dd></div>' +
        '<div class="summary-grand-row"><dt>Total Charged to Table</dt><dd class="tabular-nums">' +
        esc(cart.formatCurrency(order.grandTotal)) +
        '</dd></div>' +
        '</dl>' +
        (cancelError
          ? '<p role="alert" class="validation-box">' + esc(cancelError) + '</p>'
          : '') +
        '<div class="confirmation-actions">' +
        '<a href="menu.html" class="pill-btn pill-btn--olive pill-btn--lg">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m16 2-2.3 2.3a3 3 0 0 0 0 4.2l1.8 1.8a3 3 0 0 0 4.2 0L22 8"/><path d="M15 15 3.3 3.3a4.2 4.2 0 0 0 0 6l7.3 7.3c.7.7 2 .7 2.8 0L15 15Zm0 0 7 7"/><path d="m2.1 21.8 6.4-6.3"/><path d="m19 5-7 7"/></svg>' +
        '<span>Return to Menu</span>' +
        '</a>' +
        (canAttemptCancel
          ? '<button type="button" class="pill-btn pill-btn--outline pill-btn--md" data-confirm-action="cancel-order"' +
            (cancelling ? ' disabled' : '') +
            '>' +
            (cancelling ? 'Cancelling...' : 'Cancel Order') +
            '</button>'
          : '') +
        '</div>' +
        '</section>';
    }

    async function loadOrder() {
      if (!orderId) {
        render();
        return;
      }
      try {
        var latest = await NS.api.fetchOrderStatus(orderId);
        order = latest;
        errorMsg = null;
        NS.cart.saveLastOrderSnapshot(latest);
      } catch (err) {
        if (!order) {
          errorMsg =
            err && err.message ? err.message : 'Unable to load order confirmation.';
        }
      } finally {
        loading = false;
        render();
      }
    }

    rootEl.addEventListener('click', async function (e) {
      var cancelBtn = e.target.closest('button[data-confirm-action="cancel-order"]');
      if (!cancelBtn || cancelling || !order) return;
      var session = NS.session.getState().session;
      if (!session) return;

      cancelling = true;
      cancelError = null;
      render();

      try {
        order = await NS.api.cancelCustomerOrder({
          orderId: order.orderId,
          sessionId: session.sessionId,
          sessionSignature: session.sessionSignature,
        });
        NS.cart.saveLastOrderSnapshot(order);
      } catch (err) {
        cancelError =
          err && err.message ? err.message : 'Order could not be cancelled.';
      } finally {
        cancelling = false;
        render();
      }
    });

    NS.session.subscribe(render);
    render();
    loadOrder();

    if (orderId) {
      pollTimer = setInterval(loadOrder, 4000);
      global.addEventListener('beforeunload', function () {
        if (pollTimer) clearInterval(pollTimer);
      });
    }
  }

  NS.orders = {
    initCartPage: initCartPage,
    initConfirmationPage: initConfirmationPage,
  };
})(typeof window !== 'undefined' ? window : globalThis);
