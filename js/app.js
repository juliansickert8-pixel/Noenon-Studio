
'use strict';

/*
 * JC NEON STUDIO
 * Jade & Clarke
 *
 * Twitch OAuth PKCE
 * Twitch EventSub WebSocket
 * Chat & TTS
 * Emoji-Filter
 * M4A-Alerts
 * Overlay-Vorschau
 * Einstellungen & Backup
 */

(() => {
  const $ = id => document.getElementById(id);
  const $$ = selector => [...document.querySelectorAll(selector)];

  // ==========================================
  // KONFIGURATION
  // ==========================================

  const CLIENT_ID = 'kg0zc4v9bubqh0qacoup4tk6z1ceue';

  const GITHUB_REDIRECT =
    'https://juliansickert8-pixel.github.io/jc-neon-studio/';

  const SCOPES = [
    'user:read:chat',
    'user:bot',
    'moderator:read:followers',
    'channel:read:subscriptions',
    'bits:read'
  ];

  const SETTINGS_KEY = 'jc_neon_studio_v2';
  const AUTH_KEY = 'jc_neon_twitch_auth';
  const PKCE_KEY = 'jc_neon_twitch_pkce';

  const DEFAULTS = {
    studioUsername: 'faulie_gamer',
    studioDisplayName: 'FAULIE_GAMER',
    testUser: 'Faulie_Gamer',
    testMessage: 'Hey Faulie! Dein Stream sieht heute mega aus! 💜',
    alertUser: 'NeonSloth',
    chatInput: '',
    ttsEnabled: true,
    readNames: true,
    volume: 85,
    rate: 100,
    voiceName: 'Microsoft Stefan - German (Germany)',
    followEnabled: true,
    subEnabled: true,
    bitsEnabled: true,
    duration: 6,
    accent: 'purple',
    motion: true
  };

  const OVERLAY_DEFAULTS = {
    chatEnabled: true,
    alertsEnabled: true,
    chatX: 3,
    chatY: 5,
    alertX: 4,
    alertY: 7,
    chatLife: 15,
    alertDuration: 6
  };

  const SOUND_FILES = {
    follow: 'assets/sounds/jc_alert_follower.m4a',
    sub: 'assets/sounds/jc_alert_sub.m4a',
    bits: 'assets/sounds/jc_alert_bits.m4a'
  };

  const ALERT_NAMES = {
    follow: 'NEUER FOLLOWER',
    sub: 'NEUES ABONNEMENT',
    bits: 'BITS ERHALTEN'
  };

  const PAGE_TITLES = {
    dashboard: 'Dein Stream. Deine Kontrolle.',
    tts: 'Chat & Text-to-Speech',
    alerts: 'Stream-Alerts',
    overlay: 'OBS-Overlays',
    settings: 'Studio-Einstellungen'
  };

  // ==========================================
  // SPEICHER
  // ==========================================

  function readJSON(key, storage = localStorage) {
    try {
      return JSON.parse(storage.getItem(key) || 'null');
    } catch {
      return null;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.error('Speicherfehler:', error);
      return false;
    }
  }

  const saved = readJSON(SETTINGS_KEY) || {};
  const oldSaved = readJSON('jc_streamtools_neon_v1') || {};

  let settings = {
    ...DEFAULTS,
    ...oldSaved,
    ...(saved.settings || saved)
  };

  let overlaySettings = {
    ...OVERLAY_DEFAULTS,
    ...(saved.overlaySettings || {})
  };

  let auth = readJSON(AUTH_KEY);
  let twitchUser = null;
  let socket = null;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  let chatConnected = false;
  let socketGeneration = 0;
  let keepaliveTimer = null;
  let tokenTimer = null;
  let soundUnlocked = false;
  let toastTimer = null;

  const seenMessages = new Set();
  const chatHistory = [];

  function saveSettings() {
    writeJSON(SETTINGS_KEY, {
      settings,
      overlaySettings
    });
  }

  // ==========================================
  // OBERFLÄCHE
  // ==========================================

  function text(id, value) {
    const element = $(id);
    if (element) element.textContent = String(value);
  }

  function value(id, newValue) {
    const element = $(id);
    if (element) element.value = newValue;
  }

  function checked(id, newValue) {
    const element = $(id);
    if (element) element.checked = Boolean(newValue);
  }

  function toast(message, duration = 4000) {
    const element = $('toast');

    if (!element) {
      console.log(message);
      return;
    }

    element.textContent = message;
    element.classList.add('show');

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
      element.classList.remove('show');
    }, duration);
  }

  function bind(id, event, handler) {
    const element = $(id);
    if (element) element.addEventListener(event, handler);
  }

  function setDot(id, connected) {
    const element = $(id);
    if (!element) return;

    element.classList.toggle('amber', !connected);
    element.classList.toggle('green', connected);
    element.classList.toggle('online', connected);
    element.classList.toggle('connected', connected);
  }

  // ==========================================
  // NAVIGATION
  // ==========================================

  function showPage(pageId) {
    if (!$(pageId)) return;

    $$('.page').forEach(page => {
      page.classList.toggle('active', page.id === pageId);
    });

    $$('.nav').forEach(button => {
      button.classList.toggle(
        'active',
        button.dataset.page === pageId
      );
    });

    text('pageTitle', PAGE_TITLES[pageId] || 'JC Neon Studio');

    if (pageId === 'overlay') {
      refreshOverlayPreview();
    }
  }

  function initNavigation() {
    $$('[data-page]').forEach(button => {
      button.addEventListener('click', () => {
        showPage(button.dataset.page);
      });
    });

    $$('[data-goto]').forEach(button => {
      button.addEventListener('click', () => {
        showPage(button.dataset.goto);
      });
    });
  }

  // ==========================================
  // DESIGN
  // ==========================================

  function applyTheme() {
    document.documentElement.dataset.accent = settings.accent;
    document.body.dataset.accent = settings.accent;

    document.documentElement.classList.toggle(
      'reduce-motion',
      !settings.motion
    );

    document.body.classList.toggle(
      'reduce-motion',
      !settings.motion
    );
  }

  // ==========================================
  // TEXT TO SPEECH
  // ==========================================

  const synth = window.speechSynthesis;
  let voices = [];
  let speechQueue = [];
  let speaking = false;
  let speechGeneration = 0;

  function cleanTTSMessage(input) {
    return String(input || '')
      .replace(/https?:\/\/\S+/gi, '')
      .replace(/www\.\S+/gi, '')
      .replace(/[\u{1F1E6}-\u{1F1FF}]{2}/gu, '')
      .replace(/[0-9#*]\uFE0F?\u20E3/gu, '')
      .replace(/[\u{1F3FB}-\u{1F3FF}]/gu, '')
      .replace(/\p{Extended_Pictographic}/gu, '')
      .replace(/[\uFE0E\uFE0F\u200D]/gu, '')
      .replace(/[\u{E0020}-\u{E007F}]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function loadVoices() {
    if (!synth) return;

    voices = synth.getVoices();

    const select = $('voiceSelect');
    if (!select) return;

    const previous = settings.voiceName || settings.voice || '';

    const sorted = [
      ...voices.filter(v => v.lang.toLowerCase().startsWith('de')),
      ...voices.filter(v => !v.lang.toLowerCase().startsWith('de'))
    ];

    select.replaceChildren();

    if (!sorted.length) {
      select.add(new Option('Browser-Standardstimme', ''));
      return;
    }

    sorted.forEach(voice => {
      select.add(
        new Option(`${voice.name} (${voice.lang})`, voice.name)
      );
    });

    const preferred =
      sorted.find(v => v.name === previous) ||
      sorted.find(v => v.name.includes('Microsoft Stefan')) ||
      sorted.find(v => v.lang.startsWith('de')) ||
      sorted[0];

    settings.voiceName = preferred.name;
    select.value = preferred.name;
  }

  function stopTTS() {
    speechGeneration++;
    speechQueue = [];
    speaking = false;
    synth?.cancel();
  }

  function speakNext() {
    if (!synth || speaking || !settings.ttsEnabled) return;

    const item = speechQueue.shift();
    if (!item) return;

    const generation = speechGeneration;
    const utterance = new SpeechSynthesisUtterance(item);

    const voice = voices.find(
      v => v.name === settings.voiceName
    );

    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else {
      utterance.lang = 'de-DE';
    }

    utterance.volume = Math.max(
      0,
      Math.min(1, Number(settings.volume) / 100)
    );

    utterance.rate = Math.max(
      0.5,
      Math.min(2, Number(settings.rate) / 100)
    );

    speaking = true;

    const finish = () => {
      if (generation !== speechGeneration) return;
      speaking = false;
      speakNext();
    };

    utterance.onend = finish;
    utterance.onerror = finish;

    try {
      synth.speak(utterance);
    } catch (error) {
      console.error('TTS-Fehler:', error);
      finish();
    }
  }

  function speakMessage(username, message, force = false) {
    if (!synth || (!settings.ttsEnabled && !force)) return;

    const cleaned = cleanTTSMessage(message);
    if (!cleaned) return;

    const name = cleanTTSMessage(username);

    const output =
      settings.readNames && name
        ? `${name} schreibt: ${cleaned}`
        : cleaned;

    if (speechQueue.length >= 30) speechQueue.shift();

    speechQueue.push(output);
    speakNext();
  }

  function updateTTSStatus() {
    text('ttsStatus', settings.ttsEnabled ? 'AKTIV' : 'DEAKTIVIERT');
    text('volumeValue', `${settings.volume} %`);
    text('rateValue', `${(settings.rate / 100).toFixed(1)}×`);
  }

  function initTTS() {
    loadVoices();

    if (synth) {
      synth.addEventListener?.('voiceschanged', loadVoices);
    }

    bind('voiceSelect', 'change', event => {
      settings.voiceName = event.target.value;
      saveSettings();
    });

    bind('ttsEnabled', 'change', event => {
      settings.ttsEnabled = event.target.checked;
      if (!settings.ttsEnabled) stopTTS();
      saveSettings();
      updateTTSStatus();
    });

    bind('readNames', 'change', event => {
      settings.readNames = event.target.checked;
      saveSettings();
    });

    bind('volume', 'input', event => {
      settings.volume = Number(event.target.value);
      saveSettings();
      updateTTSStatus();
    });

    bind('rate', 'input', event => {
      settings.rate = Number(event.target.value);
      saveSettings();
      updateTTSStatus();
    });

    bind('testVoice', 'click', () => {
      speakMessage(
        'Faulie',
        'Hallo! Deine Sprachausgabe funktioniert.',
        true
      );
    });

    bind('stopVoice', 'click', stopTTS);

    bind('testMessageBtn', 'click', () => {
      const username = $('testUser')?.value.trim() || 'Faulie';
      const message = $('testMessage')?.value.trim() || '';

      if (!message) return toast('Bitte eine Nachricht eingeben.');

      addChat(username, message, 'test');
    });

    updateTTSStatus();
  }

  // ==========================================
  // CHAT
  // ==========================================

  function addChat(username, message, source = 'local') {
    const name = String(username || 'Unbekannt');
    const content = String(message || '').trim();

    if (!content) return;

    const item = {
      username: name,
      message: content,
      source,
      timestamp: Date.now()
    };

    chatHistory.push(item);

    if (chatHistory.length > 100) {
      chatHistory.shift();
    }

    const feed = $('chatFeed');

    if (feed) {
      const row = document.createElement('div');
      row.className = 'chat-line';

      const user = document.createElement('span');
      user.className = 'username';
      user.textContent = name;

      const msg = document.createElement('span');
      msg.textContent = content;

      row.append(user, msg);
      feed.appendChild(row);

      while (feed.children.length > 100) {
        feed.firstElementChild.remove();
      }

      feed.scrollTop = feed.scrollHeight;
    }

    speakMessage(name, content);

    sendOverlayEvent({
      type: 'chat',
      username: name,
      message: content,
      timestamp: item.timestamp
    });
  }

  function sendTestChat() {
    const input = $('chatInput');
    const message = input?.value.trim();

    if (!message) {
      toast('Bitte zuerst eine Nachricht schreiben.');
      return;
    }

    addChat(
      settings.testUser || 'Faulie_Gamer',
      message,
      'test'
    );

    input.value = '';
    input.focus();
  }

  function initChat() {
    bind('sendChat', 'click', sendTestChat);

    bind('chatInput', 'keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendTestChat();
      }
    });

    bind('testUser', 'change', event => {
      settings.testUser = event.target.value;
      saveSettings();
    });

    bind('testMessage', 'change', event => {
      settings.testMessage = event.target.value;
      saveSettings();
    });
  }

  // ==========================================
  // ALERT SOUNDS
  // ==========================================

  const audioPlayers = {};

  function unlockSounds() {
    soundUnlocked = true;
  }

  async function playAlertSound(type) {
    const file = SOUND_FILES[type];
    if (!file) return;

    try {
      if (!audioPlayers[type]) {
        audioPlayers[type] = new Audio(file);
        audioPlayers[type].preload = 'auto';
      }

      const audio = audioPlayers[type];

      audio.pause();
      audio.currentTime = 0;
      audio.volume = Math.max(
        0,
        Math.min(1, Number(settings.volume) / 100)
      );

      await audio.play();
    } catch (error) {
      console.warn('Alert-Sound konnte nicht abgespielt werden:', error);

      toast(
        'Sound nicht abspielbar. Prüfe die M4A-Datei und Browser-Audiofreigabe.',
        6000
      );
    }
  }

  let alertPreviewTimer = null;

  function showAlert(type, username, details = {}) {
    const enabled = {
      follow: settings.followEnabled,
      sub: settings.subEnabled,
      bits: settings.bitsEnabled
    };

    if (!enabled[type]) return;

    playAlertSound(type);

    const label = ALERT_NAMES[type] || 'STREAM-ALERT';
    const preview = $('alertPreview');

    if (preview) {
      preview.replaceChildren();

      const icon = document.createElement('div');
      icon.className = 'placeholder-icon';
      icon.textContent =
        type === 'follow' ? '♡' :
        type === 'sub' ? '★' : '◆';

      const title = document.createElement('b');
      title.textContent = label;

      const user = document.createElement('small');
      user.textContent = username;

      preview.append(icon, title, user);

      clearTimeout(alertPreviewTimer);

      alertPreviewTimer = setTimeout(() => {
        preview.replaceChildren();

        const message = document.createElement('small');
        message.textContent = 'Bereit für den nächsten Alert';

        preview.appendChild(message);
      }, Number(settings.duration) * 1000);
    }

    sendOverlayEvent({
      type: 'alert',
      alertType: type,
      username,
      message: details.message || '',
      amount: details.amount || 0,
      duration: Number(settings.duration)
    });
  }

  function initAlerts() {
    $$('[data-test]').forEach(button => {
      button.addEventListener('click', () => {
        unlockSounds();

        showAlert(
          button.dataset.test,
          $('alertUser')?.value.trim() || 'NeonSloth'
        );
      });
    });

    ['follow', 'sub', 'bits'].forEach(type => {
      const id = `${type}Enabled`;

      bind(id, 'change', event => {
        settings[id] = event.target.checked;
        saveSettings();
      });
    });

    bind('alertUser', 'change', event => {
      settings.alertUser = event.target.value;
      saveSettings();
    });

    bind('duration', 'input', event => {
      settings.duration = Number(event.target.value);
      text('durationValue', `${settings.duration} Sekunden`);
      saveSettings();
    });
  }

  // ==========================================
  // OVERLAY
  // ==========================================

  let overlayChannel = null;

  try {
    if ('BroadcastChannel' in window) {
      overlayChannel = new BroadcastChannel('jc_streamtools_neon');
    }
  } catch (error) {
    console.warn('BroadcastChannel nicht verfügbar:', error);
  }

  function sendOverlayEvent(data) {
    const message = {
      ...data,
      origin: 'jc-neon-studio',
      sentAt: Date.now()
    };

    try {
      overlayChannel?.postMessage(message);
    } catch (error) {
      console.warn('Overlay-Nachricht fehlgeschlagen:', error);
    }

    const frame = $('combinedOverlayPreview');

    try {
      frame?.contentWindow?.postMessage(message, location.origin);
    } catch {
      // Vorschau ist möglicherweise nicht erreichbar.
    }
  }

  function getOverlayURL(preview = false) {
    const url = new URL('overlay.html', location.href);
    url.searchParams.set(preview ? 'preview' : 'obs', '1');
    return url.href;
  }

  function refreshOverlayPreview() {
    const frame = $('combinedOverlayPreview');
    if (!frame) return;

    const url = getOverlayURL(true);

    if (frame.src !== url) {
      frame.src = url;
    }
  }

  function syncOverlaySettings() {
    sendOverlayEvent({
      type: 'settings',
      settings: { ...overlaySettings },
      accent: settings.accent,
      motion: settings.motion
    });
  }

  function initOverlays() {
    const overlayFields = {
      ov_chatEnabled: 'chatEnabled',
      ov_alertsEnabled: 'alertsEnabled',
      ov_chatX: 'chatX',
      ov_chatY: 'chatY',
      ov_alertX: 'alertX',
      ov_alertY: 'alertY',
      ov_chatLife: 'chatLife',
      ov_alertDuration: 'alertDuration'
    };

    Object.entries(overlayFields).forEach(([id, key]) => {
      const element = $(id);
      if (!element) return;

      const eventName =
        element.type === 'checkbox' ? 'change' : 'input';

      element.addEventListener(eventName, () => {
        overlaySettings[key] =
          element.type === 'checkbox'
            ? element.checked
            : Number(element.value);

        const output = $(`${id}_value`);
        if (output) output.textContent = element.value;

        saveSettings();
        syncOverlaySettings();
      });
    });

    bind('ov_openWindow', 'click', () => {
      window.open(
        getOverlayURL(),
        '_blank',
        'noopener,noreferrer'
      );
    });

    bind('ov_copyUrl', 'click', async () => {
      try {
        await navigator.clipboard.writeText(getOverlayURL());
        toast('OBS-Adresse kopiert.');
      } catch {
        prompt('OBS-Adresse kopieren:', getOverlayURL());
      }
    });

    bind('ov_testChat', 'click', () => {
      addChat(
        'NeonSloth',
        'Moin Faulie! Das Overlay funktioniert! 💜',
        'test'
      );
    });

    $$('[data-overlay-alert]').forEach(button => {
      button.addEventListener('click', () => {
        showAlert(button.dataset.overlayAlert, 'NeonSloth');
      });
    });

    window.addEventListener('message', event => {
      if (event.origin !== location.origin) return;

      if (event.data?.type === 'overlay-ready') {
        syncOverlaySettings();
      }
    });
  }

  // ==========================================
  // TWITCH STATUS
  // ==========================================

  function isAuthenticated() {
    return Boolean(auth?.accessToken && twitchUser?.id);
  }

  function updateTwitchStatus() {
    const connected = isAuthenticated();
    const username =
      twitchUser?.display_name ||
      twitchUser?.login ||
      '';

    const authLabel = connected
      ? 'ONLINE · VERBUNDEN'
      : 'OFFLINE · NICHT VERBUNDEN';

    text('connectionStatus', authLabel);
    text('connectionStat', connected ? 'ONLINE' : 'OFFLINE');

    text(
      'connectionStatDetail',
      connected
        ? `Angemeldet als ${username}`
        : 'Twitch noch nicht verbunden'
    );

    text(
      'sideConnectionStatus',
      connected ? 'Twitch verbunden' : 'Nicht verbunden'
    );

    text(
      'sideConnectionDetail',
      connected
        ? chatConnected
          ? 'Live-Chat aktiv'
          : 'Live-Chat nicht aktiv'
        : 'Twitch-Verbindung ausstehend'
    );

    text(
      'settingsConnectionStatus',
      connected ? 'Verbunden' : 'Nicht verbunden'
    );

    text(
      'settingsConnectionDetail',
      connected
        ? `${username} · Chat: ${chatConnected ? 'aktiv' : 'offline'}`
        : 'Twitch-Anmeldung ausstehend'
    );

    text('chatModeTag', chatConnected ? 'TWITCH LIVE' : 'TESTBEREICH');

    ['connectionDot', 'sideConnectionDot',
      'profileConnectionDot', 'settingsConnectionDot'
    ].forEach(id => setDot(id, connected));

    const button = $('twitchBtn');

    if (button) {
      button.textContent = connected
        ? 'Twitch trennen'
        : 'Twitch verbinden ↗';
    }

    const pill = $('connectionPill');

    if (pill) {
      pill.classList.toggle('online', connected);
      pill.classList.toggle('offline', !connected);
    }
  }

  function saveAuth(data) {
    auth = data;

    if (data) {
      writeJSON(AUTH_KEY, data);
    } else {
      localStorage.removeItem(AUTH_KEY);
    }
  }

  // ==========================================
  // TWITCH OAUTH PKCE
  // ==========================================

  function randomString(length = 64) {
    const alphabet =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);

    return Array.from(
      bytes,
      byte => alphabet[byte % alphabet.length]
    ).join('');
  }

  function base64url(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';

    bytes.forEach(byte => {
      binary += String.fromCharCode(byte);
    });

    return btoa(binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }

  async function codeChallenge(verifier) {
    const bytes = new TextEncoder().encode(verifier);
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return base64url(hash);
  }

  function redirectURI() {
    // Bei Go Live muss diese URL zusätzlich
    // in der Twitch Developer Console eingetragen sein.
    if (
      location.hostname === 'localhost' ||
      location.hostname === '127.0.0.1'
    ) {
      return `${location.origin}${location.pathname}`;
    }

    return GITHUB_REDIRECT;
  }

  async function connectTwitch() {
    if (!crypto?.subtle) {
      toast('Twitch benötigt HTTPS oder localhost.', 6000);
      return;
    }

    try {
      const verifier = randomString(96);
      const state = randomString(48);
      const challenge = await codeChallenge(verifier);

      sessionStorage.setItem(
        PKCE_KEY,
        JSON.stringify({
          verifier,
          state,
          redirect: redirectURI(),
          createdAt: Date.now()
        })
      );

      const params = new URLSearchParams({
        client_id: CLIENT_ID,
        redirect_uri: redirectURI(),
        response_type: 'code',
        scope: SCOPES.join(' '),
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256'
      });

      location.assign(
        `https://id.twitch.tv/oauth2/authorize?${params}`
      );
    } catch (error) {
      console.error(error);
      toast(`Twitch-Anmeldung fehlgeschlagen: ${error.message}`);
    }
  }

  function cleanOAuthURL() {
    const url = new URL(location.href);

    ['code', 'state', 'error', 'error_description'].forEach(key => {
      url.searchParams.delete(key);
    });

    history.replaceState({}, document.title, url.href);
  }

  async function handleOAuthCallback() {
    const params = new URLSearchParams(location.search);

    if (params.has('error')) {
      toast(
        'Twitch: ' +
        (params.get('error_description') || params.get('error')),
        7000
      );
      cleanOAuthURL();
      return false;
    }

    const code = params.get('code');
    if (!code) return false;

    const pkce = readJSON(PKCE_KEY, sessionStorage);
    cleanOAuthURL();

    if (
      !pkce ||
      pkce.state !== params.get('state') ||
      !pkce.verifier ||
      Date.now() - pkce.createdAt > 600000
    ) {
      toast('Twitch-Anmeldung abgelaufen. Bitte erneut verbinden.');
      return false;
    }

    try {
      const response = await fetch(
        'https://id.twitch.tv/oauth2/token',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({
            client_id: CLIENT_ID,
            grant_type: 'authorization_code',
            code,
            redirect_uri: pkce.redirect,
            code_verifier: pkce.verifier
          })
        }
      );

      const data = await response.json();

      if (!response.ok || !data.access_token) {
        throw new Error(data.message || 'Token-Austausch fehlgeschlagen');
      }

      saveAuth({
        accessToken: data.access_token,
        refreshToken: data.refresh_token || null,
        expiresAt: Date.now() + data.expires_in * 1000
      });

      sessionStorage.removeItem(PKCE_KEY);

      twitchUser = await fetchTwitchUser();

      if (!twitchUser) {
        throw new Error('Twitch-Benutzer konnte nicht geladen werden.');
      }

      updateTwitchStatus();
      toast(`Twitch verbunden: ${twitchUser.display_name}`);

      return true;
    } catch (error) {
      console.error('OAuth-Fehler:', error);
      saveAuth(null);
      twitchUser = null;
      updateTwitchStatus();

      toast(`Twitch-Fehler: ${error.message}`, 7000);
      return false;
    }
  }

  async function fetchTwitchUser() {
    if (!auth?.accessToken) return null;

    const response = await fetch(
      'https://api.twitch.tv/helix/users',
      {
        headers: {
          'Client-ID': CLIENT_ID,
          Authorization: `Bearer ${auth.accessToken}`
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Twitch-Benutzerabfrage: HTTP ${response.status}`);
    }

    const result = await response.json();
    return result.data?.[0] || null;
  }

  async function validateToken() {
    if (!auth?.accessToken) return false;

    try {
      const response = await fetch(
        'https://id.twitch.tv/oauth2/validate',
        {
          headers: {
            Authorization: `OAuth ${auth.accessToken}`
          }
        }
      );

      if (!response.ok) return false;

      const data = await response.json();
      return data.client_id === CLIENT_ID;
    } catch {
      return false;
    }
  }

  async function refreshToken() {
    if (!auth?.refreshToken) return false;

    try {
      const response = await fetch(
        'https://id.twitch.tv/oauth2/token',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({
            client_id: CLIENT_ID,
            grant_type: 'refresh_token',
            refresh_token: auth.refreshToken
          })
        }
      );

      const data = await response.json();

      if (!response.ok || !data.access_token) return false;

      saveAuth({
        accessToken: data.access_token,
        refreshToken: data.refresh_token || auth.refreshToken,
        expiresAt: Date.now() + data.expires_in * 1000
      });

      return true;
    } catch (error) {
      console.error('Token-Erneuerung:', error);
      return false;
    }
  }

  async function restoreTwitch() {
    if (!auth?.accessToken) return false;

    try {
      let valid = await validateToken();

      if (!valid && await refreshToken()) {
        valid = await validateToken();
      }

      if (!valid) {
        saveAuth(null);
        return false;
      }

      twitchUser = await fetchTwitchUser();
      updateTwitchStatus();

      return Boolean(twitchUser);
    } catch (error) {
      console.error('Sitzungswiederherstellung:', error);
      updateTwitchStatus();
      return false;
    }
  }

  async function disconnectTwitch() {
    stopEventSub();

    const token = auth?.accessToken;

    saveAuth(null);
    twitchUser = null;
    updateTwitchStatus();

    if (token) {
      try {
        await fetch('https://id.twitch.tv/oauth2/revoke', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({
            client_id: CLIENT_ID,
            token
          })
        });
      } catch (error) {
        console.warn('Token-Widerruf:', error);
      }
    }

    toast('Twitch-Verbindung getrennt.');
  }

  // ==========================================
  // TWITCH EVENTSUB WEBSOCKET
  // ==========================================

  function stopEventSub() {
    socketGeneration++;
    chatConnected = false;

    clearTimeout(reconnectTimer);
    clearTimeout(keepaliveTimer);

    reconnectTimer = null;
    keepaliveTimer = null;

    if (socket) {
      socket.onclose = null;
      socket.close();
      socket = null;
    }

    updateTwitchStatus();
  }

  function scheduleReconnect() {
    if (!isAuthenticated()) return;

    clearTimeout(reconnectTimer);

    reconnectAttempts++;

    const delay = Math.min(
      30000,
      1000 * Math.pow(2, Math.min(reconnectAttempts, 5))
    );

    reconnectTimer = setTimeout(startEventSub, delay);
  }

  function resetKeepalive(seconds = 30) {
    clearTimeout(keepaliveTimer);

    keepaliveTimer = setTimeout(() => {
      console.warn('Twitch EventSub Keepalive abgelaufen.');

      try {
        socket?.close();
      } catch {
        scheduleReconnect();
      }
    }, (Number(seconds) + 10) * 1000);
  }

  async function subscribeEvent(sessionId, type, version, condition) {
    const response = await fetch(
      'https://api.twitch.tv/helix/eventsub/subscriptions',
      {
        method: 'POST',
        headers: {
          'Client-ID': CLIENT_ID,
          Authorization: `Bearer ${auth.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          type,
          version,
          condition,
          transport: {
            method: 'websocket',
            session_id: sessionId
          }
        })
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(`${type}: ${data.message || response.status}`);
    }

    return data;
  }

  async function registerEvents(sessionId, generation) {
    const id = String(twitchUser.id);

    const events = [
      {
        type: 'channel.chat.message',
        version: '1',
        condition: {
          broadcaster_user_id: id,
          user_id: id
        }
      },
      {
        type: 'channel.follow',
        version: '2',
        condition: {
          broadcaster_user_id: id,
          moderator_user_id: id
        }
      },
      {
        type: 'channel.subscribe',
        version: '1',
        condition: {
          broadcaster_user_id: id
        }
      },
      {
        type: 'channel.subscription.gift',
        version: '1',
        condition: {
          broadcaster_user_id: id
        }
      },
      {
        type: 'channel.subscription.message',
        version: '1',
        condition: {
          broadcaster_user_id: id
        }
      },
      {
        type: 'channel.cheer',
        version: '1',
        condition: {
          broadcaster_user_id: id
        }
      }
    ];

    let chatRegistered = false;
    let successes = 0;

    for (const item of events) {
      if (generation !== socketGeneration || !isAuthenticated()) {
        return;
      }

      try {
        await subscribeEvent(
          sessionId,
          item.type,
          item.version,
          item.condition
        );

        successes++;

        if (item.type === 'channel.chat.message') {
          chatRegistered = true;
        }
      } catch (error) {
        console.warn('EventSub:', error.message);
      }
    }

    if (generation !== socketGeneration) return;

    chatConnected = chatRegistered;
    updateTwitchStatus();

    console.log(
      `Twitch EventSub: ${successes}/${events.length} registriert.`
    );

    if (!chatRegistered) {
      toast(
        'Twitch angemeldet, aber Live-Chat konnte nicht aktiviert werden.',
        7000
      );
    }
  }

  function handleNotification(payload) {
    const type = payload.subscription?.type;
    const event = payload.event || {};

    if (type === 'channel.chat.message') {
      const id = event.message_id;

      if (id && seenMessages.has(id)) return;

      if (id) {
        seenMessages.add(id);

        if (seenMessages.size > 500) {
          seenMessages.delete(seenMessages.values().next().value);
        }
      }

      addChat(
        event.chatter_user_name ||
          event.chatter_user_login ||
          'TwitchUser',
        event.message?.text || '',
        'twitch'
      );

      return;
    }

    if (type === 'channel.follow') {
      showAlert(
        'follow',
        event.user_name || event.user_login || 'Follower'
      );
      return;
    }

    if (
      type === 'channel.subscribe' ||
      type === 'channel.subscription.gift' ||
      type === 'channel.subscription.message'
    ) {
      showAlert(
        'sub',
        event.user_name ||
          (event.is_anonymous ? 'Anonym' : 'Abonnent'),
        {
          amount: event.total || 1,
          message: type === 'channel.subscription.gift'
            ? `${event.total || 1} Geschenk-Abos`
            : ''
        }
      );
      return;
    }

    if (type === 'channel.cheer') {
      showAlert(
        'bits',
        event.user_name || 'Anonym',
        {
          amount: event.bits || 0,
          message: `${event.bits || 0} Bits`
        }
      );
    }
  }

  function openEventSub(url, isReconnect = false) {
    if (!isAuthenticated()) return;

    const generation = ++socketGeneration;
    const ws = new WebSocket(url);

    if (!isReconnect && socket) {
      socket.onclose = null;
      socket.close();
    }

    socket = ws;

    ws.onmessage = async message => {
      if (generation !== socketGeneration) return;

      let packet;

      try {
        packet = JSON.parse(message.data);
      } catch {
        return;
      }

      const type = packet.metadata?.message_type;
      const payload = packet.payload || {};

      if (type === 'session_welcome') {
        reconnectAttempts = 0;

        resetKeepalive(
          payload.session?.keepalive_timeout_seconds || 30
        );

        if (!isReconnect) {
          await registerEvents(
            payload.session.id,
            generation
          );
        } else {
          chatConnected = true;
          updateTwitchStatus();
        }

        return;
      }

      if (type === 'session_keepalive') {
        resetKeepalive(30);
        return;
      }

      if (type === 'notification') {
        resetKeepalive(30);
        handleNotification(payload);
        return;
      }

      if (type === 'session_reconnect') {
        const reconnectURL = payload.session?.reconnect_url;

        if (reconnectURL) {
          openEventSub(reconnectURL, true);
        }

        return;
      }

      if (type === 'revocation') {
        console.warn('Twitch EventSub widerrufen:', payload);
        chatConnected = false;
        updateTwitchStatus();
      }
    };

    ws.onerror = error => {
      console.warn('Twitch WebSocket:', error);
    };

    ws.onclose = () => {
      if (generation !== socketGeneration) return;

      chatConnected = false;
      updateTwitchStatus();
      scheduleReconnect();
    };
  }

  function startEventSub() {
    if (!isAuthenticated()) return;

    stopEventSub();

    openEventSub('wss://eventsub.wss.twitch.tv/ws');
  }

  // ==========================================
  // EINSTELLUNGEN & BACKUP
  // ==========================================

  function applySettingsToUI() {
    [
      'studioUsername',
      'studioDisplayName',
      'testUser',
      'testMessage',
      'alertUser',
      'chatInput',
      'volume',
      'rate',
      'duration',
      'accent'
    ].forEach(id => {
      if (id in settings) value(id, settings[id]);
    });

    [
      'ttsEnabled',
      'readNames',
      'followEnabled',
      'subEnabled',
      'bitsEnabled',
      'motion'
    ].forEach(id => {
      checked(id, settings[id]);
    });

    const fields = {
      ov_chatEnabled: 'chatEnabled',
      ov_alertsEnabled: 'alertsEnabled',
      ov_chatX: 'chatX',
      ov_chatY: 'chatY',
      ov_alertX: 'alertX',
      ov_alertY: 'alertY',
      ov_chatLife: 'chatLife',
      ov_alertDuration: 'alertDuration'
    };

    Object.entries(fields).forEach(([id, key]) => {
      const element = $(id);
      if (!element) return;

      if (element.type === 'checkbox') {
        element.checked = Boolean(overlaySettings[key]);
      } else {
        element.value = overlaySettings[key];
      }

      text(`${id}_value`, overlaySettings[key]);
    });

    text('studioProfileName', settings.studioDisplayName);
    text('durationValue', `${settings.duration} Sekunden`);

    applyTheme();
    updateTTSStatus();
    loadVoices();
  }

  function exportSettings() {
    const backup = {
      application: 'JC Neon Studio',
      version: '2.2.0',
      exportedAt: new Date().toISOString(),
      settings,
      overlaySettings
    };

    const blob = new Blob(
      [JSON.stringify(backup, null, 2)],
      { type: 'application/json' }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = 'jc-neon-studio-backup.json';
    link.click();

    setTimeout(() => URL.revokeObjectURL(url), 1000);

    toast('Backup erstellt.');
  }

  async function importSettings(file) {
    if (!file) return;

    try {
      const data = JSON.parse(await file.text());

      if (!data.settings || typeof data.settings !== 'object') {
        throw new Error('Ungültige Backup-Datei');
      }

      settings = {
        ...DEFAULTS,
        ...data.settings
      };

      overlaySettings = {
        ...OVERLAY_DEFAULTS,
        ...(data.overlaySettings || {})
      };

      saveSettings();
      applySettingsToUI();
      syncOverlaySettings();

      toast('Einstellungen erfolgreich importiert.');
    } catch (error) {
      toast(`Import fehlgeschlagen: ${error.message}`);
    }
  }

  function resetSettings() {
    if (!confirm('Studio-Einstellungen wirklich zurücksetzen?')) {
      return;
    }

    settings = { ...DEFAULTS };
    overlaySettings = { ...OVERLAY_DEFAULTS };

    saveSettings();
    applySettingsToUI();
    syncOverlaySettings();

    toast('Einstellungen zurückgesetzt.');
  }

  function initSettings() {
    bind('accent', 'change', event => {
      settings.accent = event.target.value;
      saveSettings();
      applyTheme();
      syncOverlaySettings();
    });

    bind('motion', 'change', event => {
      settings.motion = event.target.checked;
      saveSettings();
      applyTheme();
      syncOverlaySettings();
    });

    bind('studioUsername', 'change', event => {
      settings.studioUsername = event.target.value;
      saveSettings();
    });

    bind('studioDisplayName', 'input', event => {
      settings.studioDisplayName = event.target.value;
      text('studioProfileName', settings.studioDisplayName);
      saveSettings();
    });

    bind('exportSettings', 'click', exportSettings);

    bind('importSettings', 'click', () => {
      $('importSettingsFile')?.click();
    });

    bind('importSettingsFile', 'change', event => {
      importSettings(event.target.files?.[0]);
      event.target.value = '';
    });

    bind('resetSettings', 'click', resetSettings);

    bind('twitchInfo', 'click', () => {
      toast(
        'Twitch nutzt OAuth PKCE. Nach der Anmeldung startet der EventSub-Live-Chat.',
        6000
      );
    });
  }

  // ==========================================
  // TWITCH INITIALISIEREN
  // ==========================================

  async function initTwitch() {
    bind('twitchBtn', 'click', async () => {
      if (isAuthenticated()) {
        await disconnectTwitch();
      } else {
        await connectTwitch();
      }
    });

    updateTwitchStatus();

    const params = new URLSearchParams(location.search);

    let connected = false;

    if (params.has('code') || params.has('error')) {
      connected = await handleOAuthCallback();
    } else {
      connected = await restoreTwitch();
    }

    if (connected) {
      startEventSub();
    }

    clearInterval(tokenTimer);

    tokenTimer = setInterval(async () => {
      if (!auth?.accessToken) return;

      let valid = await validateToken();

      if (!valid) {
        valid = await refreshToken();
      }

      if (!valid) {
        stopEventSub();
        saveAuth(null);
        twitchUser = null;
        updateTwitchStatus();

        toast('Twitch-Sitzung abgelaufen. Bitte erneut anmelden.');
      }
    }, 10 * 60 * 1000);
  }

  // ==========================================
  // VOLLSTÄNDIGER START
  // ==========================================

  function init() {
    console.log('JC Neon Studio wird gestartet ...');

    applySettingsToUI();

    initNavigation();
    initTTS();
    initChat();
    initAlerts();
    initOverlays();
    initSettings();

    bind('chatInput', 'input', event => {
      settings.chatInput = event.target.value;
      saveSettings();
    });

    // Browser-Audio wird durch Benutzerinteraktion freigegeben.
    document.addEventListener(
      'pointerdown',
      unlockSounds,
      { once: true }
    );

    showPage('dashboard');

    // Twitch-Fehler dürfen die übrige Oberfläche
    // nicht blockieren.
    initTwitch().catch(error => {
      console.error('Twitch-Initialisierung:', error);
      toast('Twitch konnte nicht initialisiert werden.');
    });

    console.log('JC Neon Studio: Oberfläche initialisiert.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, {
      once: true
    });
  } else {
    init();
  }

})();

