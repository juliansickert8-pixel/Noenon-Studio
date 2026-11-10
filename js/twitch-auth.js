
/*
 * JC NEON STUDIO
 * TWITCH AUTH REPAIR
 * Jade & Clarke
 *
 * Eigenständige Twitch-Anmeldung
 * Ohne Client Secret
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

  function getRedirectURI() {
    // Die exakte Adresse der geöffneten index.html
    return window.location.origin +
      window.location.pathname;
  }

  function randomState() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);

    return Array.from(bytes, byte =>
      byte.toString(16).padStart(2, "0")
    ).join("");
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
        color: "#fff",
        background: "#241136",
        border: "1px solid #a855f7",
        boxShadow: "0 0 25px #a855f744",
        fontFamily: "Arial, sans-serif"
      });

      document.body.appendChild(element);
    }

    element.textContent = message;

    setTimeout(() => {
      element.remove();
    }, 6500);
  }

  function connect() {
    if (!window.crypto?.getRandomValues) {
      notify("Bitte über Go Live oder HTTPS öffnen.");
      return;
    }

    const state = randomState();

    sessionStorage.setItem(STATE_KEY, state);

    const params = new URLSearchParams({
      response_type: "token",
      client_id: CLIENT_ID,
      redirect_uri: getRedirectURI(),
      scope: SCOPES.join(" "),
      state: state,
      force_verify: "true"
    });

    window.location.assign(
      "https://id.twitch.tv/oauth2/authorize?" +
      params.toString()
    );
  }

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

      notify("Twitch-Anmeldung fehlgeschlagen: " + description);
      return;
    }

    const token = hash.get("access_token");

    if (!token) return;

    const expectedState =
      sessionStorage.getItem(STATE_KEY);

    const returnedState = hash.get("state");

    // Keine Anmeldung ohne korrekten State akzeptieren.
    if (
      !expectedState ||
      expectedState !== returnedState
    ) {
      history.replaceState(
        {},
        document.title,
        getRedirectURI()
      );

      notify("Twitch-Sicherheitsprüfung fehlgeschlagen.");
      return;
    }

    sessionStorage.removeItem(STATE_KEY);

    const expiresIn = Number(
      hash.get("expires_in") || 0
    );

    const auth = {
      accessToken: token,
      refreshToken: null,
      expiresAt: Date.now() +
        Math.max(0, expiresIn) * 1000
    };

    localStorage.setItem(
      AUTH_KEY,
      JSON.stringify(auth)
    );

    // Token aus der Browseradresse entfernen.
    history.replaceState(
      {},
      document.title,
      getRedirectURI()
    );

    // Studio neu laden, damit app.js die
    // gespeicherte Twitch-Sitzung übernimmt.
    window.location.replace(getRedirectURI());
  }

  function installButton() {
    const button = document.getElementById("twitchBtn");

    if (!button) {
      console.warn(
        "[JC Twitch] Button twitchBtn nicht gefunden."
      );
      return;
    }

    /*
     * Capture-Listener:
     * Überschreibt nur den alten Login-Klick,
     * ohne Navigation, TTS oder Alerts zu verändern.
     */
    button.addEventListener(
      "click",
      event => {
        const auth = JSON.parse(
          localStorage.getItem(AUTH_KEY) || "null"
        );

        // Bereits angemeldet:
        // Den bisherigen Trennen-Button
        // der app.js weiterarbeiten lassen.
        if (auth?.accessToken) {
          return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();

        connect();
      },
      true
    );
  }

  // OAuth-Rückmeldung möglichst früh verarbeiten.
  handleCallback();

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      installButton,
      { once: true }
    );
  } else {
    installButton();
  }

})();
