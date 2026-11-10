
'use strict';

/*
====================================================
 JC NEON STUDIO 2.0
 COMBINED OVERLAY CONTROLLER
 JADE & CLARKE
====================================================

 - Kombiniertes OBS-Overlay
 - Integrierte Vorschau
 - Eigenes Overlay-Fenster
 - Chat-Tests
 - Unsichtbare Audio-Alerts
 - Gespeicherte Overlay-Einstellungen
 - BroadcastChannel
 - OBS-Adresse kopieren
 - Schnittstelle für Backup/Import
====================================================
*/

(() => {

  const VERSION = '2.0.0';

  const STORAGE_KEY = 'jc_overlay_settings';
  const CHANNEL_NAME = 'jc_streamtools_neon';

  const $ = id => document.getElementById(id);

  const preview = $('combinedOverlayPreview');

  if (!preview) return;

  const DEFAULTS = {
    chatEnabled: true,
    alertsEnabled: false,
    chatX: 3,
    chatY: 5,
    alertX: 4,
    alertY: 7,
    chatLife: 15,
    alertDuration: 6
  };

  const LIMITS = {
    chatX: [0, 60],
    chatY: [0, 70],
    alertX: [0, 60],
    alertY: [0, 70],
    chatLife: [3, 60],
    alertDuration: [2, 20]
  };

  const settingKeys = Object.keys(DEFAULTS);

  const controllerId =
    'jc-neon-' +
    Date.now().toString(36) +
    '-' +
    Math.random().toString(36).slice(2);

  let settings = { ...DEFAULTS };
  let channel = null;
  let overlayWindow = null;
  let sequence = 0;

  const recentEvents = new Map();

  // ==========================================
  // HILFSFUNKTIONEN
  // ==========================================

  function notify(message) {
    const toast = $('toast');

    if (!toast) {
      console.info('[JC Neon Studio]', message);
      return;
    }

    toast.textContent = message;
    toast.classList.add('show');

    clearTimeout(notify.timer);

    notify.timer = setTimeout(() => {
      toast.classList.remove('show');
    }, 3500);
  }

  function clamp(value, min, max, fallback) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
      return fallback;
    }

    return Math.max(min, Math.min(max, number));
  }

  function normalizeSettings(source) {
    const result = { ...DEFAULTS };

    if (
      !source ||
      typeof source !== 'object' ||
      Array.isArray(source)
    ) {
      return result;
    }

    for (const key of ['chatEnabled', 'alertsEnabled']) {
      if (typeof source[key] === 'boolean') {
        result[key] = source[key];
      }
    }

    for (const [key, range] of Object.entries(LIMITS)) {
      result[key] = clamp(
        source[key],
        range[0],
        range[1],
        DEFAULTS[key]
      );
    }

    return result;
  }

  // ==========================================
  // SPEICHERN UND LADEN
  // ==========================================

  function saveSettings() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(settings)
      );
    } catch (error) {
      console.warn(
        '[JC Neon Studio] Overlay-Speicherung fehlgeschlagen:',
        error
      );
    }
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);

      if (raw) {
        settings = normalizeSettings(JSON.parse(raw));
      }
    } catch (error) {
      console.warn(
        '[JC Neon Studio] Overlay-Einstellungen konnten nicht geladen werden:',
        error
      );

      settings = { ...DEFAULTS };
    }
  }

  loadSettings();

  function updateSettingLabels() {
    for (const key of settingKeys) {
      const input = $('ov_' + key);
      const output = $('ov_' + key + '_value');

      if (input) {
        if (input.type === 'checkbox') {
          input.checked = settings[key];
        } else {
          input.value = String(settings[key]);
        }
      }

      if (output) {
        output.textContent = String(settings[key]);
      }
    }
  }

  // ==========================================
  // OVERLAY-KOMMUNIKATION
  // ==========================================

  function nextEventId() {
    sequence += 1;
    return controllerId + '-' + sequence;
  }

  function rememberEvent(id) {
    if (!id) return false;

    if (recentEvents.has(id)) {
      return true;
    }

    recentEvents.set(id, Date.now());

    while (recentEvents.size > 200) {
      recentEvents.delete(
        recentEvents.keys().next().value
      );
    }

    return false;
  }

  function targetOrigin() {
    return location.origin === 'null'
      ? '*'
      : location.origin;
  }

  function postToPreview(message) {
    try {
      preview.contentWindow?.postMessage(
        message,
        targetOrigin()
      );
    } catch (error) {
      console.warn('Vorschau nicht erreichbar:', error);
    }
  }

  function postToWindow(message) {
    try {
      if (overlayWindow && !overlayWindow.closed) {
        overlayWindow.postMessage(
          message,
          targetOrigin()
        );
      }
    } catch (error) {
      console.warn('Overlay-Fenster nicht erreichbar:', error);
    }
  }

  function postToChannel(message) {
    try {
      channel?.postMessage(message);
    } catch (error) {
      console.warn('Broadcast fehlgeschlagen:', error);
    }
  }

  function sendMessage(message, broadcast = true) {
    const payload = {
      ...message,
      jcSource: controllerId,
      jcEventId: message.jcEventId || nextEventId(),
      timestamp: Date.now()
    };

    rememberEvent(payload.jcEventId);

    postToPreview(payload);
    postToWindow(payload);

    if (broadcast) {
      postToChannel(payload);
    }

    return payload;
  }

  function updateConfig() {
    sendMessage({
      type: 'overlay-config',
      settings: { ...settings }
    });
  }

  // ==========================================
  // BROADCAST CHANNEL
  // ==========================================

  if ('BroadcastChannel' in window) {
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);

      channel.onmessage = event => {
        const data = event.data;

        if (!data || typeof data !== 'object') {
          return;
        }

        if (data.jcSource === controllerId) {
          return;
        }

        if (data.type === 'overlay-config') {
          return;
        }

        if (
          data.type !== 'chat' &&
          data.type !== 'alert'
        ) {
          return;
        }

        if (
          data.jcEventId &&
          rememberEvent(data.jcEventId)
        ) {
          return;
        }

        postToPreview(data);
        postToWindow(data);
      };

    } catch (error) {
      console.warn(
        'BroadcastChannel nicht verfügbar:',
        error
      );
    }
  }

  // ==========================================
  // EINSTELLUNGEN
  // ==========================================

  updateSettingLabels();

  for (const key of settingKeys) {
    const input = $('ov_' + key);

    if (!input) continue;

    const update = () => {
      if (input.type === 'checkbox') {
        settings[key] = input.checked;
      } else {
        const [min, max] = LIMITS[key];

        settings[key] = clamp(
          input.value,
          min,
          max,
          DEFAULTS[key]
        );
      }

      saveSettings();
      updateSettingLabels();
      updateConfig();
    };

    input.addEventListener(
      input.type === 'checkbox' ? 'change' : 'input',
      update
    );
  }

  // ==========================================
  // CHAT-TESTS
  // ==========================================

  function sendChat(user, message) {
    const username = String(user || 'Gast')
      .trim()
      .slice(0, 50);

    const text = String(message || '')
      .trim()
      .slice(0, 500);

    if (!text) {
      notify('Bitte eine Nachricht eingeben.');
      return false;
    }

    if (!settings.chatEnabled) {
      notify('Chat-Overlay ist deaktiviert.');
      return false;
    }

    sendMessage({
      type: 'chat',
      user: username,
      message: text,
      duration: settings.chatLife
    });

    return true;
  }

  $('ov_testChat')?.addEventListener('click', () => {
    const user =
      $('testUser')?.value.trim() ||
      'FaulieFan';

    const success = sendChat(
      user,
      'Moin Faulie! Dein JC Neon Studio funktioniert! 💜'
    );

    if (success) {
      notify('Chat-Test gesendet.');
    }
  });

  // ==========================================
  // ALERT-TESTS
  // ==========================================

  const alertNames = {
    follow: 'Follower',
    sub: 'Abo',
    bits: 'Bits'
  };

  function isAlertEnabled(type) {
    const ids = {
      follow: 'followEnabled',
      sub: 'subEnabled',
      bits: 'bitsEnabled'
    };

    const input = $(ids[type]);

    return input ? input.checked : true;
  }

  function sendAlert(type, username, amount = 100) {
    if (!alertNames[type]) return false;

    if (!isAlertEnabled(type)) {
      notify(alertNames[type] + '-Sound ist deaktiviert.');
      return false;
    }

    // Die Soundwiedergabe übernimmt app.js.
    // Dadurch wird ein Sound nicht doppelt abgespielt.
    const app = window.JCStreamTools;

    if (!app?.triggerAlert) {
      notify('Sound-System ist nicht verfügbar.');
      return false;
    }

    const user = String(
      username || 'NeonSloth'
    ).trim().slice(0, 50);

    const success = app.triggerAlert(
      type,
      user,
      amount
    );

    if (!success) return false;

    // Nur bei ausdrücklich aktivierten sichtbaren
    // Alerts eine Overlay-Nachricht senden.
    if (settings.alertsEnabled) {
      sendMessage({
        type: 'alert',
        event: type,
        user,
        amount: Math.max(1, Number(amount) || 1),
        duration: settings.alertDuration
      });
    }

    return true;
  }

  document.querySelectorAll('[data-overlay-alert]')
    .forEach(button => {
      button.addEventListener('click', () => {
        const type = button.dataset.overlayAlert;

        const username =
          $('alertUser')?.value.trim() ||
          'NeonSloth';

        sendAlert(type, username);
      });
    });

  // ==========================================
  // IFRAME UND FENSTER
  // ==========================================

  preview.addEventListener('load', () => {
    updateConfig();

    console.info(
      '[JC Neon Studio] Overlay-Vorschau geladen.'
    );
  });

  window.addEventListener('message', event => {
    const fromPreview =
      event.source === preview.contentWindow;

    const fromWindow =
      overlayWindow &&
      event.source === overlayWindow;

    if (!fromPreview && !fromWindow) return;

    if (
      location.origin !== 'null' &&
      event.origin !== location.origin
    ) {
      return;
    }

    const data = event.data;

    if (!data || typeof data !== 'object') {
      return;
    }

    if (
      data.type === 'overlay-ready' ||
      data.type === 'jc-overlay-ready'
    ) {
      const config = {
        type: 'overlay-config',
        settings: { ...settings },
        jcSource: controllerId
      };

      if (fromPreview) {
        postToPreview(config);
      }

      if (fromWindow) {
        postToWindow(config);
      }
    }
  });

  // ==========================================
  // OVERLAY-FENSTER
  // ==========================================

  $('ov_openWindow')?.addEventListener('click', () => {
    const url = new URL(
      'overlay.html?preview=1',
      location.href
    );

    overlayWindow = window.open(
      url.href,
      'JCNeonStudioOverlay',
      'width=1280,height=720,resizable=yes,scrollbars=no'
    );

    if (!overlayWindow) {
      notify(
        'Popup blockiert. Bitte Popups für diese Seite erlauben.'
      );
      return;
    }

    overlayWindow.focus();

    notify('Overlay-Fenster geöffnet.');
  });

  // ==========================================
  // OBS-ADRESSE
  // ==========================================

  function getObsUrl() {
    return new URL(
      'overlay.html?obs=1',
      location.href
    ).href;
  }

  $('ov_copyUrl')?.addEventListener('click', async () => {
    if (location.protocol === 'file:') {
      notify(
        'Für OBS ist später eine veröffentlichte HTTPS-Adresse vorgesehen.'
      );
      return;
    }

    const url = getObsUrl();

    try {
      await navigator.clipboard.writeText(url);
      notify('OBS-Adresse kopiert.');
    } catch (error) {
      window.prompt(
        'OBS-Adresse kopieren:',
        url
      );
    }
  });

  // ==========================================
  // BACKUP-SCHNITTSTELLE
  // ==========================================

  function getSettings() {
    return { ...settings };
  }

  function importSettings(data) {
    settings = normalizeSettings(data);

    saveSettings();
    updateSettingLabels();
    updateConfig();

    return true;
  }

  function resetSettings() {
    settings = { ...DEFAULTS };

    saveSettings();
    updateSettingLabels();
    updateConfig();

    notify('Overlay-Einstellungen zurückgesetzt.');
  }

  // ==========================================
  // ÖFFENTLICHE SCHNITTSTELLE
  // ==========================================

  window.JCOverlay = Object.freeze({
    version: VERSION,
    getSettings,
    importSettings,
    updateConfig,
    sendChat,
    sendAlert,
    resetSettings,
    getObsUrl
  });

  // ==========================================
  // START
  // ==========================================

  updateConfig();

  console.info(
    '[JC Neon Studio] Overlay Controller v' +
    VERSION +
    ' bereit.'
  );

})();
