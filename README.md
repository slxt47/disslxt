# disslxt

Eine schlanke Chat-Plattform für Communities: Nutzer registrieren sich, treten Servern (Guilds)
per Invite-Link bei und chatten in Textkanälen in Echtzeit (WebSocket).

Erfüllte Erfolgskriterien (jeweils per Playwright-E2E-Test abgesichert):

1. Zwei Nutzer chatten in zwei Fenstern in Echtzeit (`e2e/tests/realtime-chat.spec.ts`).
2. Ein neuer Nutzer tritt über einen Invite-Link bei (`e2e/tests/invite-join.spec.ts`).
3. Der Verlauf bleibt nach einem Reload erhalten (`e2e/tests/history-reload.spec.ts`).

## Aufbau

pnpm-Monorepo:

| Paket                             | Inhalt                                                                   |
| --------------------------------- | ------------------------------------------------------------------------ |
| `shared/` (`@disslxt/shared`)     | zod-Schemas, DTO-Typen, WS-Protokoll, Konstanten (TS-Source, kein Build) |
| `backend/` (`@disslxt/backend`)   | Fastify 5 + `@fastify/websocket`, Drizzle ORM (PostgreSQL), argon2id     |
| `frontend/` (`@disslxt/frontend`) | Vite + React 18, react-router, zustand, plain CSS (responsiv)            |
| `e2e/` (`@disslxt/e2e`)           | Playwright-Specs (Chromium, zwei Browser-Kontexte)                       |

## Voraussetzungen

- Node.js 22, pnpm 10
- PostgreSQL 16 (lokal) **oder** Docker
- Docker Compose (für das Deployment)

## Lokale Entwicklung

```bash
bash scripts/setup-local-db.sh   # als root: legt Rolle chat/chat + DBs disslxt_dev/_test/_e2e an
cp .env.example .env
pnpm install
pnpm db:migrate                  # wendet die SQL-Migrationen an (passiert auch beim Backend-Start)
pnpm dev                         # Backend :3000, Frontend :5173
```

Dann <http://localhost:5173> öffnen: registrieren, „Server erstellen“, Einladungslink aus der
Seitenleiste in einem zweiten Browser(-Profil) öffnen und losschreiben. Vite leitet `/api` und
`/ws` an das Backend weiter.

**Bedienung:** Enter sendet, Shift+Enter fügt einen Zeilenumbruch ein. Eigene Nachrichten lassen
sich per Hover (auf Touch-Geräten immer sichtbar) bearbeiten (Enter speichert, Esc bricht ab) und
löschen (Bestätigung inline). „Ältere laden“ lädt den Verlauf seitenweise (50). Bei
Verbindungsverlust erscheint ein Banner, der Client verbindet sich mit Backoff neu und lädt
Verpasstes nach. Unter 768 px Breite sind Server- und Kanalliste ein Drawer (☰).

Alternativ zur lokalen PostgreSQL: `docker compose -f docker-compose.dev.yml up -d` (Port 5433) und
`DATABASE_URL` entsprechend anpassen.

## Tests & Qualität

```bash
pnpm lint && pnpm format:check && pnpm typecheck
pnpm test                               # shared + backend + frontend (vitest)
pnpm --filter @disslxt/backend test    # nur Backend (nutzt TEST_DATABASE_URL, Default disslxt_test)
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm e2e   # Playwright (E2E_DATABASE_URL, Default disslxt_e2e)
```

- **Backend** (vitest): läuft gegen eine echte PostgreSQL-Datenbank (`disslxt_test`), die vor
  jedem Test geleert wird; deckt Auth, Guilds, Channels, Messages, Autorisierung, Realtime
  (inkl. p95-Latenz < 300 ms und 100 gleichzeitigen WS-Clients), Rate-Limits und Security ab.
- **Frontend** (vitest + jsdom + Testing Library): Composer, MessageItem, MessageList
  (Auto-Scroll, „Ältere laden“), Backoff, Store-Reducer, Realtime-Client.
