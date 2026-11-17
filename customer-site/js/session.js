(function (global) {
  'use strict';

  var NS = (global.MaisonVerbena = global.MaisonVerbena || {});
  var SESSION_STORAGE_KEY = 'mv_active_session_v1';

  var state = {
    session: loadCachedSession(),
    isValidating: true,
    sessionError: null,
    tamperWarning: null,
    presets: [],
  };

  var listeners = [];

  function notify() {
    var snapshot = getState();
    for (var i = 0; i < listeners.length; i++) {
      try {
        listeners[i](snapshot);
      } catch (_err) {
        // Keep other listeners running
      }
    }
  }

  function getState() {
    return {
      session: state.session,
      isValidating: state.isValidating,
      sessionError: state.sessionError,
      tamperWarning: state.tamperWarning,
      presets: state.presets.slice(),
    };
  }

  function loadCachedSession() {
    try {
      var raw = global.sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.sessionId || !parsed.sessionSignature) return null;
      if (Date.parse(parsed.expiresAt) <= Date.now()) {
        global.sessionStorage.removeItem(SESSION_STORAGE_KEY);
        return null;
      }
      return parsed;
    } catch (_err) {
      return null;
    }
  }

  function saveCachedSession(session) {
    try {
      if (!session) {
        global.sessionStorage.removeItem(SESSION_STORAGE_KEY);
        return;
      }
      global.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    } catch (_err) {
      // Ignore storage quota errors
    }
  }

  function updateSession(nextSession) {
    state.session = nextSession;
    saveCachedSession(nextSession);
    state.sessionError = null;
    notify();
  }

  function dismissTamperWarning() {
    state.tamperWarning = null;
    notify();
  }

  function requestOneTimeLocation() {
    return new Promise(function (resolve, reject) {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        reject(new Error('Geolocation is not supported in this browser.'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          });
        },
        function (err) {
          reject(new Error(err.message || 'Location permission was declined.'));
        },
        {
          enableHighAccuracy: true,
          timeout: 8000,
          maximumAge: 30000,
        }
      );
    });
  }

  async function scanToken(token, gps) {
    state.isValidating = true;
    state.sessionError = null;
    notify();
    try {
      var validated = await NS.api.validateTableToken(token, gps);
      state.session = validated;
      saveCachedSession(validated);
      state.sessionError = null;
      return validated;
    } catch (err) {
      var message =
        err && err.message ? err.message : 'Unable to validate table QR/NFC token.';
      state.session = null;
      saveCachedSession(null);
      state.sessionError = message;
      throw err;
    } finally {
      state.isValidating = false;
      notify();
    }
  }

  async function verifyLocationWithConsent() {
    if (!state.session) {
      return { ok: false, message: 'No active table session found.' };
    }
    try {
      var gps = await requestOneTimeLocation();
      var updated = await NS.api.verifySessionLocation(
        state.session.sessionId,
        state.session.sessionSignature,
        gps
      );
      updateSession(updated);
      if (updated.locationStatus === 'verified') {
        return {
          ok: true,
          message:
            'Dining room presence verified (' +
            (updated.distanceMeters != null ? updated.distanceMeters : 0) +
            'm from restaurant).',
        };
      }
      return {
        ok: false,
        message:
          'Location appears ' +
          (updated.distanceMeters != null ? updated.distanceMeters : 'far') +
          'm away. Please enter the 4-digit placard PIN on your table.',
      };
    } catch (err) {
      var detail =
        err && err.message
          ? err.message + ' Your QR/NFC session remains valid.'
          : 'Location unavailable. Your QR/NFC session remains valid.';
      return { ok: false, message: detail };
    }
  }

  async function submitChallengePin(pin) {
    if (!state.session) {
      throw new Error('No active table session.');
    }
    var updated = await NS.api.verifyTableChallengePin(
      state.session.sessionId,
      state.session.sessionSignature,
      pin
    );
    updateSession(updated);
    return updated;
  }

  async function bootstrap() {
    var params = new URLSearchParams(global.location ? global.location.search : '');
    var urlToken = params.get('token');
    var hasTamperedParams =
      params.has('restaurantId') || params.has('tableId') || params.has('table');

    if (hasTamperedParams) {
      state.tamperWarning =
        'Direct restaurant or table URL overrides are ignored for security. Only server-verified QR or NFC tokens can assign a table session.';
      notify();
    }

    NS.api
      .fetchDemoTablePresets()
      .then(function (list) {
        state.presets = list;
        notify();
      })
      .catch(function () {
        // Non-blocking preset directory
      });

    if (urlToken) {
      try {
        var validated = await NS.api.validateTableToken(urlToken);
        state.session = validated;
        saveCachedSession(validated);
        state.sessionError = null;
      } catch (err) {
        state.session = null;
        saveCachedSession(null);
        state.sessionError =
          err && err.message ? err.message : 'Invalid QR or NFC table token.';
      } finally {
        state.isValidating = false;
        notify();
      }
      return state.session;
    }

    var cached = loadCachedSession();
    if (cached) {
      state.session = cached;
      state.isValidating = false;
      state.sessionError = null;
      notify();
      return cached;
    }

    try {
      var fallbackToken =
        (NS.config && NS.config.defaultEntryToken) || 'QR_MV_T08_VALID';
      var defaultSession = await NS.api.validateTableToken(fallbackToken);
      state.session = defaultSession;
      saveCachedSession(defaultSession);
      state.sessionError = null;
      return defaultSession;
    } catch (err) {
      state.sessionError =
        err && err.message ? err.message : 'Could not initialize table session.';
      return null;
    } finally {
      state.isValidating = false;
      notify();
    }
  }

  NS.session = {
    bootstrap: bootstrap,
    subscribe: function (listener) {
      listeners.push(listener);
      listener(getState());
      return function () {
        listeners = listeners.filter(function (fn) {
          return fn !== listener;
        });
      };
    },
    getState: getState,
    scanToken: scanToken,
    verifyLocationWithConsent: verifyLocationWithConsent,
    submitChallengePin: submitChallengePin,
    updateSession: updateSession,
    dismissTamperWarning: dismissTamperWarning,
  };
})(typeof window !== 'undefined' ? window : globalThis);
