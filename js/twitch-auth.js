
/*
 * JC NEON STUDIO
 * Twitch Authentication
 * Jade & Clarke
 *
 * OAuth Implicit Flow
 * Token-Validierung und Status-Synchronisierung
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

  function redirectURI() {
    return location.origin + location.pathname;
  }

  function randomState() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);

    return Array.from(bytes, b =>
      b.toString(16).padStart(2, "0")
    ).join("");
  }

  function notify(message) {
    console.log("[JC Twitch]", message);

    let box = document.getElementById("jcTwitchNotice");

    if (!box) {
      box = document.createElement("div");
      box.id = "jcTwitchNotice";

      Object.assign(box.style, {
        position: "fixed",
        bottom: "24px",
        right: "24px",
        zIndex: "99999",
        padding: "15px 20px",
        maxWidth: "420px",
        borderRadius: "14px",
        background: "#241136",
        color: "#ffffff",
        border: "1px solid #a855f7",
        boxShadow: "0 0 25px #a855f744",
        fontFamily: "Arial, sans-serif"
      });

      document.body.appendChild(box);
    }

    box.textContent = message;

    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => box.remove(), 6500);
  }

  function readAuth() {
    try {
      return JSON.parse(localStorage.getItem(AUTH_KEY) || "null");
    } catch {
      return null;
    }
  }

  function saveAuth(auth) {
    currentAuth = auth;
    localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
  }

  function clearAuth() {
    currentAuth = null;
    currentUser = null;
    localStorage.removeItem(AUTH_KEY);
    sessionStorage.removeItem(STATE_KEY);
  }

  function setText(id, text) {
    const element = document.getElementById(id);
    if (element) element.textContent = text;
  }

  function updateUI(connected, username = "") {
    const name = username || "Twitch";
    const detail = connected
      ? "Angemeldet als " + name
      : "Twitch-Verbindung ausstehend";

    setText(
      "connectionStatus",
      connected ? "ONLINE · VERBUNDEN" : "OFFLINE · NICHT VERBUNDEN"
    );

    setText("connectionStat", connected ? "ONLINE" : "OFFLINE");
    setText("connectionStatDetail", detail);
    setText("sideConnectionStatus", connected ? "Verbunden" : "Nicht verbunden");
    setText("sideConnectionDetail", detail);
    setText("settingsConnectionStatus", connected ? "Verbunden" : "Nicht verbunden");
    setText("settingsConnectionDetail", detail);
    setText("twitchUsername", connected ? name : "");
    setText("connectedUser", connected ? name : "");
    setText("twitchInfo", detail);

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

    window.dispatchEvent(
      new CustomEvent("jc:twitch-status", {
        detail: {
          connected,
          username: connected ? name : ""
        }
      })
    );
  }

  function connect() {
    if (!crypto?.getRandomValues) {
      notify("Bitte über HTTPS oder VS Code Go Live öffnen.");
      return;
    }

    const state = randomState();
    sessionStorage.setItem(STATE_KEY, state);

    const params = new URLSearchParams({
      response_type: "token",
      client_id: CLIENT_ID,
      redirect_uri: redirectURI(),
      scope: SCOPES.join(" "),
      state,
      force_verify: "true"
    });

    location.assign(
      "https://id.twitch.tv/oauth2/authorize?" +
      params.toString()
    );
  }

  function handleCallback() {
    const hash = new URLSearchParams(
      location.hash.startsWith("#")
        ? location.hash.slice(1)
        : location.hash
    );

    const query = new URLSearchParams(location.search);

    const error = hash.get("error") || query.get("error");

    if (error) {
      const description =
        hash.get("error_description") ||
        query.get("error_description") ||
        error;

      history.replaceState(null, "", redirectURI());
      sessionStorage.removeItem(STATE_KEY);

      notify("Twitch-Anmeldung fehlgeschlagen: " + description);
      return false;
    }

    const token = hash.get("access_token");

    if (!token) return false;

    const expectedState = sessionStorage.getItem(STATE_KEY);
    const returnedState = hash.get("state");

    // Token sofort aus der Browseradresse entfernen.
    history.replaceState(null, "", redirectURI());

    if (!expectedState || expectedState !== returnedState) {
      notify("Twitch-Sicherheitsprüfung fehlgeschlagen.");
      return false;
    }

    sessionStorage.removeItem(STATE_KEY);

    const rawExpires = hash.get("expires_in");
    const expiresIn = Number(rawExpires);

    // Eine fehlende Ablaufzeit wird nicht erfunden.
    // Stattdessen ermittelt die Token-Validierung
    // die tatsächliche Restlaufzeit bei Twitch.
    const auth = {
      accessToken: token,
      refreshToken: null,
      expiresAt:
        rawExpires !== null &&
        Number.isFinite(expiresIn) &&
        expiresIn > 0
          ? Date.now() + expiresIn * 1000
          : null
    };

    saveAuth(auth);
    return true;
  }

  async function validateToken(auth) {
    if (!auth?.accessToken) return null;

    const response = await fetch(
      "https://id.twitch.tv/oauth2/validate",
      {
        method: "GET",
        headers: {
          Authorization: "OAuth " + auth.accessToken
        },
        cache: "no-store"
      }
    );

    if (response.status === 401) return null;

    if (!response.ok) {
      throw new Error(
        "Tokenprüfung fehlgeschlagen (HTTP " +
        response.status + ")"
      );
    }

    const data = await response.json();

    if (data.client_id !== CLIENT_ID) {
      return null;
    }

    const expiresIn = Number(data.expires_in);

    if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
      return null;
    }

    auth.expiresAt = Date.now() + expiresIn * 1000;
    saveAuth(auth);

    return data;
  }

  async function loadUser(token) {
    const response = await fetch(
      "https://api.twitch.tv/helix/users",
      {
        headers: {
          Authorization: "Bearer " + token,
          "Client-Id": CLIENT_ID
        },
        cache: "no-store"
      }
    );

    if (!response.ok) {
      throw new Error(
        "Benutzerabfrage fehlgeschlagen (HTTP " +
        response.status + ")"
      );
    }

    const json = await response.json();
    return json.data?.[0] || null;
  }

  async function restoreSession() {
    const auth = readAuth();

    if (!auth?.accessToken) {
      updateUI(false);
      return false;
    }

    try {
      const validation = await validateToken(auth);

      if (!validation) {
        clearAuth();
        updateUI(false);
        notify("Twitch-Anmeldung abgelaufen. Bitte erneut verbinden.");
        return false;
      }

      const user = await loadUser(auth.accessToken);

      if (!user) {
        updateUI(false);
        notify("Twitch-Benutzer konnte nicht ermittelt werden.");
        return false;
      }

      currentAuth = auth;
      currentUser = user;

      updateUI(true, user.display_name || user.login);

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

      return true;

    } catch (error) {
      console.error("[JC Twitch]", error);
      updateUI(false);
      notify("Twitch-Verbindung konnte nicht überprüft werden.");
      return false;
    }
  }

  async function disconnect() {
    const auth = readAuth();

    clearAuth();
    updateUI(false);

    window.dispatchEvent(
      new CustomEvent("jc:twitch-disconnected")
    );

    if (auth?.accessToken) {
      try {
        const response = await fetch(
          "https://id.twitch.tv/oauth2/revoke",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded"
            },
            body: new URLSearchParams({
              client_id: CLIENT_ID,
              token: auth.accessToken
            })
          }
        );

        if (!response.ok) {
          console.warn("[JC Twitch] Token-Widerruf:", response.status);
        }
      } catch (error) {
        console.warn("[JC Twitch] Widerruf fehlgeschlagen:", error);
      }
    }

    notify("Twitch-Verbindung getrennt.");
  }

  function installButton() {
    const button = document.getElementById("twitchBtn");

    if (!button) {
      console.warn("[JC Twitch] twitchBtn nicht gefunden.");
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
        } else {
          connect();
        }
      },
      true
    );
  }

  async function initialize() {
    const callbackReceived = handleCallback();

    installButton();

    const connected = await restoreSession();

    if (callbackReceived && connected) {
      notify(
        "Erfolgreich mit Twitch verbunden: " +
        (currentUser.display_name || currentUser.login)
      );
    }
  }

  window.JCTwitchAuth = {
    isConnected() {
      return Boolean(currentAuth && currentUser);
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

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initialize,
      { once: true }
    );
  } else {
    initialize();
  }
})();