- **E2E** (Playwright, Chromium): startet ein eigenes Backend (gegen `disslxt_e2e`, gelockerte
  Rate-Limits) auf Port **3100** und einen eigenen Vite-Dev-Server auf Port **5174** (mit Proxy
  auf Port 3100) und leert die E2E-Datenbank vorab. Laufende Server werden nie wiederverwendet
  (`reuseExistingServer: false`); ein parallel laufendes `pnpm dev` (3000/5173) stört also nicht,
  belegte E2E-Ports lassen den Lauf dagegen sofort scheitern. Specs: `realtime-chat`,
  `invite-join`, `history-reload`, `auth`, `composer`, `reconnect`, `presence`, `mobile`,
  `missed-messages`.
  `@playwright/test` ist auf 1.56 gepinnt (Chromium 1194); vorhandene Browser über
  `PLAYWRIGHT_BROWSERS_PATH` nutzen, sonst einmalig `pnpm --filter @disslxt/e2e exec playwright
install chromium`.

## Deployment (Docker Compose hinter Cloudflare Tunnel)

Die App ist nie direkt aus dem Internet erreichbar: Caddy lauscht nur auf `127.0.0.1:8091` (HTTP),
HTTPS übernimmt ein Cloudflare Tunnel. `cloudflared` läuft als Systemdienst auf dem Host; im
Cloudflare-Dashboard ist für `disslxt.slxt.org` als Service-URL `http://localhost:8091`
eingetragen (**http**, nicht https – TLS endet bei Cloudflare). WebSockets laufen ohne weitere
Einstellung durch den Tunnel.

```bash
cp .env.example .env          # POSTGRES_PASSWORD setzen, PUBLIC_URL prüfen
docker compose up --build -d
docker compose ps             # db, backend und caddy „healthy“
curl -s http://localhost:8091/api/health          # {"status":"ok"}  (lokal)
curl -s https://disslxt.slxt.org/api/health       # {"status":"ok"}  (über den Tunnel)
docker compose logs backend   # JSON-Request-Logs (pino)
docker compose down           # stoppen (Daten bleiben im Volume db_data)
```

| Service   | Image / Build                                                   | Ports                      |
| --------- | --------------------------------------------------------------- | -------------------------- |
| `db`      | `postgres:16-alpine`, Volume `db_data`, Healthcheck             | keiner (bewusst)           |
| `backend` | `backend/Dockerfile` (Build → `node:22-slim`, non-root)         | intern 3000                |
| `caddy`   | `deploy/caddy.Dockerfile` (Vite-Build → `caddy:2-alpine`) + CSP | `127.0.0.1:8091→80` (HTTP) |

Das Backend wendet die Migrationen beim Start an, läuft hinter Caddy mit `TRUST_PROXY=true` und
`COOKIE_SECURE=true` (der Browser sieht HTTPS). Caddy liefert das SPA aus (strikte CSP,
`frame-ancestors 'none'`) und leitet `/api/*` und `/ws` (WebSocket) an das Backend weiter.

**Client-IP (wichtig für Rate-Limits):** Alle Anfragen kommen per `cloudflared` vom Host. Caddy
übernimmt die echte Client-IP aus dem von Cloudflare ergänzten `X-Forwarded-For` (strikt von
rechts gelesen, vorgetäuschte Einträge davor zählen nicht) und reicht dem Backend genau diese eine
Adresse weiter. Ohne das würden alle Nutzer dasselbe Rate-Limit teilen.

Nach Änderungen an `.env`: `docker compose up -d --build`.

**Härtung der Container:** Backend und Caddy laufen mit schreibgeschütztem Dateisystem (nur `/tmp`
als tmpfs sowie die Volumes sind beschreibbar), ohne Linux-Capabilities (Caddy behält nur
`NET_BIND_SERVICE` für Port 80) und mit `no-new-privileges`; die Datenbanken mit
`no-new-privileges`. Braucht ein neues Feature weitere Schreibpfade, gehören sie in ein Volume oder
in `tmpfs`.

Optionaler E2E-Smoke-Test gegen den laufenden Stack über den Tunnel (nur lesend, legt keine Konten an):

```bash
E2E_BASE_URL=https://disslxt.slxt.org pnpm e2e:docker
```

## E-Mail und Registrierung mit Bestätigung

Neue Konten entstehen erst, wenn die E-Mail-Adresse bestätigt ist:

1. `POST /api/auth/register` speichert die Registrierung als **ausstehend** (Tabelle
   `pending_registrations`, Passwort nur als argon2id-Hash) und schickt einen Link
   `PUBLIC_URL/verify-email#token=…`. Antwort immer `202`, ohne Cookie.
2. Die Seite `/verify-email` nimmt das Token sofort aus der Adresszeile und löst es erst nach
   einem Klick ein (`POST /api/auth/verify-email`). Link-Scanner von Mailprogrammen können es
   so nicht verbrauchen. Erst jetzt wird das Konto angelegt; der Nutzer ist danach angemeldet und
   landet dort, wo er herkam (z. B. auf einer Einladung).
