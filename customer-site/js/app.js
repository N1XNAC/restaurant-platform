(function (global) {
  'use strict';

  var NS = (global.MaisonVerbena = global.MaisonVerbena || {});

  function initApp() {
    var page = document.body.dataset.page || 'home';
    var esc = NS.config.escapeHtml;

    var headerBrandEl = document.getElementById('header-brand');
    var tableChipLabelEl = document.getElementById('header-table-label');
    var headerTableBtn = document.getElementById('header-table-btn');
    var headerCartBtn = document.getElementById('header-cart-btn');
    var headerCartCountEl = document.getElementById('header-cart-count');

    var mobileNavToggle = document.getElementById('mobile-nav-toggle');
    var mobileNavDrawer = document.getElementById('mobile-nav-drawer');
    var mobileSearchToggle = document.getElementById('mobile-search-toggle');
    var mobileSearchDrawer = document.getElementById('mobile-search-drawer');
    var desktopSearchInput = document.getElementById('desktop-search-input');
    var mobileSearchInput = document.getElementById('mobile-search-input');

    var tamperContainer = document.getElementById('tamper-alert-container');
    var recoveryContainer = document.getElementById('session-recovery-container');
    var pageMainContent = document.getElementById('page-main-content');

    var floatingCartBtn = document.getElementById('floating-cart-btn');
    var floatingCartBadge = document.getElementById('floating-cart-badge');

    var toastEl = document.getElementById('toast-banner');
    var toastMsgEl = document.getElementById('toast-message');
    var toastDismissBtn = document.getElementById('toast-dismiss-btn');

    var footerPrimaryEl = document.getElementById('footer-restaurant-line');
    var footerTableEl = document.getElementById('footer-table-line');

    var modalBackdrop = document.getElementById('table-session-modal');
    var modalCloseBtn = document.getElementById('modal-close-btn');
    var modalBodyEl = document.getElementById('table-modal-body');

    var heroTableLabelEl = document.getElementById('hero-table-label');
    var heroHoursEl = document.getElementById('hero-hours-label');
    var heroTitleEl = document.getElementById('hero-restaurant-title');
    var heroVerifyBtn = document.getElementById('hero-verify-btn');
    var heroVerifyLabelEl = document.getElementById('hero-verify-label');
    var menuPageKickerEl = document.getElementById('menu-page-kicker');

    var lastAnimatedStamp = 0;
    var lastTriggerEl = null;
    var geoFeedback = null;
    var geoLoading = false;
    var pinError = null;
    var pinSubmitting = false;
    var scanError = null;

    var menuController = null;

    function syncSearchInputs(value) {
      if (desktopSearchInput && desktopSearchInput.value !== value) {
        desktopSearchInput.value = value;
      }
      if (mobileSearchInput && mobileSearchInput.value !== value) {
        mobileSearchInput.value = value;
      }
      if (menuController) {
        menuController.setSearchQuery(value);
      }
    }

    if (desktopSearchInput) {
      desktopSearchInput.addEventListener('input', function () {
        syncSearchInputs(desktopSearchInput.value);
      });
    }
    if (mobileSearchInput) {
      mobileSearchInput.addEventListener('input', function () {
        syncSearchInputs(mobileSearchInput.value);
      });
    }

    if (mobileNavToggle && mobileNavDrawer) {
      mobileNavToggle.addEventListener('click', function () {
        var willOpen = mobileNavDrawer.classList.contains('hidden');
        mobileNavDrawer.classList.toggle('hidden', !willOpen);
        mobileNavToggle.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      });
    }

    if (mobileSearchToggle && mobileSearchDrawer) {
      mobileSearchToggle.addEventListener('click', function () {
        var willOpen = mobileSearchDrawer.classList.contains('hidden');
        mobileSearchDrawer.classList.toggle('hidden', !willOpen);
        mobileSearchToggle.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
        if (willOpen && mobileSearchInput) {
          mobileSearchInput.focus();
        }
      });
    }

    if (toastDismissBtn) {
      toastDismissBtn.addEventListener('click', function () {
        NS.cart.dismissToast();
      });
    }

    function openTableModal() {
      if (!modalBackdrop) return;
      lastTriggerEl = document.activeElement;
      geoFeedback = null;
      pinError = null;
      scanError = null;
      modalBackdrop.classList.remove('hidden');
      renderModalContent();
      if (modalCloseBtn) modalCloseBtn.focus();
    }

    function closeTableModal() {
      if (!modalBackdrop) return;
      modalBackdrop.classList.add('hidden');
      if (lastTriggerEl && typeof lastTriggerEl.focus === 'function') {
        lastTriggerEl.focus();
      }
    }

    if (headerTableBtn) {
      headerTableBtn.addEventListener('click', openTableModal);
    }
    if (heroVerifyBtn) {
      heroVerifyBtn.addEventListener('click', openTableModal);
    }
    if (modalCloseBtn) {
      modalCloseBtn.addEventListener('click', closeTableModal);
    }
    if (modalBackdrop) {
      modalBackdrop.addEventListener('click', function (e) {
        if (e.target === modalBackdrop) {
          closeTableModal();
        }
      });
    }
    document.addEventListener('keydown', function (e) {
      if (
        e.key === 'Escape' &&
        modalBackdrop &&
        !modalBackdrop.classList.contains('hidden')
      ) {
        closeTableModal();
      }
    });

    function renderModalContent() {
      if (!modalBodyEl || !modalBackdrop || modalBackdrop.classList.contains('hidden')) {
        return;
      }
      var sState = NS.session.getState();
      var session = sState.session;
      var presets = sState.presets;
      var modalTitleEl = document.getElementById('table-session-dialog-title');

      if (modalTitleEl) {
        modalTitleEl.textContent = session
          ? session.restaurant.name
          : 'Table Verification';
      }

      var sessionHtml = '';
      if (session) {
        var presenceHtml = '';
        if (session.locationStatus === 'verified') {
          presenceHtml =
            '<span style="color: var(--accent-forest); font-weight: 600;">GPS Verified (' +
            (session.distanceMeters != null ? session.distanceMeters : 0) +
            'm)</span>';
        } else if (
          session.locationStatus === 'flagged_outside_geofence' &&
          !session.challengeVerified
        ) {
          presenceHtml =
            '<span style="color: var(--accent-crimson); font-weight: 600;">Outside Geofence &mdash; PIN Required</span>';
        } else {
          presenceHtml =
            '<span style="color: var(--ink-muted);">' +
            (session.challengeVerified
              ? 'QR / NFC Session Verified'
              : 'Optional GPS Check') +
            '</span>';
        }

        var challengeHtml = '';
        if (session.requiresAdditionalVerification && !session.challengeVerified) {
          challengeHtml =
            '<form id="modal-pin-form" class="modal-challenge-card">' +
            '<p class="modal-challenge-text">Additional Verification Required: Your GPS location appears outside the restaurant geofence. Enter the 4-digit code printed on your table placard.</p>' +
            '<div class="modal-pin-row">' +
            '<input id="modal-pin-input" type="text" inputmode="numeric" maxlength="6" placeholder="4-digit table code" aria-label="4-digit table placard code" class="modal-pin-input" required />' +
            '<button type="submit" class="pill-btn pill-btn--burgundy pill-btn--md"' +
            (pinSubmitting ? ' disabled' : '') +
            '>' +
            (pinSubmitting ? 'Verifying...' : 'Verify') +
            '</button>' +
            '</div>' +
            (pinError
              ? '<p style="margin-top: 0.5rem; font-size: 0.75rem; color: var(--accent-crimson);">' +
                esc(pinError) +
                '</p>'
              : '') +
            '</form>';
        }

        sessionHtml =
          '<div class="modal-stack">' +
          '<div class="modal-card">' +
          '<p><strong>' +
          esc(session.restaurant.tagline) +
          '</strong></p>' +
          '<p style="color: var(--ink-muted);">' +
          esc(session.restaurant.address) +
          '</p>' +
          '<p class="tabular-nums" style="color: var(--ink-muted);">' +
          esc(session.restaurant.hours + ' · ' + session.restaurant.phone) +
          '</p>' +
          '</div>' +
          '<div class="modal-card">' +
          '<div class="modal-row"><span style="color: var(--ink-muted);">Verified Assignment</span><strong style="color: var(--accent-olive);">' +
          esc(session.tableLabel + ' (' + session.entryMethod + ')') +
          '</strong></div>' +
          '<div class="modal-row"><span style="color: var(--ink-muted);">Session ID</span><span class="font-mono-code">' +
          esc(session.sessionId) +
          '</span></div>' +
          '<div class="modal-row"><span style="color: var(--ink-muted);">Dining Room Presence</span>' +
          presenceHtml +
          '</div>' +
          '<div style="margin-top: 0.85rem;">' +
          '<button type="button" id="modal-geo-btn" class="pill-btn pill-btn--linen pill-btn--sm"' +
          (geoLoading ? ' disabled' : '') +
          '>' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>' +
          '<span>' +
          (geoLoading ? 'Checking...' : 'Verify Dining Room Location') +
          '</span>' +
          '</button>' +
          (geoFeedback
            ? '<p style="margin-top: 0.5rem; color: var(--ink-body);">' +
              esc(geoFeedback) +
              '</p>'
            : '') +
          '</div>' +
          '</div>' +
          challengeHtml +
          '</div>';
      }

      var presetsHtml = '';
      if (presets && presets.length > 0) {
        presetsHtml =
          '<div class="modal-presets-section">' +
          '<p class="modal-presets-heading">Simulate Scanning Another Table QR / NFC Tag</p>' +
          '<div class="modal-presets-grid">' +
          presets
            .map(function (preset) {
              var meta =
                preset.entryMethod +
                ' · ' +
                (preset.status === 'expired'
                  ? 'Expired Test'
                  : preset.seats + ' seats');
              return (
                '<button type="button" class="preset-btn" data-scan-token="' +
                esc(preset.token) +
                '">' +
                '<div><span class="preset-title">' +
                esc(preset.tableLabel) +
                '</span><span class="preset-meta">' +
                esc(meta) +
                '</span></div>' +
                '<span class="preset-code">' +
                esc(preset.tableId) +
                '</span>' +
                '</button>'
              );
            })
            .join('') +
          '</div>' +
          (scanError
            ? '<p style="margin-top: 0.6rem; font-size: 0.75rem; color: var(--accent-crimson);">' +
              esc(scanError) +
              '</p>'
            : '') +
          '</div>';
      }

      modalBodyEl.innerHTML = sessionHtml + presetsHtml;
    }

    if (modalBodyEl) {
      modalBodyEl.addEventListener('click', async function (e) {
        var geoBtn = e.target.closest('#modal-geo-btn');
        if (geoBtn) {
          geoLoading = true;
          geoFeedback = null;
          renderModalContent();
          var res = await NS.session.verifyLocationWithConsent();
          geoFeedback = res.message;
          geoLoading = false;
          renderModalContent();
          return;
        }

        var presetBtn = e.target.closest('button[data-scan-token]');
        if (presetBtn) {
          var token = presetBtn.getAttribute('data-scan-token');
          scanError = null;
          geoFeedback = null;
          try {
            await NS.session.scanToken(token);
            closeTableModal();
          } catch (err) {
            scanError =
              err && err.message ? err.message : 'Token validation failed.';
            renderModalContent();
          }
        }
      });

      modalBodyEl.addEventListener('submit', async function (e) {
        if (e.target && e.target.id === 'modal-pin-form') {
          e.preventDefault();
          var pinInput = document.getElementById('modal-pin-input');
          var pinVal = pinInput ? pinInput.value : '';
          pinError = null;
          pinSubmitting = true;
          renderModalContent();
          try {
            await NS.session.submitChallengePin(pinVal);
            geoFeedback = 'Table placard PIN verified. Ordering is unlocked.';
          } catch (err) {
            pinError =
              err && err.message
                ? err.message
                : 'Unable to verify table placard code.';
          } finally {
            pinSubmitting = false;
            renderModalContent();
          }
        }
      });
    }

    function renderSessionChrome(sState) {
      var session = sState.session;

      if (session) {
        NS.cart.bindSession(session);
      }

      if (headerBrandEl) {
        headerBrandEl.textContent = session
          ? session.restaurant.name
          : 'Maison Verbena';
      }
      if (tableChipLabelEl) {
        tableChipLabelEl.textContent = session
          ? 'Table ' + session.tableNumber
          : 'Table Info';
      }
      if (heroTableLabelEl) {
        heroTableLabelEl.textContent = session
          ? session.tableLabel
          : 'Table 08 · Window Booth';
      }
      if (heroHoursEl) {
        heroHoursEl.textContent = session
          ? session.restaurant.hours
          : 'Wed–Sun · 17:00 – 22:30';
      }
      if (heroTitleEl) {
        heroTitleEl.textContent =
          (session ? session.restaurant.name : 'Maison Verbena') +
          ' Seasonal Table Menu';
      }
      if (heroVerifyLabelEl) {
        heroVerifyLabelEl.textContent =
          session && session.locationStatus === 'verified'
            ? 'Dining Room Verified'
            : 'Table & Location Security';
      }
      if (menuPageKickerEl) {
        menuPageKickerEl.textContent =
          (session ? session.tableLabel : 'Table 08') + ' · Full Kitchen Ledger';
      }

      if (footerPrimaryEl) {
        footerPrimaryEl.textContent =
          (session ? session.restaurant.name : 'Maison Verbena') +
          ' · ' +
          (session
            ? session.restaurant.address
            : '42 Linden Courtyard, San Francisco');
      }
      if (footerTableEl) {
        footerTableEl.textContent = session
          ? session.tableLabel + ' · QR/NFC Verified Ordering'
          : 'Customer Table Ordering';
      }

      if (tamperContainer) {
        if (sState.tamperWarning) {
          tamperContainer.classList.remove('hidden');
          tamperContainer.innerHTML =
            '<div role="alert" class="tamper-alert">' +
            '<div class="tamper-alert-content">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>' +
            '<span>' +
            esc(sState.tamperWarning) +
            '</span>' +
            '</div>' +
            '<button type="button" class="tamper-alert-dismiss" id="dismiss-tamper-btn" aria-label="Dismiss security notice">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>' +
            '</button>' +
            '</div>';
          var dismissBtn = document.getElementById('dismiss-tamper-btn');
          if (dismissBtn) {
            dismissBtn.addEventListener('click', function () {
              NS.session.dismissTamperWarning();
            });
          }
        } else {
          tamperContainer.classList.add('hidden');
          tamperContainer.innerHTML = '';
        }
      }

      var showRecovery =
        !sState.isValidating && Boolean(sState.sessionError) && !session;
      if (recoveryContainer && pageMainContent) {
        if (showRecovery) {
          pageMainContent.classList.add('hidden');
          recoveryContainer.classList.remove('hidden');
          var activePresets = sState.presets.filter(function (p) {
            return p.status === 'active';
          });
          recoveryContainer.innerHTML =
            '<section class="recovery-panel">' +
            '<div class="recovery-icon" aria-hidden="true">' +
            '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/></svg>' +
            '</div>' +
            '<h1 class="recovery-title">Table Session Verification Required</h1>' +
            '<p class="recovery-message">' +
            esc(sState.sessionError) +
            '</p>' +
            '<p class="recovery-presets-label">Scan or choose a verified table plaque to continue:</p>' +
            '<div class="recovery-presets-grid">' +
            activePresets
              .map(function (p) {
                return (
                  '<button type="button" class="pill-btn pill-btn--outline pill-btn--md" data-recovery-token="' +
                  esc(p.token) +
                  '">' +
                  esc(p.tableLabel + ' (' + p.entryMethod + ')') +
                  '</button>'
                );
              })
              .join('') +
            '</div>' +
            '</section>';
        } else {
          pageMainContent.classList.remove('hidden');
          recoveryContainer.classList.add('hidden');
          recoveryContainer.innerHTML = '';
        }
      }

      renderModalContent();
    }

    if (recoveryContainer) {
      recoveryContainer.addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-recovery-token]');
        if (!btn) return;
        var token = btn.getAttribute('data-recovery-token');
        NS.session.scanToken(token).catch(function () {});
      });
    }

    function renderCartChrome(cState) {
      if (headerCartCountEl) {
        headerCartCountEl.textContent = String(cState.totalUnits);
      }
      if (headerCartBtn) {
        headerCartBtn.setAttribute(
          'aria-label',
          'View virtual table order (' + cState.totalUnits + ' items)'
        );
      }
      if (floatingCartBtn && floatingCartBadge) {
        if (page === 'cart') {
          floatingCartBtn.classList.add('hidden');
        } else {
          floatingCartBtn.classList.remove('hidden');
          floatingCartBadge.textContent = String(cState.totalUnits);
          floatingCartBtn.setAttribute(
            'aria-label',
            'Open virtual table order review (' +
              cState.totalUnits +
              (cState.totalUnits === 1 ? ' item)' : ' items)')
          );

          if (cState.lastAddedStamp > lastAnimatedStamp) {
            lastAnimatedStamp = cState.lastAddedStamp;
            floatingCartBtn.classList.remove('animate-cart-bounce');
            floatingCartBadge.classList.remove('animate-badge-pop');
            void floatingCartBtn.offsetWidth;
            floatingCartBtn.classList.add('animate-cart-bounce');
            floatingCartBadge.classList.add('animate-badge-pop');
          }
        }
      }

      if (toastEl && toastMsgEl) {
        if (cState.toastMessage) {
          toastMsgEl.textContent = cState.toastMessage;
          toastEl.classList.remove('hidden');
        } else {
          toastEl.classList.add('hidden');
        }
      }
    }

    if (page === 'home' || page === 'menu') {
      menuController = NS.menu.createMenuController({
        groupedByCourse: page === 'menu',
        gridContainer: document.getElementById('menu-grid-container'),
        categoryRail: document.getElementById('category-filter-rail'),
        dietaryRail: document.getElementById('dietary-filter-rail'),
        statusTitleEl: document.getElementById('menu-status-title'),
        statusCountEl: document.getElementById('menu-status-count'),
        onResetSearch: function () {
          syncSearchInputs('');
        },
      });
    } else if (page === 'cart') {
      NS.orders.initCartPage({
        rootEl: document.getElementById('cart-review-root'),
        subtitleEl: document.getElementById('cart-page-subtitle'),
        pageTitleEl: document.getElementById('cart-page-title'),
        modeActionsEl: document.getElementById('cart-mode-actions'),
        onOpenTableModal: openTableModal,
      });
    } else if (page === 'confirmation') {
      NS.orders.initConfirmationPage({
        rootEl: document.getElementById('confirmation-root'),
      });
    }

    var loadedRestaurantId = null;
    NS.session.subscribe(function (sState) {
      renderSessionChrome(sState);
      var restId =
        (sState.session && sState.session.restaurantId) ||
        (!sState.isValidating && !sState.sessionError ? 'REST_001' : null);
      if (menuController && restId && restId !== loadedRestaurantId) {
        loadedRestaurantId = restId;
        menuController.loadMenu(restId);
      }
    });

    NS.cart.subscribe(renderCartChrome);
    NS.session.bootstrap();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
})(typeof window !== 'undefined' ? window : globalThis);
