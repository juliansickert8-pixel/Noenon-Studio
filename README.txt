JC STREAMTOOLS – NEON BROWSER EDITION
====================================

ÖFFNEN
1. ZIP entpacken.
2. index.html doppelklicken.
3. Im Browser Chat-TTS und Alerts testen.

WICHTIG
- Kein .bat, keine Desktop-App und keine Node.js-Installation erforderlich.
- Dies ist ein hochwertiger, lokal nutzbarer Browser-Prototyp.
- Twitch-Login und echte Twitch-Live-Events sind NOCH NICHT implementiert.
- Die OBS-Overlay-Dateien sind enthalten, ihre Live-Synchronisierung mit dem
  Dashboard benötigt eine gemeinsame HTTP-Origin. Bei direktem Öffnen per
  file:// kann BroadcastChannel je nach Browser nicht funktionieren.
- Die TTS-Ausgabe erfolgt im geöffneten Browser-Tab. OBS nimmt diese nicht
  automatisch auf.
- Für eine sichere produktive Twitch-Anbindung braucht die Website eine
  OAuth-/EventSub-Architektur (z. B. gehosteter Backend-Service).

DATEIEN
index.html             Haupt-Dashboard
style.css              Neon-Design
app.js                 UI, Einstellungen, TTS, Test-Alerts
overlay-chat.html       Transparente Chat-OBS-Quelle
overlay-alerts.html     Transparente Alert-OBS-Quelle
assets/                Originalbilder des Nutzers

Jade & Clarke | 2026