3. Login vor der Bestätigung → `403 EMAIL_NOT_VERIFIED` (nur mit richtigem Passwort; sonst
   dieselbe Antwort wie bei unbekannten Adressen). Die Oberfläche bietet „Erneut senden“ an
   (`POST /api/auth/resend-verification`).

**Schutz gegen Missbrauch**

- Links sind einmalig, laufen nach `EMAIL_VERIFICATION_TTL_HOURS` (24 h) ab, in der DB liegt nur
  der SHA-256-Hash. „Erneut senden“ macht den vorherigen Link ungültig.
- Keine Rückschlüsse, welche Adressen registriert sind: Registrierung und „Erneut senden“
  antworten immer gleich. Ist die Adresse schon vergeben, bekommt nur deren Inhaber eine Mail
  „Du hast schon ein Konto“.
- Keine Übernahme durch Vorab-Registrierung: Jeder Link gehört zu genau der Registrierung, die
  ihn ausgelöst hat (inklusive Passwort). Bestätigt der echte Inhaber seinen Link, verfallen alle
  anderen.
- Rate-Limits: pro IP `RATE_LIMIT_MAIL_MAX` pro `RATE_LIMIT_MAIL_WINDOW_MS` (5 / 15 min), pro
  Empfängeradresse `MAIL_MAX_PER_ADDRESS_PER_HOUR` (3 / h, Tabelle `mail_log`, nur
  Adress-Hashes). Darüber hinaus wird still nichts mehr verschickt.
- Der Versand läuft im Hintergrund mit 3 Versuchen; ein SMTP-Ausfall verzögert keine Antwort und
  verrät nichts über die Adresse. Beim Start prüft das Backend die SMTP-Verbindung und loggt
  `smtp connection ok` bzw. einen Fehler.
- Konten, die vor Einführung der Bestätigung existierten, gelten als bestätigt (Migration 0001).

**Versand über iCloud+ (Produktion)**

`slxt.org` ist bereits als eigene Domain in iCloud+ eingerichtet; die DNS-Einträge stimmen
(Stand 21.10.2026 geprüft):

| Eintrag | Wert                                                            |
| ------- | --------------------------------------------------------------- |
| MX      | `mx01.mail.icloud.com`, `mx02.mail.icloud.com`                  |
| SPF     | `v=spf1 a:my.slxt.org include:icloud.com ~all`                  |
| DKIM    | `sig1._domainkey` → `sig1.dkim.slxt.org.at.icloudmailadmin.com` |
| DMARC   | `v=DMARC1; p=reject; pct=100`                                   |

Apple signiert ausgehende Mails mit DKIM, SPF passt; damit besteht DMARC. Weil DMARC auf
`reject` steht, **muss `MAIL_FROM` eine Adresse sein, die in deinem iCloud-Konto existiert**
(z. B. eine neu angelegte `noreply@slxt.org` unter icloud.com → Einstellungen → Eigene
E-Mail-Domain), sonst weisen Empfänger die Mails ab. Optional für Berichte:
`rua=mailto:dmarc@slxt.org` im DMARC-Eintrag ergänzen.

Einrichtung:

1. App-spezifisches Passwort erzeugen: account.apple.com → Anmeldung und Sicherheit →
   App-spezifische Passwörter (setzt Zwei-Faktor-Authentifizierung voraus).
2. In `.env` (nie ins Repository):

   ```bash
   SMTP_USER=deine-apple-id@icloud.com   # die primäre iCloud-Adresse, auch bei eigener Domain
   SMTP_PASS=xxxx-xxxx-xxxx-xxxx          # das App-spezifische Passwort
   MAIL_FROM="disslxt <noreply@slxt.org>"
   ```

3. `docker compose up -d --build`, dann `docker compose logs backend | grep smtp`.

Grenzen von iCloud+: ca. 1.000 Empfänger pro Tag, kein Bounce-Webhook, Apple kann Konten bei
Massenversand sperren. Für mehr Volumen nur die `SMTP_*`-Variablen auf einen Versanddienst
umstellen; der Code bleibt gleich. Ein eigener Postfix ist nicht nötig (und mit `p=reject`
müsste er zusätzlich ins SPF und eigene DKIM-Schlüssel bekommen).

