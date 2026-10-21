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

Optionaler E2E-Smoke-Test gegen den laufenden Stack über den Tunnel (legt zwei Testnutzer an):

```bash
E2E_BASE_URL=https://disslxt.slxt.org pnpm e2e:docker
```

## Konfiguration (Env-Variablen)

| Variable                                              | Default                                            | Beschreibung                                                                           |
| ----------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                        | – (Pflicht)                                        | PostgreSQL-URL                                                                         |
| `TEST_DATABASE_URL`                                   | `postgres://chat:chat@localhost:5432/disslxt_test` | DB für Backend-Tests                                                                   |
| `E2E_DATABASE_URL`                                    | `postgres://chat:chat@localhost:5432/disslxt_e2e`  | DB für Playwright (wird vor jedem Lauf geleert)                                        |
| `E2E_BASE_URL`                                        | –                                                  | Playwright gegen eine laufende Instanz statt eigener Dev-Server                        |
| `E2E_BACKEND_PORT` / `E2E_FRONTEND_PORT`              | `3100` / `5174`                                    | Ports der von Playwright gestarteten Server                                            |
| `API_PROXY_TARGET`                                    | `http://127.0.0.1:3000`                            | Backend-Ziel des Vite-Proxys (`/api`, `/ws`)                                           |
| `NODE_ENV`                                            | `development`                                      | `development` (pino-pretty), `test`, `production`                                      |
| `PORT` / `HOST`                                       | `3000` / `0.0.0.0`                                 | Listen-Adresse                                                                         |
| `LOG_LEVEL`                                           | `info`                                             | pino Log-Level                                                                         |
| `COOKIE_SECURE`                                       | `false`                                            | `Secure`-Flag für das Session-Cookie                                                   |
| `TRUST_PROXY`                                         | `false`                                            | hinter Reverse-Proxy (Caddy) auf `true`                                                |
| `SESSION_TTL_DAYS`                                    | `30`                                               | Session-Lebensdauer                                                                    |
| `ALLOWED_ORIGINS`                                     | –                                                  | zusätzlich erlaubte Origins (kommagetrennt); Same-Origin ist immer erlaubt             |
| `RATE_LIMIT_LOGIN_MAX` / `_WINDOW_MS`                 | `10` / `60000`                                     | Login/Registrierung pro IP                                                             |
| `RATE_LIMIT_MESSAGE_MAX` / `_WINDOW_MS`               | `20` / `10000`                                     | Nachrichten pro Nutzer                                                                 |
| `WS_HEARTBEAT_MS`                                     | `30000`                                            | Server-Ping-Intervall für WebSockets                                                   |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | –                                                  | nur Docker Compose                                                                     |
| `PUBLIC_URL`                                          | – (Pflicht für Compose)                            | öffentliche HTTPS-Adresse, z. B. `https://disslxt.slxt.org`; einziger erlaubter Origin |
| `HTTP_PORT`                                           | `8091`                                             | lokaler Port von Caddy (nur `127.0.0.1`), Ziel des Tunnels                             |

Es werden keine Secrets im Repository gespeichert; `.env` ist in `.gitignore`.

## Entscheidungen zu offenen Fragen

- **Name:** Arbeitstitel „disslxt“ (kein Markenname).
- **Betrieb:** self-hosted per Docker Compose.
- **Gäste:** ohne Account kann nichts gelesen werden; alle Endpunkte außer Registrierung, Login
  und Health erfordern eine Session.

## API-Überblick

Alle Endpunkte unter `/api`, JSON, Session-Cookie `sid` (httpOnly, SameSite=Lax). Fehlerformat:
`{ "error": { "code", "message", "details?" } }`. Echtzeit über `GET /ws` (Server→Client-Events,
Client sendet nur `subscribe`/`unsubscribe`/`ping`). Details: `docs/PLAN.md` §3.
