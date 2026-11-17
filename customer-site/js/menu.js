(function (global) {
  'use strict';

  var NS = (global.MaisonVerbena = global.MaisonVerbena || {});

  function renderDietBadge(dietary) {
    var safe = dietary === 'vegan' || dietary === 'veg' ? dietary : 'non-veg';
    var label = safe === 'vegan' ? 'Vegan' : safe === 'veg' ? 'Vegetarian' : 'Non-Veg';
    return (
      '<span class="diet-badge diet-badge--' +
      safe +
      '">' +
      '<span class="diet-indicator" aria-hidden="true"><span class="diet-indicator-dot"></span></span>' +
      '<span>' +
      label +
      '</span>' +
      '</span>'
    );
  }

  function buildDefaultOptions(item) {
    if (!Array.isArray(item.customizations)) return [];
    return item.customizations
      .map(function (group) {
        var first = group.choices && group.choices[0];
        if (!first) return null;
        return {
          groupId: group.id,
          groupName: group.name,
          choiceId: first.id,
          choiceLabel: first.label,
          priceDelta: first.priceDelta,
        };
      })
      .filter(Boolean);
  }

  function renderPictureMarkup(imagePath, fallbackPath, altText, isEager) {
    var esc = NS.config.escapeHtml;
    var media = NS.config.resolveMediaSources(imagePath, fallbackPath);
    var loadingAttr = isEager ? 'eager' : 'lazy';
    return (
      '<picture>' +
      '<source type="image/webp" srcset="' +
      esc(media.webp) +
      '" />' +
      '<img src="' +
      esc(media.jpg) +
      '" alt="' +
      esc(altText) +
      '" width="' +
      NS.config.imageWidth +
      '" height="' +
      NS.config.imageHeight +
      '" loading="' +
      loadingAttr +
      '" referrerpolicy="no-referrer" data-fallback-img="true" />' +
      '</picture>'
    );
  }

  function renderFoodCard(item, cardState) {
    var esc = NS.config.escapeHtml;
    var cart = NS.cart;
    var unitPrice = cart.computeEffectiveUnitPrice(item.price, cardState.selectedOptions);
    var availClass = item.isAvailable
      ? 'availability-label availability-label--open'
      : 'availability-label availability-label--out';
    var availText = item.isAvailable
      ? 'Available · ~' + item.prepTimeMinutes + 'm'
      : 'Sold Out';

    var optionsHtml = '';
    if (Array.isArray(item.customizations) && item.customizations.length > 0) {
      optionsHtml =
        '<div class="food-options">' +
        item.customizations
          .map(function (group) {
            var selected = cardState.selectedOptions.find(function (o) {
              return o.groupId === group.id;
            });
            var currentId = selected
              ? selected.choiceId
              : group.choices[0] && group.choices[0].id;
            var selectId = esc(item.id + '-' + group.id);
            var choicesHtml = group.choices
              .map(function (choice) {
                var deltaText =
                  choice.priceDelta > 0
                    ? ' (+' + cart.formatCurrency(choice.priceDelta) + ')'
                    : '';
                return (
                  '<option value="' +
                  esc(choice.id) +
                  '"' +
                  (choice.id === currentId ? ' selected' : '') +
                  '>' +
                  esc(choice.label + deltaText) +
                  '</option>'
                );
              })
              .join('');

            return (
              '<div class="food-option-row">' +
              '<label class="food-option-label" for="' +
              selectId +
              '">' +
              esc(group.name) +
              '</label>' +
              '<select id="' +
              selectId +
              '" class="option-select" data-option-group="' +
              esc(group.id) +
              '" data-item-id="' +
              esc(item.id) +
              '"' +
              (!item.isAvailable ? ' disabled' : '') +
              '>' +
              choicesHtml +
              '</select>' +
              '</div>'
            );
          })
          .join('') +
        '</div>';
    }

    var disabledAttr = !item.isAvailable ? ' disabled' : '';

    return (
      '<article class="food-card' +
      (item.isAvailable ? '' : ' is-sold-out') +
      '" data-testid="food-card-' +
      esc(item.id) +
      '" data-item-id="' +
      esc(item.id) +
      '">' +
      '<div class="food-card-media">' +
      renderPictureMarkup(item.image, item.fallbackImage, item.name, false) +
      '<div class="food-card-fallback hidden" aria-hidden="true">' +
      '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></svg>' +
      '<span class="font-display">' +
      esc(item.name) +
      '</span>' +
      '</div>' +
      '</div>' +
      '<div class="food-card-body">' +
      '<div>' +
      '<div class="food-meta-row">' +
      '<div class="food-meta-left">' +
      '<span class="food-category">' +
      esc(item.category) +
      '</span>' +
      '<span aria-hidden="true">&middot;</span>' +
      renderDietBadge(item.dietary) +
      '</div>' +
      '<span class="' +
      availClass +
      '">' +
      esc(availText) +
      '</span>' +
      '</div>' +
      '<div class="food-title-row">' +
      '<h3 class="food-title">' +
      esc(item.name) +
      '</h3>' +
      '<span class="food-price tabular-nums" data-card-price="' +
      esc(item.id) +
      '">' +
      esc(cart.formatCurrency(unitPrice)) +
      '</span>' +
      '</div>' +
      '<p class="food-desc">' +
      esc(item.description) +
      '</p>' +
      optionsHtml +
      '</div>' +
      '<div class="food-card-footer">' +
      '<div class="food-qty-row">' +
      '<span class="food-qty-label">Quantity</span>' +
      '<div class="qty-stepper" role="group" aria-label="Quantity for ' +
      esc(item.name) +
      '">' +
      '<button type="button" class="qty-btn" data-qty-action="dec" data-item-id="' +
      esc(item.id) +
      '" aria-label="Decrease quantity of ' +
      esc(item.name) +
      '"' +
      (!item.isAvailable || cardState.quantity <= 1 ? ' disabled' : '') +
      '>&minus;</button>' +
      '<span class="qty-value tabular-nums" data-card-qty="' +
      esc(item.id) +
      '">' +
      cardState.quantity +
      '</span>' +
      '<button type="button" class="qty-btn" data-qty-action="inc" data-item-id="' +
      esc(item.id) +
      '" aria-label="Increase quantity of ' +
      esc(item.name) +
      '"' +
      (!item.isAvailable || cardState.quantity >= 25 ? ' disabled' : '') +
      '>+</button>' +
      '</div>' +
      '</div>' +
      '<div class="food-cta-grid">' +
      '<button type="button" class="pill-btn pill-btn--olive pill-btn--md pill-btn--full" data-action="add-to-table" data-item-id="' +
      esc(item.id) +
      '" aria-label="Add to Table: ' +
      esc(item.name) +
      '"' +
      disabledAttr +
      '>Add to Table</button>' +
      '<button type="button" class="pill-btn pill-btn--outline pill-btn--md pill-btn--full" data-action="only-this" data-item-id="' +
      esc(item.id) +
      '" aria-label="Only This: ' +
      esc(item.name) +
      '"' +
      disabledAttr +
      '>Only This</button>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</article>'
    );
  }

  function createMenuController(options) {
    var isCourseGrouped = Boolean(options.groupedByCourse);
    var gridContainer = options.gridContainer;
    var categoryRail = options.categoryRail;
    var dietaryRail = options.dietaryRail;
    var statusTitleEl = options.statusTitleEl;
    var statusCountEl = options.statusCountEl;

    var allItems = [];
    var cardStates = {};
    var selectedCategory = 'All';
    var selectedDietary = 'all';
    var searchQuery = '';
    var loading = true;
    var errorMsg = null;

    function getCardState(item) {
      if (!cardStates[item.id]) {
        cardStates[item.id] = {
          quantity: 1,
          selectedOptions: buildDefaultOptions(item),
        };
      }
      return cardStates[item.id];
    }

    function attachImageFallbackListeners() {
      var imgs = gridContainer.querySelectorAll('img[data-fallback-img="true"]');
      for (var i = 0; i < imgs.length; i++) {
        imgs[i].addEventListener('error', function () {
          var pic = this.parentElement;
          var media = pic ? pic.parentElement : null;
          if (pic) pic.classList.add('hidden');
          var fallback = media ? media.querySelector('.food-card-fallback') : null;
          if (fallback) fallback.classList.remove('hidden');
        });
      }
    }

    function renderFilterBars() {
      var esc = NS.config.escapeHtml;
      if (categoryRail) {
        categoryRail.innerHTML = NS.config.categories
          .map(function (cat) {
            var active = selectedCategory === cat;
            return (
              '<button type="button" class="filter-pill' +
              (active ? ' is-active' : '') +
              '" data-filter-category="' +
              esc(cat) +
              '" aria-pressed="' +
              (active ? 'true' : 'false') +
              '">' +
              esc(cat) +
              '</button>'
            );
          })
          .join('');
      }

      if (dietaryRail) {
        var dietList = isCourseGrouped
          ? NS.config.menuDietaryFilters
          : NS.config.dietaryFilters;
        dietaryRail.innerHTML = dietList
          .map(function (diet) {
            var active = selectedDietary === diet.id;
            return (
              '<button type="button" class="diet-pill' +
              (active ? ' is-active' : '') +
              '" data-filter-dietary="' +
              esc(diet.id) +
              '" aria-pressed="' +
              (active ? 'true' : 'false') +
              '">' +
              esc(diet.label) +
              '</button>'
            );
          })
          .join('');
      }
    }

    function filterItems() {
      var q = searchQuery.trim().toLowerCase();
      return allItems.filter(function (item) {
        if (!isCourseGrouped && selectedCategory !== 'All' && item.category !== selectedCategory) {
          return false;
        }
        if (selectedDietary !== 'all' && item.dietary !== selectedDietary) {
          return false;
        }
        if (
          q &&
          item.name.toLowerCase().indexOf(q) === -1 &&
          item.description.toLowerCase().indexOf(q) === -1 &&
          item.category.toLowerCase().indexOf(q) === -1
        ) {
          return false;
        }
        return true;
      });
    }

    function renderGrid() {
      var esc = NS.config.escapeHtml;
      if (loading) {
        var skeletons = '';
        for (var i = 0; i < 6; i++) {
          skeletons += '<div class="skeleton-card animate-pulse-soft" aria-hidden="true"></div>';
        }
        gridContainer.innerHTML = '<div class="food-grid">' + skeletons + '</div>';
        return;
      }

      if (errorMsg) {
        gridContainer.innerHTML =
          '<div class="empty-state-card">' +
          '<h2 class="empty-state-title">Could not load the kitchen menu</h2>' +
          '<p class="empty-state-desc">' +
          esc(errorMsg) +
          '</p>' +
          '<div class="empty-state-actions">' +
          '<button type="button" class="pill-btn pill-btn--olive pill-btn--md" data-action="retry-menu">Retry</button>' +
          '</div>' +
          '</div>';
        return;
      }

      var filtered = filterItems();

      if (statusTitleEl) {
        statusTitleEl.textContent =
          selectedCategory === 'All' ? 'Tonight’s Kitchen Selection' : selectedCategory;
      }
      if (statusCountEl) {
        statusCountEl.textContent =
          'Showing ' + filtered.length + (filtered.length === 1 ? ' dish' : ' dishes');
      }

      if (filtered.length === 0) {
        gridContainer.innerHTML =
          '<div class="empty-state-card">' +
          '<h2 class="empty-state-title">No dishes match your filter</h2>' +
          '<p class="empty-state-desc">Try resetting the category, dietary preference, or search phrase.</p>' +
          '<div class="empty-state-actions">' +
          '<button type="button" class="pill-btn pill-btn--olive pill-btn--md" data-action="reset-filters">Reset Filters</button>' +
          '</div>' +
          '</div>';
        return;
      }

      if (isCourseGrouped) {
        var sectionsHtml = NS.config.courseOrder
          .map(function (course) {
            var courseItems = filtered.filter(function (item) {
              return item.category === course;
            });
            if (courseItems.length === 0) return '';
            var cards = courseItems
              .map(function (item) {
                return renderFoodCard(item, getCardState(item));
              })
              .join('');
            return (
              '<section aria-labelledby="course-' +
              esc(course) +
              '">' +
              '<div class="course-header">' +
              '<h2 id="course-' +
              esc(course) +
              '" class="course-title">' +
              esc(course) +
              '</h2>' +
              '<span class="course-count tabular-nums">' +
              courseItems.length +
              (courseItems.length === 1 ? ' selection' : ' selections') +
              '</span>' +
              '</div>' +
              '<div class="food-grid">' +
              cards +
              '</div>' +
              '</section>'
            );
          })
          .join('');

        gridContainer.innerHTML = '<div class="course-sections">' + sectionsHtml + '</div>';
      } else {
        gridContainer.innerHTML =
          '<div class="food-grid">' +
          filtered
            .map(function (item) {
              return renderFoodCard(item, getCardState(item));
            })
            .join('') +
          '</div>';
      }

      attachImageFallbackListeners();
    }

    function bindEvents() {
      if (categoryRail) {
        categoryRail.addEventListener('click', function (e) {
          var btn = e.target.closest('[data-filter-category]');
          if (!btn) return;
          selectedCategory = btn.getAttribute('data-filter-category') || 'All';
          renderFilterBars();
          renderGrid();
        });
      }

      if (dietaryRail) {
        dietaryRail.addEventListener('click', function (e) {
          var btn = e.target.closest('[data-filter-dietary]');
          if (!btn) return;
          selectedDietary = btn.getAttribute('data-filter-dietary') || 'all';
          renderFilterBars();
          renderGrid();
        });
      }

      gridContainer.addEventListener('change', function (e) {
        var select = e.target.closest('select[data-option-group]');
        if (!select) return;
        var itemId = select.getAttribute('data-item-id');
        var groupId = select.getAttribute('data-option-group');
        var choiceId = select.value;

        var item = allItems.find(function (entry) {
          return entry.id === itemId;
        });
        if (!item) return;
        var group = (item.customizations || []).find(function (g) {
          return g.id === groupId;
        });
        var choice = group && group.choices.find(function (c) {
          return c.id === choiceId;
        });
        if (!group || !choice) return;

        var st = getCardState(item);
        st.selectedOptions = st.selectedOptions
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

        var priceEl = gridContainer.querySelector(
          '[data-card-price="' + item.id + '"]'
        );
        if (priceEl) {
          priceEl.textContent = NS.cart.formatCurrency(
            NS.cart.computeEffectiveUnitPrice(item.price, st.selectedOptions)
          );
        }
      });

      gridContainer.addEventListener('click', function (e) {
        var qtyBtn = e.target.closest('button[data-qty-action]');
        if (qtyBtn) {
          var qItemId = qtyBtn.getAttribute('data-item-id');
          var qAction = qtyBtn.getAttribute('data-qty-action');
          var qItem = allItems.find(function (entry) {
            return entry.id === qItemId;
          });
          if (!qItem || !qItem.isAvailable) return;
          var qState = getCardState(qItem);
          var nextQty =
            qAction === 'inc'
              ? Math.min(25, qState.quantity + 1)
              : Math.max(1, qState.quantity - 1);
          qState.quantity = nextQty;

          var card = qtyBtn.closest('.food-card');
          if (card) {
            var valEl = card.querySelector('[data-card-qty="' + qItem.id + '"]');
            if (valEl) valEl.textContent = String(nextQty);
            var decEl = card.querySelector('[data-qty-action="dec"]');
            var incEl = card.querySelector('[data-qty-action="inc"]');
            if (decEl) decEl.disabled = nextQty <= 1;
            if (incEl) incEl.disabled = nextQty >= 25;
          }
          return;
        }

        var actionBtn = e.target.closest('button[data-action]');
        if (!actionBtn) return;
        var action = actionBtn.getAttribute('data-action');

        if (action === 'retry-menu') {
          loadMenu();
          return;
        }
        if (action === 'reset-filters') {
          selectedCategory = 'All';
          selectedDietary = 'all';
          searchQuery = '';
          if (typeof options.onResetSearch === 'function') {
            options.onResetSearch();
          }
          renderFilterBars();
          renderGrid();
          return;
        }

        var itemId = actionBtn.getAttribute('data-item-id');
        var item = allItems.find(function (entry) {
          return entry.id === itemId;
        });
        if (!item || !item.isAvailable) return;
        var st = getCardState(item);

        if (action === 'add-to-table') {
          NS.cart.addToTable(item, st.quantity, st.selectedOptions);
          actionBtn.innerHTML =
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg><span>Added</span>';
          setTimeout(function () {
            if (actionBtn.isConnected) {
              actionBtn.textContent = 'Add to Table';
            }
          }, 1200);
        } else if (action === 'only-this') {
          NS.cart.startOnlyThis(item, st.quantity, st.selectedOptions);
          global.location.href = 'cart.html?mode=only-this';
        }
      });
    }

    async function loadMenu(restaurantId) {
      loading = true;
      errorMsg = null;
      renderGrid();
      try {
        var res = await NS.api.fetchRestaurantMenu(restaurantId || 'REST_001');
        allItems = Array.isArray(res.items) ? res.items : [];
      } catch (err) {
        errorMsg = err && err.message ? err.message : 'Unable to load menu.';
      } finally {
        loading = false;
        renderGrid();
      }
    }

    renderFilterBars();
    bindEvents();

    return {
      loadMenu: loadMenu,
      setSearchQuery: function (nextQuery) {
        searchQuery = String(nextQuery || '');
        renderGrid();
      },
    };
  }

  NS.menu = {
    createMenuController: createMenuController,
    renderPictureMarkup: renderPictureMarkup,
    renderDietBadge: renderDietBadge,
  };
})(typeof window !== 'undefined' ? window : globalThis);