**Lokal:** `MAIL_TRANSPORT=log` hält Mails im Speicher; abrufbar unter
`GET /api/dev/mails` (existiert nur außerhalb von Produktion und nur mit diesem Transport).

## Mitteilungen (Web Push) und App-Installation

disslxt ist eine installierbare Web-App (PWA): Manifest, Icons (inkl. `apple-touch-icon` und
maskierbarem Icon) und ein handgeschriebener Service Worker (`frontend/public/sw.js`). Der
Service Worker cacht nur die App-Hülle und die gehashten Assets, nie `/api` oder `/ws`.

**Wann kommt eine Mitteilung?**

| Ereignis                               | Wer bekommt sie                | Stummgeschalteter Server |
| -------------------------------------- | ------------------------------ | ------------------------ |
| Neue Nachricht                         | alle Mitglieder außer Autor:in | nein                     |
| `@name`-Erwähnung                      | die erwähnte Person            | **ja**, kommt trotzdem   |
| Jemand tritt per Einladung bei         | Besitzer:in des Servers        | nein                     |
| Erste Person betritt einen Sprachkanal | alle anderen Mitglieder        | nein                     |

Wer einen Kanal gerade in einem **sichtbaren** Tab offen hat, bekommt dafür keine Mitteilung (der
Client meldet die Sichtbarkeit über die WebSocket). Mehrere Nachrichten eines Kanals ersetzen
sich auf dem Gerät (ein Eintrag pro Kanal). Abos, die der Push-Dienst als erloschen meldet
(404/410), werden gelöscht. Beim Abmelden wird das Abo des Geräts vom Konto getrennt.

**Einrichtung:**

1. Schlüssel erzeugen und in `.env` übernehmen: `pnpm vapid:generate >> .env`
   (optional `VAPID_SUBJECT=mailto:no-reply@deine-domain`). Ohne Schlüssel läuft die App, nur
   Mitteilungen sind aus. Neue Schlüssel machen alle bestehenden Abos ungültig.
2. `docker compose up -d --build`.
3. In der App: Zahnrad unten links → **Mitteilungen aktivieren**. Die Berechtigung wird
   ausschließlich nach diesem Klick abgefragt (Pflicht auf iOS, in Safari und Firefox).
   „Testmitteilung senden“ prüft die ganze Kette.

**HTTPS ist Pflicht.** Service Worker, Push, Mikrofon und Spracherkennung funktionieren nur in
einem sicheren Kontext (HTTPS oder `localhost`). In Produktion übernimmt das der Cloudflare
Tunnel; über `http://<server-ip>` würde nichts davon gehen.

**Sicherheit:** Der Server sendet nur an Endpunkte der bekannten Push-Dienste (Google FCM,
Mozilla, Apple, Microsoft) und nimmt keine beliebigen URLs an (kein SSRF). Inhalte sind per
Web-Push-Verschlüsselung (RFC 8291) Ende-zu-Ende verschlüsselt; der Push-Dienst sieht sie nicht.

**iPhone/iPad (iOS/iPadOS 16.4+):**

- Push gibt es **nur** für Web-Apps auf dem Home-Bildschirm, nicht in Safari selbst. Die App
  erkennt Safari auf iOS und zeigt einmalig einen Hinweis sowie in den Einstellungen eine
  3-Schritt-Anleitung: _Teilen → Zum Home-Bildschirm → von dort öffnen und Mitteilungen
  aktivieren_.
- Vom Home-Bildschirm gestartet läuft disslxt im Vollbild ohne Browserleiste, mit eigenem Icon,
  Safe-Area-Abständen (Notch, Home-Indicator) und Sheets statt Popups.
- Wurde die Abfrage einmal abgelehnt, lässt sie sich nur unter _Einstellungen › Mitteilungen ›
  disslxt_ wieder erlauben; die App sagt das an der Stelle.

**Lokal/E2E:** `PUSH_TRANSPORT=memory` zeichnet Pushes auf statt sie zu senden
(`GET /api/dev/pushes`, nur außerhalb von Produktion).

## Sprache: Diktieren, Vorlesen, Sprachnachrichten

