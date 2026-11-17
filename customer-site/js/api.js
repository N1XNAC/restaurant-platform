(function (global) {
  'use strict';

  var NS = (global.MaisonVerbena = global.MaisonVerbena || {});

  function ApiError(message, code, statusCode, requiresReverification) {
    var err = new Error(message);
    err.name = 'ApiError';
    err.code = code || 'REQUEST_FAILED';
    err.statusCode = statusCode || 500;
    err.requiresReverification = Boolean(requiresReverification);
    return err;
  }

  function resolveApiUrl(path) {
    var base = NS.config && NS.config.getApiBaseUrl ? NS.config.getApiBaseUrl() : '';
    if (!base) return path;
    if (/^https?:\/\//i.test(path)) return path;
    return base + (path.charAt(0) === '/' ? path : '/' + path);
  }

  async function apiRequest(path, options) {
    var opts = options || {};
    var headers = Object.assign(
      { 'Content-Type': 'application/json' },
      opts.headers || {}
    );

    var response;
    try {
      response = await fetch(resolveApiUrl(path), {
        method: opts.method || 'GET',
        headers: headers,
        body: opts.body,
      });
    } catch (_networkErr) {
      throw ApiError(
        'Unable to reach the restaurant ordering server. Please check your connection and try again.',
        'NETWORK_ERROR',
        0,
        false
      );
    }

    var payload = null;
    try {
      payload = await response.json();
    } catch (_parseErr) {
      payload = null;
    }

    if (!response.ok) {
      var errObj = (payload && payload.error) || {};
      throw ApiError(
        errObj.message || 'Request failed (' + response.status + ')',
        errObj.code || 'REQUEST_FAILED',
        response.status,
        Boolean(errObj.requiresReverification)
      );
    }

    return payload;
  }

  NS.api = {
    ApiError: ApiError,
    resolveApiUrl: resolveApiUrl,
    request: apiRequest,
    fetchDemoTablePresets: async function () {
      var data = await apiRequest('/api/session/demo-tokens');
      return Array.isArray(data && data.presets) ? data.presets : [];
    },
    validateTableToken: async function (token, gps) {
      var data = await apiRequest('/api/session/validate', {
        method: 'POST',
        body: JSON.stringify({ token: token, gps: gps || null }),
      });
      return data.session;
    },
    verifySessionLocation: async function (sessionId, sessionSignature, gps) {
      var data = await apiRequest('/api/session/verify-location', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: sessionId,
          sessionSignature: sessionSignature,
          gps: gps,
        }),
      });
      return data.session;
    },
    verifyTableChallengePin: async function (sessionId, sessionSignature, pin) {
      var data = await apiRequest('/api/session/verify-challenge', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: sessionId,
          sessionSignature: sessionSignature,
          pin: pin,
        }),
      });
      return data.session;
    },
    fetchRestaurantMenu: async function (restaurantId, params) {
      var query = new URLSearchParams();
      if (params && params.search) query.set('search', params.search);
      if (params && params.category && params.category !== 'All') {
        query.set('category', params.category);
      }
      if (params && params.dietary && params.dietary !== 'all') {
        query.set('dietary', params.dietary);
      }
      var qs = query.toString();
      var path =
        '/api/restaurant/' +
        encodeURIComponent(restaurantId) +
        '/menu' +
        (qs ? '?' + qs : '');
      return apiRequest(path);
    },
    submitCustomerOrder: async function (payload) {
      return apiRequest('/api/orders', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    fetchOrderStatus: async function (orderId) {
      var data = await apiRequest('/api/orders/' + encodeURIComponent(orderId));
      return data.order;
    },
    cancelCustomerOrder: async function (payload) {
      var data = await apiRequest(
        '/api/orders/' + encodeURIComponent(payload.orderId) + '/cancel',
        {
          method: 'POST',
          body: JSON.stringify({
            sessionId: payload.sessionId,
            sessionSignature: payload.sessionSignature,
            reason: payload.reason,
          }),
        }
      );
      return data.order;
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
