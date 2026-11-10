
/*
 * JC NEON STUDIO
 * TWITCH AUTH – REPARIERTE VERSION
 * Jade & Clarke
 *
 * Browserbasierte Twitch-Anmeldung
 * OAuth Implicit Flow
 * Kein Client Secret erforderlich
 */

(() => {
  "use strict";

  const CLIENT_ID = "g7xx1g876eqvm2r3ly4qcwpxyg42lv";

  const AUTH_KEY = "jc_neon_twitch_auth";
  const STATE_KEY = "jc_neon_oauth_state";

  const SCOPES = [
    "user:read:chat",
    "user:bot",
    "moderator:read:followers",
    "channel:read:subscriptions",
    "bits:read"
  ];

  let currentAuth = null;
  let currentUser = null;
  let busy = false;

  // ==========================================
  // HILFSFUNKTIONEN
  // ==========================================

  function getRedirectURI() {
    return (
      window.location.origin +
      window.location.pathname
    );
  }

  function randomState() {
    const bytes = new Uint8Array(32);

    crypto.getRandomValues(bytes);

    return Array.from(bytes, byte =>
      byte.toString(16).padStart(2, "0")
    ).join("");
  }

  function readAuth() {
    try {
      return JSON.parse(
        localStorage.getItem(AUTH_KEY) || "null"
      );
    } catch {
      return null;
    }
  }

  function saveAuth(auth) {
    currentAuth = auth;

    localStorage.setItem(
      AUTH_KEY,
      JSON.stringify(auth)
    );
  }

  function clearAuth() {
    currentAuth = null;
    currentUser = null;

    localStorage.removeItem(AUTH_KEY);
    sessionStorage.removeItem(STATE_KEY);
  }

  function notify(message) {
    console.log("[JC Twitch]", message);

    let element = document.getElementById(
      "jcTwitchNotice"
    );

    if (!element) {
      element = document.createElement("div");
      element.id = "jcTwitchNotice";

      Object.assign(element.style, {
        position: "fixed",
        bottom: "24px",
        right: "24px",
        zIndex: "99999",
        padding: "15px 20px",
        maxWidth: "420px",
        borderRadius: "14px",
        color: "#ffffff",
        background: "#241136",
        border: "1px solid #a855f7",
        boxShadow: "0 0 25px #a855f744",
        fontFamily: "Arial, sans-serif"
      });

      document.body.appendChild(element);
    }

    element.textContent = message;

    clearTimeout(notify.timer);

    notify.timer = setTimeout(() => {
      element.remove();
    }, 6500);
  }

  function setText(id, value) {
    const element = document.getElementById(id);

    if (element) {
      element.textContent = value;
    }
  }

  // ==========================================
  // STATUSANZEIGE
  // ==========================================

  function updateUI(connected, username = "") {
    const status = connected
      ? "ONLINE · VERBUNDEN"
      : "OFFLINE · NICHT VERBUNDEN";

    const detail = connected
      ? "Angemeldet als " + username
      : "Twitch-Verbindung ausstehend";

    setText("connectionStatus", status);
    setText("connectionStat", connected ? "ONLINE" : "OFFLINE");
    setText("connectionStatDetail", detail);

    setText(
      "sideConnectionStatus",
      connected ? "Verbunden" : "Nicht verbunden"
    );

    setText("sideConnectionDetail", detail);

    setText(
      "settingsConnectionStatus",
      connected ? "Verbunden" : "Nicht verbunden"
    );

    setText("settingsConnectionDetail", detail);

    setText("twitchUsername", username);
    setText("connectedUser", username);

    const pill = document.getElementById("connectionPill");

    if (pill) {
      pill.classList.toggle("online", connected);
      pill.classList.toggle("offline", !connected);
    }

    const button = document.getElementById("twitchBtn");

    if (button) {
      button.textContent = connected
        ? "Twitch trennen"
        : "Twitch verbinden ↗";
    }

    const dots = [
      "sideConnectionDot",
      "settingsConnectionDot",
      "profileConnectionDot"
    ];

    dots.forEach(id => {
      const element = document.getElementById(id);

      if (element) {
        element.style.color = connected
          ? "#4ade80"
          : "#fbbf24";
      }
    });
  }

  // ==========================================
  // TWITCH LOGIN
  // ==========================================

  function connect() {
    if (!window.crypto?.getRandomValues) {
      notify("Bitte über HTTPS oder Go Live öffnen.");
      return;
    }

    const state = randomState();

    sessionStorage.setItem(STATE_KEY, state);

    const params = new URLSearchParams({
      response_type: "token",
      client_id: CLIENT_ID,
      redirect_uri: getRedirectURI(),
      scope: SCOPES.join(" "),
      state,
      force_verify: "true"
    });

    window.location.assign(
      "https://id.twitch.tv/oauth2/authorize?" +
      params.toString()
    );
  }

  // ==========================================
  // OAUTH CALLBACK
  // ==========================================

  function handleCallback() {
    const hash = new URLSearchParams(
      window.location.hash.substring(1)
    );

    const query = new URLSearchParams(
      window.location.search
    );

    const error =
      hash.get("error") ||
      query.get("error");

    if (error) {
      const description =
        hash.get("error_description") ||
        query.get("error_description") ||
        error;

      history.replaceState(
        {},
        document.title,
        getRedirectURI()
      );

      notify(
        "Twitch-Anmeldung fehlgeschlagen: " +
        description
      );

      return false;
    }

    const token = hash.get("access_token");

    if (!token) {
      return false;
    }

    const expectedState =
      sessionStorage.getItem(STATE_KEY);

    const returnedState = hash.get("state");

    history.replaceState(
      {},
      document.title,
      getRedirectURI()
    );

    if (
      !expectedState ||
      expectedState !== returnedState
    ) {
      notify(
        "Twitch-Sicherheitsprüfung fehlgeschlagen."
      );

      return false;
    }

    sessionStorage.removeItem(STATE_KEY);

    const expiresIn = Number(
      hash.get("expires_in") || 0
    );

    if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
      notify("Twitch hat keine gültige Ablaufzeit geliefert.");
      return false;
    }

    saveAuth({
      accessToken: token,
      refreshToken: null,
      expiresAt: Date.now() + expiresIn * 1000
    });

    return true;
  }

  // ==========================================
  // TOKEN ÜBERPRÜFEN
  // ==========================================

  async function validateToken(auth) {
    if (
      !auth?.accessToken ||
      !auth?.expiresAt ||
      auth.expiresAt <= Date.now()
    ) {
      return null;
    }

    const response = await fetch(
      "https://id.twitch.tv/oauth2/validate",
      {
        headers: {
          Authorization: "OAuth " + auth.accessToken
        }
      }
    );

    if (response.status === 401) {
      return null;
    }

    if (!response.ok) {
      throw new Error(
        "Twitch-Validierung fehlgeschlagen: " +
        response.status
      );
    }

    const data = await response.json();

    if (data.client_id !== CLIENT_ID) {
      return null;
    }

    return data;
  }

  async function loadUser(token) {
    const response = await fetch(
      "https://api.twitch.tv/helix/users",
      {
        headers: {
          Authorization: "Bearer " + token,
          "Client-Id": CLIENT_ID
        }
      }
    );

    if (!response.ok) {
      throw new Error(
        "Twitch-Benutzer konnte nicht geladen werden."
      );
    }

    const data = await response.json();

    return data.data?.[0] || null;
  }

  // ==========================================
  // ANMELDUNG WIEDERHERSTELLEN
  // ==========================================

  async function restoreSession() {
    const auth = readAuth();

    if (!auth?.accessToken) {
      updateUI(false);
      return;
    }

    try {
      const validation = await validateToken(auth);

      if (!validation) {
        clearAuth();
        updateUI(false);
        return;
      }

      const user = await loadUser(auth.accessToken);

      if (!user) {
        clearAuth();
        updateUI(false);
        return;
      }

      currentAuth = auth;
      currentUser = user;

      updateUI(
        true,
        user.display_name || user.login
      );

      window.dispatchEvent(
        new CustomEvent("jc:twitch-connected", {
          detail: {
            userId: user.id,
            username: user.login,
            displayName: user.display_name,
            scopes: validation.scopes || []
          }
        })
      );

      notify(
        "Mit Twitch verbunden: " +
        (user.display_name || user.login)
      );

    } catch (error) {
      console.error("[JC Twitch]", error);

      // Netzwerkfehler bedeuten nicht automatisch,
      // dass das Token ungültig geworden ist.
      updateUI(false);

      notify(
        "Twitch konnte nicht überprüft werden. " +
        "Bitte Verbindung prüfen."
      );
    }
  }

  // ==========================================
  // VERBINDUNG TRENNEN
  // ==========================================

  async function disconnect() {
    const auth = readAuth();

    clearAuth();
    updateUI(false);

    window.dispatchEvent(
      new CustomEvent("jc:twitch-disconnected")
    );

    if (auth?.accessToken) {
      try {
        await fetch(
          "https://id.twitch.tv/oauth2/revoke",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/x-www-form-urlencoded"
            },
            body: new URLSearchParams({
              client_id: CLIENT_ID,
              token: auth.accessToken
            })
          }
        );
      } catch (error) {
        console.warn(
          "[JC Twitch] Token-Widerruf nicht bestätigt.",
          error
        );
      }
    }

    notify("Twitch-Verbindung getrennt.");
  }

  // ==========================================
  // BUTTON INSTALLIEREN
  // ==========================================

  function installButton() {
    const button = document.getElementById("twitchBtn");

    if (!button) {
      console.warn(
        "[JC Twitch] twitchBtn nicht gefunden."
      );
      return;
    }

    button.addEventListener(
      "click",
      event => {
        event.preventDefault();
        event.stopImmediatePropagation();

        if (busy) return;

        if (currentUser) {
          busy = true;

          disconnect().finally(() => {
            busy = false;
          });

          return;
        }

        connect();
      },
      true
    );
  }

  // ==========================================
  // INITIALISIERUNG
  // ==========================================

  async function initialize() {
    const callbackReceived = handleCallback();

    installButton();

    await restoreSession();

    if (callbackReceived && currentUser) {
      console.log(
        "[JC Twitch] Anmeldung erfolgreich abgeschlossen."
      );
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initialize,
      { once: true }
    );
  } else {
    initialize();
  }

  // Öffentliche Statusabfrage für andere Module.
  // Das Zugriffstoken wird nicht öffentlich ausgegeben.
  window.JCTwitchAuth = {
    isConnected() {
      return Boolean(currentUser && currentAuth);
    },

    getUser() {
      if (!currentUser) return null;

      return {
        id: currentUser.id,
        login: currentUser.login,
        displayName: currentUser.display_name
      };
    },

    connect,
    disconnect
  };

})();