| Funktion          | Technik                                 | Wo es geht                                                | Datenschutz                                                         |
| ----------------- | --------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------- |
| Diktieren         | Web Speech API `SpeechRecognition`      | Chrome, Edge, Safari (macOS/iOS 14.5+); **nicht** Firefox | Chrome/Edge schicken das Audio an Google/Microsoft, Safari an Apple |
| Vorlesen          | `speechSynthesis` (Stimme des Geräts)   | alle aktuellen Browser                                    | lokal, nichts verlässt das Gerät                                    |
| Sprachnachrichten | `MediaRecorder` → Upload → ffmpeg → AAC | alle aktuellen Browser inkl. iOS 14.3+                    | Dateien auf dem eigenen Server, nur für Mitglieder abrufbar         |

- **Diktieren:** Mikrofon-Symbol im Eingabefeld. Der erkannte Text erscheint live im Feld und
  wird erst mit Enter gesendet (korrigierbar). Ohne Browser-Unterstützung ist der Knopf
  ausgeblendet. Auf iOS endet jede Erkennung nach einem Satz (iOS-Verhalten), also pro Satz
  einmal tippen; in der Home-Bildschirm-App ist `SpeechRecognition` je nach iOS-Version nicht
  verfügbar – dort hilft die Diktiertaste der iOS-Tastatur.
- **Vorlesen:** Lautsprecher-Symbol an jeder Nachricht (Maus darüber bzw. Nachricht antippen).
  In den Einstellungen: _Neue Nachrichten vorlesen_ für den offenen Kanal, plus Sprechtempo.
  iOS spricht erst nach einer Nutzeraktion, deshalb sagt das Einschalten einmal „Vorlesen ist an“.
- **Sprachnachrichten:** Wellen-Symbol bei leerem Eingabefeld. Maximal 2 Minuten und 5 MB; nach
  2 Minuten wird automatisch gesendet. Der Server prüft die Datei anhand ihrer Signatur (WebM,
  Ogg, MP4, MP3, WAV, AAC – der Content-Type allein zählt nicht), wandelt sie mit ffmpeg in
  AAC/m4a (mono, 64 kbit/s, schneidet nach 2 Minuten ab) und liefert sie nur an Mitglieder des
  Servers aus, mit HTTP-Range (nötig für Safari). Bearbeiten geht nicht, Löschen entfernt auch
  die Datei. Speicherort: Docker-Volume `uploads` (`/data/uploads/voice`) – beim Backup der
  Datenbank auch dieses Volume sichern.
- **Lokal ohne ffmpeg** (`VOICE_TRANSCODE=auto`): Aufnahmen werden unverändert gespeichert; WebM
  aus Chrome spielt dann auf älteren iPhones evtl. nicht ab. Das Docker-Image enthält ffmpeg.

## Live-Sprachkanäle (WebRTC)

Besitzer:innen legen über **+ → Sprache** einen Sprachkanal an. In der Kanalliste sieht jedes
Mitglied, wer gerade drin ist. **Beitreten** fragt einmal nach dem Mikrofon; danach kann man in
Textkanälen weiterlesen – die Leiste über dem Profil zeigt die Verbindung, Stummschalten und
Auflegen. Ein Ring um den Avatar zeigt, wer spricht. Die erste Person im Kanal löst eine
Mitteilung an die anderen aus.

**Technik:** Mesh mit bis zu **6 Personen** (jede:r sendet an jede:n; mehr wäre auf Handys zu viel
Upload). Signalisierung (SDP, ICE) läuft über die bestehende WebSocket und wird nur zwischen
Teilnehmenden desselben Kanals weitergereicht; das Audio fließt direkt zwischen den Browsern
(DTLS-SRTP-verschlüsselt), nie über den Server. Wer kurz die Verbindung verliert, tritt
automatisch wieder bei; scheitert ein Pfad (z. B. WLAN → Mobilfunk), startet ein ICE-Restart.
Pro Person ein Kanal auf einem Gerät – Beitreten am zweiten Gerät übernimmt.

**TURN – wann nötig?** STUN (Standard: Cloudflare) reicht, wenn sich die Geräte direkt
erreichen. Hinter symmetrischem NAT (viele Mobilfunknetze, Firmen-WLAN) braucht es einen
TURN-Server, der das Audio weiterleitet. Der Cloudflare Tunnel überträgt **kein UDP**, daher
kann dieser Server selbst kein TURN anbieten. Optionen:

1. **Cloudflare Realtime TURN (empfohlen):** im Cloudflare-Dashboard unter _Realtime → TURN_
   einen Schlüssel anlegen und `CLOUDFLARE_TURN_KEY_ID` / `CLOUDFLARE_TURN_API_TOKEN` setzen.
   Das Backend holt kurzlebige Zugangsdaten (6 h) und filtert Port 53 heraus (blockieren
   Browser). Die ersten 1000 GB im Monat sind kostenlos.
