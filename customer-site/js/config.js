(function (global) {
  'use strict';

  var NS = (global.MaisonVerbena = global.MaisonVerbena || {});

  function readMetaApiBaseUrl() {
    if (typeof document === 'undefined') return '';
    var meta = document.querySelector('meta[name="api-base-url"]');
    var content = meta ? meta.getAttribute('content') : '';
    return content ? content.trim().replace(/\/+$/, '') : '';
  }

  function getApiBaseUrl() {
    var runtime =
      global.__MV_CONFIG__ && typeof global.__MV_CONFIG__.apiBaseUrl === 'string'
        ? global.__MV_CONFIG__.apiBaseUrl.trim().replace(/\/+$/, '')
        : '';
    return runtime || readMetaApiBaseUrl();
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function resolveMediaSources(imagePath, fallbackPath) {
    var primary = String(imagePath || '').replace(/^\/+/, '');
    var fallback = String(fallbackPath || '').replace(/^\/+/, '');

    if (!primary && !fallback) {
      return {
        webp: 'assets/images/pexels-interior-setup.webp',
        jpg: 'assets/images/pexels-interior-setup.jpg',
      };
    }

    var base = primary || fallback;
    var webp = base.endsWith('.webp')
      ? base
      : base.replace(/\.(jpe?g|png)$/i, '.webp');
    var jpg =
      fallback && /\.(jpe?g|png)$/i.test(fallback)
        ? fallback
        : base.replace(/\.webp$/i, '.jpg');

    return { webp: webp, jpg: jpg };
  }

  NS.config = {
    getApiBaseUrl: getApiBaseUrl,
    defaultEntryToken: 'QR_MV_T08_VALID',
    defaultTaxRate: 0.085,
    defaultServiceChargeRate: 0.05,
    imageWidth: 800,
    imageHeight: 600,
    categories: ['All', 'Starters', 'Mains', 'Wood-Fired', 'Desserts', 'Beverages'],
    courseOrder: ['Starters', 'Mains', 'Wood-Fired', 'Desserts', 'Beverages'],
    dietaryFilters: [
      { id: 'all', label: 'All Diets' },
      { id: 'veg', label: 'Vegetarian' },
      { id: 'vegan', label: 'Vegan' },
      { id: 'non-veg', label: 'Non-Veg' },
    ],
    menuDietaryFilters: [
      { id: 'all', label: 'All' },
      { id: 'veg', label: 'Vegetarian' },
      { id: 'vegan', label: 'Vegan' },
      { id: 'non-veg', label: 'Non-Veg' },
    ],
    orderStatusSteps: [
      { key: 'RECEIVED', label: 'Received' },
      { key: 'PREPARING', label: 'In Kitchen' },
      { key: 'READY', label: 'Plating Ready' },
      { key: 'SERVED', label: 'Served' },
    ],
    escapeHtml: escapeHtml,
    resolveMediaSources: resolveMediaSources,
  };
})(typeof window !== 'undefined' ? window : globalThis);