/* ==========================================
   JC NEON STUDIO – DESIGN CONTROLLER
   ========================================== */

(() => {
  "use strict";

  const THEME_KEY = "jc_neon_theme";
  const MOTION_KEY = "jc_neon_motion";

  const themes = {
    purple: {
      accent: "#a855f7",
      accent2: "#7c3aed",
      glow: "168, 85, 247"
    },
    cyan: {
      accent: "#00d9e9",
      accent2: "#0891b2",
      glow: "0, 217, 233"
    },
    pink: {
      accent: "#ff3baf",
      accent2: "#db2777",
      glow: "255, 59, 175"
    }
  };

  function applyTheme(name) {
    const selected = themes[name] ? name : "purple";
    const theme = themes[selected];

    document.documentElement.style.setProperty(
      "--accent",
      theme.accent
    );

    document.documentElement.style.setProperty(
      "--accent2",
      theme.accent2
    );

    document.documentElement.style.setProperty(
      "--jc-glow-rgb",
      theme.glow
    );

    document.documentElement.dataset.theme = selected;

    localStorage.setItem(THEME_KEY, selected);
  }

  function applyMotion(enabled) {
    document.body.classList.toggle(
      "no-motion",
      !enabled
    );

    document.body.classList.toggle(
      "reduce-motion",
      !enabled
    );

    localStorage.setItem(
      MOTION_KEY,
      String(enabled)
    );
  }

  function initializeDesign() {
    const accentSelect = document.getElementById("accent");
    const motionCheckbox = document.getElementById("motion");

    const savedTheme =
      localStorage.getItem(THEME_KEY) ||
      accentSelect?.value ||
      "purple";

    const savedMotion =
      localStorage.getItem(MOTION_KEY);

    const motionEnabled =
      savedMotion === null
        ? (motionCheckbox?.checked ?? true)
        : savedMotion === "true";

    applyTheme(savedTheme);
    applyMotion(motionEnabled);

    if (accentSelect) {
      accentSelect.value = themes[savedTheme]
        ? savedTheme
        : "purple";

      accentSelect.addEventListener("change", () => {
        applyTheme(accentSelect.value);
      });
    }

    if (motionCheckbox) {
      motionCheckbox.checked = motionEnabled;

      motionCheckbox.addEventListener("change", () => {
        applyMotion(motionCheckbox.checked);
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initializeDesign,
      { once: true }
    );
  } else {
    initializeDesign();
  }
})();