2. **Eigener coturn:** `TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL`. Braucht offene UDP-Ports
   (3478 + Relay-Bereich) direkt am Server, also Firewall-Freigaben – nicht über den Tunnel.

Ohne TURN zeigt die App bei gescheiterter Verbindung einen Hinweis darauf.

**Monatliches TURN-Limit:** Jeder Browser misst während eines Anrufs alle 15 s, wie viele Bytes
tatsächlich über TURN gelaufen sind (WebRTC-Statistik des gewählten Kandidatenpaars, nur wenn die
eigene Seite ein Relay-Kandidat ist; direkte Verbindungen zählen nicht) und meldet sie dem
Server. Der summiert pro Kalendermonat (UTC). Ab `TURN_MONTHLY_LIMIT_GB` (Standard 900, unter den
1000 GB gratis) gibt es bis Monatsende nur noch STUN; Sprachkanäle laufen dann weiter, wo eine
direkte Verbindung möglich ist. Ausgegebene Zugangsdaten gelten höchstens 2 h, laufende Relays
enden also bald nach Erreichen der Grenze. Der Stand steht in den Einstellungen unter
„Sprachkanäle“. Gesendet und empfangen zählen beide – das liegt eher über dem, was Cloudflare
abrechnet. Getestet mit einem echten Anruf nur über Cloudflare-Relay
(`e2e/tests/turn-relay.spec.ts`, läuft mit `E2E_CLOUDFLARE_TURN_KEY_ID`/`_API_TOKEN`).

## Dateien teilen

Büroklammer im Eingabefeld, Datei in den Chat ziehen oder ein Bild einfügen (Strg/Cmd+V).
Mehrere Dateien gleichzeitig, mit Fortschritt und Abbrechen; maximal **25 MB** pro Datei.

**Sicherheit:** Gespeichert wird unter einem Zufallsnamen in `UPLOAD_DIR/files` (Volume
`uploads`). Name und Typ vom Client zählen nicht: Nur echte Bilder (PNG, JPEG, GIF, WebP – an den
ersten Bytes erkannt) werden im Chat angezeigt. Alles andere, auch SVG, HTML und PDF, wird nur
als Download ausgeliefert (`application/octet-stream`, `Content-Disposition: attachment`,
`Content-Security-Policy: default-src 'none'; sandbox`, `nosniff`). Eine hochgeladene Datei
kann so nie als Seite auf disslxt laufen. Dateinamen werden bereinigt (keine Pfade, keine
Steuer- oder Richtungszeichen wie in `rechnung‮fdp.exe`). Abrufen nur für Mitglieder; Löschen
der Nachricht oder des Servers entfernt die Datei.

## Server verlassen und löschen

Mitglieder: „Server verlassen“ unten in der Kanalleiste. Besitzer:innen können ihren Server
nicht verlassen, aber **löschen** – nach Eingabe des Servernamens. Das entfernt Kanäle,
Nachrichten, Sprachnachrichten und Dateien für alle; laufende Sprachanrufe enden, alle
Mitglieder sehen es sofort.

## Passwort-Regeln

Für neue Passwörter (bestehende funktionieren weiter): mindestens 10 Zeichen; 3 von 4
Zeichenarten (klein, groß, Ziffer, Sonderzeichen) oder eine Passphrase ab 16 Zeichen; kein
häufiges Passwort (auch nicht mit angehängten Ziffern/Zeichen, keine Tastatur- oder
Zahlenfolgen); enthält weder Benutzernamen noch den Namensteil der E-Mail; kein Zeichen 4× in
Folge. Dieselbe Prüfung läuft im Browser (Checkliste mit Stärke-Anzeige beim Registrieren) und
auf dem Server (`shared/src/password.ts`).

## Audio-Geräte im Sprachkanal

„Beitreten“ öffnet zuerst ein Menü: Mikrofon wählen (mit Live-Pegel), Ausgabe wählen
(Lautsprecher/Kopfhörer), Testton. Die Wahl wird pro Gerät gemerkt. Im Anruf öffnet das
Zahnrad dasselbe Menü; Änderungen greifen sofort (Mikrofon per `replaceTrack`, ohne neu zu
verbinden). Die **Ausgabe** wählen können nur Chrome, Edge und Firefox (`setSinkId`); Safari
und iOS lassen das nicht zu – dort entscheidet das System (iPhone: Kontrollzentrum/AirPlay).

