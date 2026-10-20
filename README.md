# Chat-MVP

Eine schlanke Chat-Plattform für Communities: Nutzer registrieren sich, treten Servern (Guilds)
per Invite-Link bei und chatten in Textkanälen in Echtzeit (WebSocket).

> Status: Backend (Auth, Guilds, Invites, Channels, Messages, Realtime, Presence, Rate-Limits)
> ist implementiert und getestet. Das Frontend ist noch ein Scaffold.

## Aufbau

pnpm-Monorepo:

| Paket                              | Inhalt                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------ |
| `shared/` (`@chat-mvp/shared`)     | zod-Schemas, DTO-Typen, WS-Protokoll, Konstanten (TS-Source, kein Build) |
| `backend/` (`@chat-mvp/backend`)   | Fastify 5 + `@fastify/websocket`, Drizzle ORM (PostgreSQL), argon2id     |
| `frontend/` (`@chat-mvp/frontend`) | Vite + React (Scaffold)                                                  |
| `e2e/` (`@chat-mvp/e2e`)           | Playwright (Scaffold)                                                    |

## Voraussetzungen

- Node.js 22, pnpm 10
- PostgreSQL 16 (lokal) **oder** Docker
- Docker Compose (für das Deployment)

## Lokale Entwicklung

```bash
bash scripts/setup-local-db.sh   # als root: legt Rolle chat/chat + DBs chat_mvp_dev/_test/_e2e an
cp .env.example .env
pnpm install
pnpm db:migrate                  # wendet die SQL-Migrationen an (passiert auch beim Backend-Start)
pnpm dev                         # Backend :3000, Frontend :5173
```

Alternativ zur lokalen PostgreSQL: `docker compose -f docker-compose.dev.yml up -d` (Port 5433) und
`DATABASE_URL` entsprechend anpassen.

## Tests & Qualität

```bash
pnpm lint && pnpm format:check && pnpm typecheck
pnpm test                               # shared + backend (+ frontend)
pnpm --filter @chat-mvp/backend test    # nur Backend (nutzt TEST_DATABASE_URL, Default chat_mvp_test)
```

Die Backend-Tests laufen gegen eine echte PostgreSQL-Datenbank (`chat_mvp_test`), die vor jedem
Test geleert wird.

## Deployment (Docker Compose, HTTPS)

```bash
cp .env.example .env       # POSTGRES_PASSWORD anpassen
docker compose up --build -d
docker compose ps
curl -sk https://localhost:8443/api/health
```

Caddy terminiert TLS mit einer lokalen CA (`tls internal`). Browser warnen daher, bis die Caddy-CA
vertraut wird; für `curl` `-k` verwenden. Die Datenbank veröffentlicht bewusst keinen Port.

## Konfiguration (Env-Variablen)

| Variable                                              | Default                                             | Beschreibung                                                               |
| ----------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------- |
| `DATABASE_URL`                                        | – (Pflicht)                                         | PostgreSQL-URL                                                             |
| `TEST_DATABASE_URL`                                   | `postgres://chat:chat@localhost:5432/chat_mvp_test` | DB für Backend-Tests                                                       |
| `PORT` / `HOST`                                       | `3000` / `0.0.0.0`                                  | Listen-Adresse                                                             |
| `LOG_LEVEL`                                           | `info`                                              | pino Log-Level                                                             |
| `COOKIE_SECURE`                                       | `false`                                             | `Secure`-Flag für das Session-Cookie                                       |
| `TRUST_PROXY`                                         | `false`                                             | hinter Reverse-Proxy (Caddy) auf `true`                                    |
| `SESSION_TTL_DAYS`                                    | `30`                                                | Session-Lebensdauer                                                        |
| `ALLOWED_ORIGINS`                                     | –                                                   | zusätzlich erlaubte Origins (kommagetrennt); Same-Origin ist immer erlaubt |
| `RATE_LIMIT_LOGIN_MAX` / `_WINDOW_MS`                 | `10` / `60000`                                      | Login/Registrierung pro IP                                                 |
| `RATE_LIMIT_MESSAGE_MAX` / `_WINDOW_MS`               | `20` / `10000`                                      | Nachrichten pro Nutzer                                                     |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | –                                                   | nur Docker Compose                                                         |
| `SITE_ADDRESS` / `HTTPS_PORT` / `HTTP_PORT`           | `localhost` / `8443` / `8080`                       | nur Docker Compose                                                         |

Es werden keine Secrets im Repository gespeichert; `.env` ist in `.gitignore`.

## Entscheidungen zu offenen Fragen

- **Name:** Arbeitstitel „Chat-MVP“ (kein Markenname).
- **Betrieb:** self-hosted per Docker Compose.
- **Gäste:** ohne Account kann nichts gelesen werden; alle Endpunkte außer Registrierung, Login
  und Health erfordern eine Session.

## API-Überblick

Alle Endpunkte unter `/api`, JSON, Session-Cookie `sid` (httpOnly, SameSite=Lax). Fehlerformat:
`{ "error": { "code", "message", "details?" } }`. Echtzeit über `GET /ws` (Server→Client-Events,
Client sendet nur `subscribe`/`unsubscribe`/`ping`). Details: `docs/PLAN.md` §3.