## Darstellung (Dark Mode)

Einstellungen → **Darstellung**: _Automatisch_ (folgt dem Gerät), _Hell_ oder _Dunkel_. Gilt pro
Gerät; `/theme-init.js` setzt die Wahl vor dem ersten Zeichnen, damit nichts hell aufblitzt.

Design: Dark-first mit Violett→Blau-Akzent (Tokens am Anfang von `frontend/src/styles.css`). Avatare
und Server-Symbole bekommen eine feste Farbe aus dem Namen. Aufeinanderfolgende Nachrichten einer
Person (Abstand unter 7 Minuten, gleicher Tag) werden zusammengefasst, jeder Tag beginnt mit einem
Trenner („Heute“, „Gestern“, Datum). Einladen, Verlassen und Löschen stecken im Server-Menü (Klick auf
den Servernamen); die Mitgliederliste lässt sich über das Personen-Symbol im Kanal-Kopf ausblenden.

## Backup & Wiederherstellung

`scripts/backup.sh` sichert die Datenbank (`pg_dump`, Custom-Format) und das Volume `uploads`
(Sprachnachrichten) nach `~/disslxt-backups` und behält je die 14 neuesten
(`BACKUP_DIR`, `BACKUP_KEEP` zum Anpassen). Täglich um 3:30 Uhr per Cron (ohne sudo):

```sh
(crontab -l 2>/dev/null; echo '30 3 * * * cd ~/disslxt && scripts/backup.sh >> ~/disslxt-backups/backup.log 2>&1') | crontab -
```

Die Sicherungen liegen auf demselben Server – für echte Ausfallsicherheit zusätzlich woanders
hin kopieren (z. B. Storage Box per `rsync`).

**Wiederherstellen** (überschreibt den aktuellen Stand):

```sh
docker compose stop backend
docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' < ~/disslxt-backups/db-<zeit>.dump
docker compose run --rm --no-deps -T --entrypoint sh backend -c 'rm -rf /data/uploads/* && tar xzf - -C /data/uploads' < ~/disslxt-backups/uploads-<zeit>.tar.gz
docker compose up -d
```

## Konfiguration (Env-Variablen)

| Variable                                              | Default                                            | Beschreibung                                                                                                               |
| ----------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                        | – (Pflicht)                                        | PostgreSQL-URL                                                                                                             |
| `TEST_DATABASE_URL`                                   | `postgres://chat:chat@localhost:5432/disslxt_test` | DB für Backend-Tests                                                                                                       |
| `E2E_DATABASE_URL`                                    | `postgres://chat:chat@localhost:5432/disslxt_e2e`  | DB für Playwright (wird vor jedem Lauf geleert)                                                                            |
| `E2E_BASE_URL`                                        | –                                                  | Playwright gegen eine laufende Instanz statt eigener Dev-Server                                                            |
| `E2E_BACKEND_PORT` / `E2E_FRONTEND_PORT`              | `3100` / `5174`                                    | Ports der von Playwright gestarteten Server                                                                                |
| `API_PROXY_TARGET`                                    | `http://127.0.0.1:3000`                            | Backend-Ziel des Vite-Proxys (`/api`, `/ws`)                                                                               |
| `NODE_ENV`                                            | `development`                                      | `development` (pino-pretty), `test`, `production`                                                                          |
| `PORT` / `HOST`                                       | `3000` / `0.0.0.0`                                 | Listen-Adresse                                                                                                             |
| `LOG_LEVEL`                                           | `info`                                             | pino Log-Level                                                                                                             |
| `COOKIE_SECURE`                                       | `false`                                            | `Secure`-Flag für das Session-Cookie                                                                                       |
| `TRUST_PROXY`                                         | `false`                                            | hinter Reverse-Proxy (Caddy) auf `true`                                                                                    |
| `SESSION_TTL_DAYS`                                    | `30`                                               | Session-Lebensdauer                                                                                                        |
| `ALLOWED_ORIGINS`                                     | –                                                  | zusätzlich erlaubte Origins (kommagetrennt); Same-Origin ist immer erlaubt                                                 |
| `RATE_LIMIT_LOGIN_MAX` / `_WINDOW_MS`                 | `10` / `60000`                                     | Login/Bestätigung pro IP                                                                                                   |
| `RATE_LIMIT_MESSAGE_MAX` / `_WINDOW_MS`               | `20` / `10000`                                     | Nachrichten pro Nutzer                                                                                                     |
| `WS_HEARTBEAT_MS`                                     | `30000`                                            | Server-Ping-Intervall für WebSockets                                                                                       |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | –                                                  | nur Docker Compose                                                                                                         |
| `PUBLIC_URL`                                          | `http://localhost:5173`                            | öffentliche HTTPS-Adresse, z. B. `https://disslxt.slxt.org`; Basis für Mail-Links und einziger erlaubter Origin in Compose |
| `MAIL_TRANSPORT`                                      | `log`                                              | `smtp` (Pflicht in Produktion) oder `log` (Mails im Speicher, nur Dev/Test)                                                |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE`             | – / `587` / `false`                                | SMTP-Server; `false` = STARTTLS (erzwungen), `true` = TLS auf 465                                                          |
| `SMTP_USER` / `SMTP_PASS`                             | –                                                  | Zugangsdaten (iCloud: Apple-ID-Adresse + App-spezifisches Passwort)                                                        |
| `MAIL_FROM`                                           | –                                                  | Absender, z. B. `disslxt <noreply@slxt.org>`                                                                               |
| `EMAIL_VERIFICATION_TTL_HOURS`                        | `24`                                               | Gültigkeit der Bestätigungslinks (max. 168)                                                                                |
| `MAIL_MAX_PER_ADDRESS_PER_HOUR`                       | `3`                                                | Mails pro Empfängeradresse und Stunde                                                                                      |
| `RATE_LIMIT_MAIL_MAX` / `_WINDOW_MS`                  | `5` / `900000`                                     | Registrierung/„Erneut senden“ pro IP                                                                                       |
| `HTTP_PORT`                                           | `8091`                                             | lokaler Port von Caddy (nur `127.0.0.1`), Ziel des Tunnels                                                                 |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`              | –                                                  | Web-Push-Schlüssel (`pnpm vapid:generate`); leer = Mitteilungen aus                                                        |
| `VAPID_SUBJECT`                                       | `PUBLIC_URL`                                       | Kontakt für die Push-Dienste (`mailto:` oder `https:`)                                                                     |
| `PUSH_TRANSPORT`                                      | `webpush`                                          | `memory` zeichnet nur auf (Dev/E2E), in Produktion verboten                                                                |
| `UPLOAD_DIR`                                          | `data/uploads`                                     | Ablage für Sprachnachrichten (Compose: Volume unter `/data/uploads`)                                                       |
| `VOICE_TRANSCODE`                                     | `auto`                                             | `ffmpeg` (Pflicht-Umwandlung, Compose), `auto` (wenn vorhanden), `off` (unverändert speichern)                             |
| `FFMPEG_PATH` / `FFPROBE_PATH`                        | `ffmpeg` / `ffprobe`                               | Pfade der ffmpeg-Programme                                                                                                 |
| `VOICE_STUN_URLS`                                     | `stun:stun.cloudflare.com:3478`                    | STUN-Server für Sprachkanäle (kommagetrennt)                                                                               |
| `CLOUDFLARE_TURN_KEY_ID` / `_API_TOKEN`               | –                                                  | Cloudflare Realtime TURN (kurzlebige Zugangsdaten per API)                                                                 |
| `TURN_URLS` / `TURN_USERNAME` / `TURN_CREDENTIAL`     | –                                                  | eigener TURN-Server (z. B. coturn)                                                                                         |
| `TURN_MONTHLY_LIMIT_GB`                               | `900`                                              | ab dieser Relay-Menge pro Monat kein TURN mehr (nur STUN)                                                                  |

Es werden keine Secrets im Repository gespeichert; `.env` ist in `.gitignore`.

## Entscheidungen zu offenen Fragen

- **Name:** Arbeitstitel „disslxt“ (kein Markenname).
- **Betrieb:** self-hosted per Docker Compose.
- **Gäste:** ohne Account kann nichts gelesen werden; alle Endpunkte außer Registrierung,
  Bestätigung, Login und Health erfordern eine Session.

## API-Überblick

Alle Endpunkte unter `/api`, JSON, Session-Cookie `sid` (httpOnly, SameSite=Lax). Fehlerformat:
`{ "error": { "code", "message", "details?" } }`. Echtzeit über `GET /ws` (Server→Client-Events,
Client sendet `subscribe`/`unsubscribe`/`ping`/`visibility` und `voice.*` für Sprachkanäle). Details: `docs/PLAN.md` §3.
