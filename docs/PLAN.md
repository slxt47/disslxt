# Chat-MVP Implementation Plan

Spec: /home/user/chat-mvp/docs/SPEC.md. Project root: /home/user/chat-mvp. Working name is **Chat-MVP**. The UI is in German, because the spec uses terms like "Ältere laden".

**Environment check (done):** I ran these as root.
- Postgres 16 accepts connections on localhost:5432, but password auth fails for `postgres` because no password is set.
- `sudo -n` works, so the DB setup script below uses `sudo -u postgres psql`.
- Docker Compose v5 is available.
- Chromium is in /opt/pw-browsers.

## 0. Key decisions
| Topic | Choice | Why |
|---|---|---|
| Repo | pnpm 10 workspaces: `backend/`, `frontend/`, `shared/` (`@chat-mvp/*`) | The spec asks for this, and pnpm handles workspace links. |
| Shared package | `shared` exports TS source (`"main":"src/index.ts"`). It has no build step. | Vite, tsx and vitest read TS directly, and the backend bundle (tsup) inlines it. |
| Backend | Fastify 5, `@fastify/websocket` (based on `ws`), `@fastify/cookie`, `@fastify/helmet`, `@fastify/rate-limit` | One server for HTTP and WS, typed, built-in pino logging. |
| ORM | **Drizzle ORM + drizzle-kit**, `pg` driver. SQL migrations are committed and applied with `drizzle-orm/node-postgres/migrator`. | No engine binary downloads (Prisma has them), so it works offline and in Docker. |
| Auth | Opaque random session token in an httpOnly cookie `sid` (SameSite=Lax, Secure via env). The DB stores only the token's sha256. TTL 30 days. | Logout really ends the session, and the cookie also authenticates the WS upgrade. |
| CSRF | SameSite=Lax, plus every mutating request must be JSON, plus an Origin check | Simple and good enough for the MVP. |
| Hashing | `@node-rs/argon2` (argon2id; prebuilt binaries, no node-gyp) | Meets the spec, no native build risk. Fallback if the install fails: `bcryptjs` with cost 12. |
| Validation | zod schemas in `shared/` for both FE and BE. Fastify validates with zod via a small `parse()` helper, not type-provider magic. | One source of truth. |
| Realtime | Messages are sent over REST (POST). WS only carries server-to-client events plus subscribe/unsubscribe. In-memory rooms, single instance. | Simpler rate limiting and validation. 100 users per instance is fine in memory. |
| Frontend | Vite + React 18 + react-router 6 + zustand, plain CSS (one `styles.css` with a 768px breakpoint) | Light, and the patterns are well known. |
| Tests | Backend: vitest against a real Postgres DB `chat_mvp_test`, using `app.inject` plus a real `ws` client on port 0. Frontend: vitest + jsdom + @testing-library/react. E2E: Playwright (chromium, two browser contexts) against DB `chat_mvp_e2e`. | Covers the spec's test requirements and success criteria. |
| Rate limiting | `@fastify/rate-limit` (global: false), configured per route and through env. | Standard, testable. |
| XSS | React escaping only; `dangerouslySetInnerHTML` is banned by the ESLint rule `react/no-danger: error`. CSP comes from Caddy (static frontend) and helmet (API). | Covers the spec item. |
| Logging | pino (Fastify logger), redacting `req.headers.cookie`, `password` and `authorization`. Uses `pino-pretty` only in dev. | |
| Deploy | Docker Compose with `db` (postgres:16-alpine, no host port), `backend` and `caddy`. The Caddy image is built in multiple stages: Vite build, then served by Caddy with `tls internal`, proxying `/api/*` and `/ws`. | HTTPS locally without needing real certs. |
| Open questions | Name "Chat-MVP"; self-hosted via Docker Compose; guests without an account can't read anything (every endpoint except register, login and health needs auth). | |

## 1. Directory tree
```
chat-mvp/
├─ .gitignore                 node_modules, dist, .env, coverage, playwright-report, test-results, caddy data
├─ .prettierrc.json / .prettierignore
├─ .editorconfig
├─ .nvmrc                     22
├─ .env.example               all env vars with safe dummy values (no real secrets)
├─ README.md                  overview, prerequisites, dev setup, tests, docker compose up, HTTPS note (trust Caddy local CA or curl -k), env table, decisions on open questions
├─ package.json               root scripts (see §7), devDeps: typescript, eslint, prettier, typescript-eslint, @playwright/test
├─ pnpm-workspace.yaml        packages: backend, frontend, shared, e2e; onlyBuiltDependencies if needed
├─ tsconfig.base.json         strict, ES2022, moduleResolution bundler, noUncheckedIndexedAccess
├─ eslint.config.js           flat config: ts-eslint recommended, react, react-hooks; react/no-danger: error; no-console warn (backend uses logger)
├─ docker-compose.yml         db, backend, caddy (prod-like, HTTPS)
├─ docker-compose.dev.yml     only db on host port ${DEV_DB_PORT:-5433} (optional; local PG is also fine)
├─ scripts/setup-local-db.sh  idempotent: creates role chat/chat + DBs chat_mvp_dev, chat_mvp_test, chat_mvp_e2e via sudo -u postgres psql
├─ deploy/
│  ├─ Caddyfile               {$SITE_ADDRESS:localhost} { tls internal; encode gzip; header CSP etc.; handle /api/* and /ws → reverse_proxy backend:3000; handle → root /srv, try_files {path} /index.html, file_server }
│  └─ caddy.Dockerfile        stage1 node:22 + pnpm build frontend; stage2 caddy:2-alpine copy dist → /srv, Caddyfile
├─ shared/
│  ├─ package.json            name @chat-mvp/shared, deps: zod
│  ├─ tsconfig.json
│  └─ src/
│     ├─ index.ts             re-exports
│     ├─ schemas.ts           zod: registerSchema, loginSchema, createGuildSchema, createChannelSchema, sendMessageSchema, editMessageSchema, listMessagesQuery, inviteCodeSchema
│     ├─ types.ts             DTOs: UserDto, GuildDto, ChannelDto, MessageDto, MemberDto, ApiError
│     ├─ ws.ts                WS client→server and server→client message types (discriminated unions) + zod schema for client msgs
│     ├─ constants.ts         MESSAGE_MAX_LEN=2000, PAGE_DEFAULT=50, PAGE_MAX=100, WS close codes
│     └─ schemas.test.ts      validation unit tests
├─ backend/
│  ├─ package.json            name @chat-mvp/backend; scripts dev (tsx watch), build (tsup), start, test, typecheck, db:generate, db:migrate
│  ├─ tsconfig.json
│  ├─ tsup.config.ts          entry src/server.ts, format esm, noExternal [@chat-mvp/shared]
│  ├─ drizzle.config.ts       schema ./src/db/schema.ts, out ./drizzle, dialect postgresql, url from DATABASE_URL
│  ├─ drizzle/                generated SQL migrations + meta (committed)
│  ├─ Dockerfile              multi-stage: build (pnpm install, build) → runtime node:22-slim, non-root, CMD node dist/server.js (migrates on boot)
│  ├─ vitest.config.ts        env DATABASE_URL from TEST_DATABASE_URL; globalSetup; fileParallelism false (shared DB)
│  ├─ src/
│  │  ├─ config.ts            zod-parsed env (DATABASE_URL, PORT, HOST, COOKIE_SECURE, SESSION_TTL_DAYS, ALLOWED_ORIGINS, LOG_LEVEL, RATE_LIMIT_* , NODE_ENV); throws on invalid
│  │  ├─ server.ts            entry: loadConfig, runMigrations, buildApp, listen, graceful shutdown (SIGTERM)
│  │  ├─ app.ts               buildApp(config, db) → registers plugins, error handler, routes, ws
│  │  ├─ db/client.ts         pg Pool + drizzle instance; createDb(url)
│  │  ├─ db/schema.ts         Drizzle tables (§2)
│  │  ├─ db/migrate.ts        runMigrations(db) + CLI entry
│  │  ├─ lib/errors.ts        AppError(code,status,message,details) + helpers (notFound, forbidden, …)
│  │  ├─ lib/password.ts      hashPassword / verifyPassword (argon2id)
│  │  ├─ lib/tokens.ts        randomToken(32 bytes base64url), sha256, inviteCode(10 chars base62)
│  │  ├─ lib/validate.ts      parse(schema, data) → throws AppError VALIDATION_ERROR
│  │  ├─ lib/origin.ts        isAllowedOrigin(req, config)
│  │  ├─ plugins/auth.ts      decorates request.user from sid cookie; preHandler requireAuth
│  │  ├─ plugins/errorHandler.ts  maps AppError/zod/rate-limit/unknown → {error:{code,message,details?}}; logs 5xx with stack
│  │  ├─ plugins/security.ts  helmet (API CSP default-src 'none'), Origin check hook for non-GET
│  │  ├─ services/auth.service.ts      register, login, logout, getUserBySession
│  │  ├─ services/guild.service.ts     create (with #general), listForUser, get, join via invite, leave, members, assertMember
│  │  ├─ services/channel.service.ts   list, create (owner only)
│  │  ├─ services/message.service.ts   create, listPage, edit, delete (author-only)
│  │  ├─ routes/health.ts
│  │  ├─ routes/auth.routes.ts
│  │  ├─ routes/guild.routes.ts
│  │  ├─ routes/channel.routes.ts
│  │  ├─ routes/invite.routes.ts
│  │  ├─ routes/message.routes.ts
│  │  ├─ realtime/hub.ts      in-memory: sockets by user, channel rooms, guild rooms, presence counts; publishToChannel, publishToGuild, addUserToGuild, removeUserFromGuild
│  │  └─ realtime/ws.route.ts GET /ws upgrade: Origin check, cookie auth, ready event, subscribe/unsubscribe handling, heartbeat, presence
│  └─ test/
│     ├─ globalSetup.ts       runs migrations against TEST DB
│     ├─ helpers.ts           buildTestApp(), resetDb() (TRUNCATE … RESTART IDENTITY CASCADE), registerUser(), cookie helpers, wsConnect(), nextEvent()
│     ├─ auth.test.ts
│     ├─ guilds.test.ts
│     ├─ channels.test.ts
│     ├─ messages.test.ts
│     ├─ authorization.test.ts
│     ├─ ratelimit.test.ts
│     ├─ security.test.ts     XSS payload stored verbatim, headers, origin rejection, validation
│     ├─ realtime.test.ts     ws auth, rooms, created/updated/deleted, presence, latency <300ms
│     └─ password.test.ts
├─ frontend/
│  ├─ package.json            react, react-dom, react-router-dom, zustand, @chat-mvp/shared; dev: vite, @vitejs/plugin-react, vitest, jsdom, @testing-library/react, @testing-library/user-event
│  ├─ tsconfig.json
│  ├─ vite.config.ts          dev proxy /api → http://localhost:3000, /ws → ws://localhost:3000 (ws:true); vitest env jsdom
│  ├─ index.html              <meta viewport>, title Chat-MVP
│  └─ src/
│     ├─ main.tsx
│     ├─ App.tsx              routes + AuthGate
│     ├─ styles.css           layout, responsive (≤768px drawer)
│     ├─ api/client.ts        fetch wrapper (credentials 'include', JSON, throws ApiError)
│     ├─ api/endpoints.ts     typed functions per endpoint
│     ├─ realtime/socket.ts   RealtimeClient: connect, backoff, subscribe, event emitter, status
│     ├─ realtime/backoff.ts  nextDelay(attempt) = min(10000, 500*2^attempt) * (0.5..1 jitter)
│     ├─ store/auth.ts        zustand: user, loadMe, login, register, logout
│     ├─ store/chat.ts        zustand: guilds, channelsByGuild, messagesByChannel (sorted, dedup by id), hasMore, members/presence, connection status; reducers for ws events
│     ├─ pages/LoginPage.tsx
│     ├─ pages/RegisterPage.tsx
│     ├─ pages/AppLayout.tsx  ServerList | ChannelSidebar | ChatView | MemberList
│     ├─ pages/InvitePage.tsx /invite/:code
│     ├─ pages/NotFound.tsx
│     ├─ components/ServerList.tsx      guild icons + "+" (create guild modal)
│     ├─ components/CreateGuildDialog.tsx
│     ├─ components/ChannelSidebar.tsx  guild name, channel list, "+ Kanal" (owner), invite link copy, "Server verlassen", user footer with Logout
│     ├─ components/CreateChannelDialog.tsx
│     ├─ components/ChatView.tsx        header (#channel, mobile menu button), MessageList, Composer, ConnectionBanner
│     ├─ components/MessageList.tsx     "Ältere laden", auto-scroll logic
│     ├─ components/MessageItem.tsx     author, time, content (pre-wrap), "(bearbeitet)", own: Bearbeiten/Löschen
│     ├─ components/Composer.tsx        textarea; Enter sends, Shift+Enter newline
│     ├─ components/MemberList.tsx      online/offline dots
│     ├─ components/ConnectionBanner.tsx
│     └─ __tests__/ Composer.test.tsx, MessageItem.test.tsx, backoff.test.ts, chatStore.test.ts, MessageList.test.tsx
└─ e2e/
   ├─ package.json            @chat-mvp/e2e, dep @playwright/test
   ├─ playwright.config.ts    chromium only, baseURL http://localhost:5173, webServer: [backend (DATABASE_URL=E2E DB, PORT 3000, relaxed rate limits), frontend vite dev on 5173], workers 1
   ├─ global-setup.ts         migrate + truncate E2E DB
   ├─ helpers.ts              registerViaUi(page, user), uniqueEmail()
   └─ tests/
      ├─ realtime-chat.spec.ts       success criterion 1 (+ edit/delete propagate, latency)
      ├─ invite-join.spec.ts         success criterion 2 (+ redirect through login back to invite)
      ├─ history-reload.spec.ts      success criterion 3 + "Ältere laden"
      ├─ auth.spec.ts                register/login/logout, guest redirect
      ├─ composer.spec.ts            Enter/Shift+Enter, own edit/delete UI
      ├─ reconnect.spec.ts           context.setOffline → banner → online → events resume
      ├─ presence.spec.ts            second user online/offline in member list
      └─ mobile.spec.ts              viewport 375x740: drawer toggles, chat usable
```

## 2. DB schema (Drizzle, `backend/src/db/schema.ts`)
- **users**: `id uuid pk default gen_random_uuid()`, `email varchar(254) not null`, `username varchar(32) not null`, `password_hash text not null`, `created_at timestamptz not null default now()`. Unique index `users_email_lower_uq` on `lower(email)`. Emails are stored lowercased.
- **sessions**: `id uuid pk`, `user_id uuid fk→users on delete cascade`, `token_hash char(64) unique not null`, `created_at`, `expires_at timestamptz not null`. Index on `user_id`.
- **guilds**: `id uuid pk`, `name varchar(100) not null`, `owner_id uuid fk→users`, `invite_code varchar(16) unique not null`, `created_at`.
- **guild_members**: `guild_id fk→guilds cascade`, `user_id fk→users cascade`, `joined_at default now()`. PK `(guild_id, user_id)`, index on `user_id`.
- **channels**: `id uuid pk`, `guild_id fk→guilds cascade`, `name varchar(32) not null`, `created_at`. Unique `(guild_id, name)`, index on `guild_id`.
- **messages**: `id bigint generated always as identity pk`, `channel_id uuid fk→channels cascade`, `author_id uuid fk→users`, `content text not null` (CHECK `char_length(content) between 1 and 2000`), `created_at timestamptz default now()`, `edited_at timestamptz null`. Index `messages_channel_id_id_idx (channel_id, id desc)` for pagination. Deletes are hard deletes.
- **Migrations:** the coder runs `pnpm --filter @chat-mvp/backend db:generate` (drizzle-kit generate), which writes `backend/drizzle/0000_*.sql`, and commits it. The generated SQL must include `CREATE EXTENSION IF NOT EXISTS pgcrypto`, or rely on PG13+ built-in `gen_random_uuid` (PG16 has it). `runMigrations()` uses the drizzle migrator. It runs on backend boot, in vitest globalSetup, and in Playwright global-setup. There is also a manual command, `pnpm db:migrate`.
- Message ids appear as **strings** in JSON (bigint).

## 3. REST API
Everything is under `/api` and uses JSON. Auth means a valid `sid` cookie. Error shape is `{ "error": { "code": string, "message": string, "details"?: any } }`. Common error codes:
- `VALIDATION_ERROR` 400
- `UNAUTHORIZED` 401
- `FORBIDDEN` 403 (resource exists but you're not a member or not the owner/author)
- `NOT_FOUND` 404
- `CONFLICT` 409
- `RATE_LIMITED` 429 (with `retry-after` header)
- `INTERNAL` 500 (no stack in the response)

Mutating requests with a mismatched `Origin` return `FORBIDDEN` 403 with `code: "BAD_ORIGIN"`.

DTOs:
- `User{id,email,username}`
- `Guild{id,name,ownerId,inviteCode,createdAt}`
- `Channel{id,guildId,name,createdAt}`
- `Message{id,channelId,author:{id,username},content,createdAt,editedAt|null}`
- `Member{userId,username,online:boolean}`

| # | Method & path | Auth | Request | Success | Errors |
|---|---|---|---|---|---|
| A1 | GET /api/health | no | – | 200 `{status:"ok"}` (also runs `select 1`) | 503 if DB down |
| A2 | POST /api/auth/register | no | `{email, username(3–32, [A-Za-z0-9_]), password(8–128)}` | 201 `{user}` + Set-Cookie sid (auto login) | 400, 409 `EMAIL_TAKEN`, 429 |
| A3 | POST /api/auth/login | no | `{email,password}` | 200 `{user}` + Set-Cookie | 400, 401 `INVALID_CREDENTIALS` (same message for unknown email and wrong pw), 429 |
| A4 | POST /api/auth/logout | yes | – | 204, deletes session row, clears cookie | 401 |
| A5 | GET /api/auth/me | yes | – | 200 `{user}` | 401 |
| G1 | GET /api/guilds | yes | – | 200 `{guilds:Guild[]}` (only the user's own guilds) | 401 |
| G2 | POST /api/guilds | yes | `{name 1–100 trimmed}` | 201 `{guild, channels:[#general]}`; creator becomes a member | 400 |
| G3 | GET /api/guilds/:guildId | member | – | 200 `{guild}` | 403, 404 |
| G4 | POST /api/guilds/:guildId/leave | member | – | 204; WS: `member.left` to the guild, sockets drop the guild's rooms | 403, 404, 409 `OWNER_CANNOT_LEAVE` |
| G5 | GET /api/guilds/:guildId/members | member | – | 200 `{members:Member[]}` with live presence | 403, 404 |
| I1 | GET /api/invites/:code | yes | – | 200 `{guild:{id,name,memberCount}, alreadyMember:boolean}` | 401, 404 `INVITE_NOT_FOUND` |
| I2 | POST /api/invites/:code/join | yes | – | 200 `{guild}` (idempotent if already a member); WS `member.joined` + presence online to the guild | 401, 404 |
| C1 | GET /api/guilds/:guildId/channels | member | – | 200 `{channels}` sorted by created_at | 403, 404 |
| C2 | POST /api/guilds/:guildId/channels | owner | `{name}`, normalised (lowercased, spaces become `-`), must match `^[a-z0-9-]{1,32}$` | 201 `{channel}`; WS `channel.created` to the guild | 400, 403, 404, 409 `CHANNEL_EXISTS` |
| M1 | GET /api/channels/:channelId/messages?before=<id>&limit=<1–100, default 50> | member of the channel's guild | – | 200 `{messages: Message[] ascending, hasMore:boolean}`: the newest `limit` messages with id < before | 400, 403, 404 |
| M2 | POST /api/channels/:channelId/messages | member | `{content}`, trimmed, 1–2000 chars | 201 `{message}`; WS `message.created` to the channel room | 400, 403, 404, 429 |
| M3 | PATCH /api/messages/:messageId | author | `{content}` | 200 `{message}` with editedAt set; WS `message.updated` | 400, 403 `NOT_AUTHOR`, 404 |
| M4 | DELETE /api/messages/:messageId | author | – | 204; WS `message.deleted {id,channelId}` | 403, 404 |

Non-UUID path params return 404 (validated with zod, mapped to NOT_FOUND). Rate limits (env-configurable):
- Login and register: `RATE_LIMIT_LOGIN_MAX=10` per `RATE_LIMIT_LOGIN_WINDOW=1 minute`, keyed by IP.
- Message send: `RATE_LIMIT_MESSAGE_MAX=20` per 10 s, keyed by user id.

**WS protocol** (`GET /ws`, same origin, JSON frames `{type, data?}`):
- **Connect auth:** on upgrade, the server checks Origin (allowed if it equals the Host header or appears in ALLOWED_ORIGINS) and the `sid` cookie. If either is bad, it accepts and then immediately closes with **4401** (unauthorized) or **4403** (bad origin). Clients must not reconnect after a 4401; they redirect to login. On success the server sends `{type:"ready", data:{userId}}`, joins the socket to all of the user's guild rooms, and handles presence.
- **Client → server:**
  - `{type:"subscribe", data:{channelId}}` → `{type:"subscribed", data:{channelId}}`, or `{type:"error", data:{code:"FORBIDDEN"|"NOT_FOUND", channelId}}`. The client is subscribed to at most one channel; subscribing to a new channel automatically unsubscribes the previous one.
  - `{type:"unsubscribe", data:{channelId}}` → `unsubscribed`.
  - `{type:"ping"}` → `{type:"pong"}`.
  - Invalid JSON or schema gets `error` with `BAD_REQUEST`; the socket is not closed.
- **Server → client events:**
  - `message.created {message}`, `message.updated {message}`, `message.deleted {id, channelId}` go to the channel room.
  - `presence.update {guildId, userId, status:"online"|"offline"}` goes to the guild room on the user's first connect and last disconnect (counted across tabs).
  - `member.joined {guildId, member}`, `member.left {guildId, userId}`, `channel.created {channel}` go to the guild room.
- **Heartbeat:** the server pings every 30 s and terminates a socket after a missed pong.
- When a user leaves a guild, the hub removes their sockets from that guild's rooms and its channel rooms. Membership is checked again on subscribe.

## 4. Frontend
Routes:
- `/login`, `/register`: guests only; on success go to `?next=` or `/`.
- `/`: AppLayout. If there are no guilds, show an empty state with "Server erstellen".
- `/guilds/:guildId/channels/:channelId`
- `/invite/:code`
- `*`: not found.

AuthGate calls `GET /api/auth/me`. On 401 it redirects to `/login?next=<current path>`, so guests can't read.

Behaviours, with the required `data-testid` attributes:
- **Login/Register:** forms with `email`, `username`, `password` inputs and `login-submit`/`register-submit` buttons. Field errors are shown in `form-error`. Logout button is `logout-button`.
- **Layout (desktop):** three columns: ServerList (`guild-list`, items `guild-item-<id>`, `create-guild-button`), ChannelSidebar (`channel-list`, `channel-item-<name>`, `create-channel-button` for the owner only, `invite-link` showing `${origin}/invite/${code}` plus `copy-invite-button`, `leave-guild-button` for non-owners), and ChatView. MemberList (`member-list`, `member-<username>` with `data-online="true|false"`) is a fourth column at ≥1024px and hidden below that.
- **Mobile (≤768px):** only ChatView is visible. `mobile-menu-button` in the chat header opens the ServerList+ChannelSidebar as an overlay drawer (`mobile-drawer`). Picking a channel closes the drawer. Touch targets are at least 40px, and the textarea font is at least 16px so iOS doesn't zoom.
- **MessageList (`message-list`):**
  - Items are `message-<id>` with `message-author`, `message-content` (CSS `white-space: pre-wrap`, rendered as plain text), and `message-edited` "(bearbeitet)".
  - Opening a channel loads the latest 50 and scrolls to the bottom.
  - On a new message, it auto-scrolls if the user was within 120px of the bottom or authored the message. Otherwise it shows a "Neue Nachrichten ↓" pill (`new-messages-pill`).
  - "Ältere laden" button (`load-older`) at the top, shown only when `hasMore`. It fetches `before=<oldest id>`, prepends, and keeps the scroll position by restoring `scrollHeight` diffs.
  - Messages are deduplicated by id, so the REST response and the WS echo don't duplicate.
- **Composer (`composer-input` textarea, `composer-send` button):**
  - Enter (without Shift and not during IME composition) sends the trimmed text if it's non-empty, then clears the field.
  - Shift+Enter inserts a newline.
  - The field is disabled while sending. Over 2000 chars shows a counter and blocks sending. A 429 shows "Zu viele Nachrichten, bitte kurz warten".
- **Own messages:** hovering (always visible on touch) shows `message-edit` and `message-delete`.
  - Edit opens an inline textarea (`message-edit-input`): Enter saves (PATCH), Shift+Enter adds a newline, Escape cancels.
  - Delete shows an inline confirm with `message-delete-confirm` "Ja, löschen" and "Abbrechen". No `window.confirm`.
  - Other users' messages never show these controls.
- **Invite page:** if not logged in, redirect to `/login?next=/invite/:code`; the login and register pages keep the `next` link. Logged in, it shows the guild name, member count and `invite-accept` "Beitreten" (or "Öffnen" if already a member). After joining it navigates to the guild's first channel. An invalid code shows `invite-invalid`.
- **Realtime client / reconnect:**
  - One WebSocket per tab to `${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws`.
  - On close (other than 4401), it reconnects with backoff (500 ms × 2^n, max 10 s, jitter) and shows `connection-banner` "Verbindung getrennt – verbinde neu…".
  - On reconnect it re-subscribes to the active channel, refetches the latest page for that channel (merging by id), and refetches members and guilds. The banner then hides.
  - The `online` window event triggers an immediate reconnect attempt.
- **Guild events:** `channel.created`, `member.joined` and `member.left` update the store, and presence updates set the member dot.

## 5. Ordered implementation steps

**Phase 0: Setup**
1. Run `git init`. Create `.gitignore`, `.editorconfig`, `.nvmrc`, `.prettierrc.json`, root `package.json` and `pnpm-workspace.yaml`. Set `"packageManager": "pnpm@10.x"`.
2. Create `tsconfig.base.json`, a tsconfig per package and `eslint.config.js`. Scaffold the shared, backend, frontend and e2e packages.
3. Write `docker-compose.yml`, the Dockerfiles, `deploy/Caddyfile` and `scripts/setup-local-db.sh`. They can be placeholder-complete now and get finished in Phase 4.
4. Write `.env.example` and a first README. Run `pnpm install`, `pnpm lint`, `pnpm typecheck`, then make the first commit.

**Phase 1: Backend base**
5. Write `config.ts`, `db/schema.ts`, `drizzle.config.ts`. Run `db:generate` and commit the migration. Write `migrate.ts`.
6. Write the lib files: errors, password, tokens, validate, origin. Then the plugins: errorHandler, security (helmet, origin), auth (cookie session).
7. Add `routes/health`, then auth (A2–A5) with `auth.test.ts` and `password.test.ts`.
8. Add guilds and invites (G1–G5, I1–I2; create also makes `#general` and a random invite code), with `guilds.test.ts`.
9. Add channels (C1–C2), with `channels.test.ts`.
10. Add messages (M1–M4: cursor pagination, author-only edit and delete), with `messages.test.ts`.
11. Write `authorization.test.ts`: non-members get 403 on every guild, channel and message endpoint; unauthenticated requests get 401.

**Phase 2: Realtime**
12. Write `realtime/hub.ts` and `ws.route.ts`: cookie auth on upgrade, close 4401/4403, ready, subscribe/unsubscribe, heartbeat.
13. Wire the services to the hub: message create/edit/delete publish to the channel room; channel created, member joined and member left publish to the guild room.
14. Add presence: connection counts per user, broadcasts on the 0→1 and 1→0 transitions, and the `online` flag in G5.
15. Write `realtime.test.ts`.

**Phase 3: Frontend**
16. Write the Vite config with proxy, the API client, the auth store, Login/Register pages and AuthGate.
17. Build AppLayout, ServerList, ChannelSidebar, the create dialogs and routing.
18. Build MessageList (auto-scroll, Ältere laden), MessageItem (edit/delete own) and Composer (Enter/Shift+Enter).
19. Build the RealtimeClient with backoff, the ConnectionBanner and the store reducers. Add MemberList with presence.
20. Add the InvitePage and the `next` redirect.
21. Add the mobile CSS and drawer, then the frontend unit tests.

**Phase 4: Quality & release**
22. Add rate limits on login, register and message send (env-configurable), with `ratelimit.test.ts`.
23. Review all input against the zod schemas. Write `security.test.ts`: XSS payload stored verbatim and returned as JSON, helmet headers, bad origin, oversize content. Check the ESLint `react/no-danger` rule.
24. Error handling: the error handler, the frontend error toasts/inline errors, pino redaction, and request logging with reqId.
25. Write the Playwright config and all specs, and get the full e2e suite green.
26. Finish the Docker setup:
   - backend Dockerfile, caddy Dockerfile and Caddyfile with `tls internal` plus CSP: `default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`. CSP3 `'self'` covers same-origin wss in Chromium; also add `wss://{host}` explicitly using a Caddy placeholder.
   - Ports: `${HTTPS_PORT:-8443}:443`, `${HTTP_PORT:-8080}:80`. In compose, backend gets `COOKIE_SECURE=true` and `trustProxy`. The db has no published port and uses a named volume, and backend `depends_on db: service_healthy`.
   - Run `docker compose up --build -d` and verify.
27. Finish the README and do the DoD pass.

## 6. Requirements checklist (for the tester)
Abbreviations:
- **BT** = backend vitest file (`backend/test/…`)
- **FT** = frontend vitest (`frontend/src/__tests__/…`)
- **E2E** = Playwright spec (`e2e/tests/…`)
- **CMD** = shell command
- **INS** = inspection of code or files

**In Scope**
1. Registration with email and password: BT `auth.test.ts` "register → 201 + cookie, password_hash ≠ plaintext"; E2E `auth.spec.ts`.
2. Login with email and password: BT `auth.test.ts` "login ok / wrong pw 401 / unknown email 401 same message"; E2E `auth.spec.ts`.
3. Logout: BT "logout → 204, the old cookie then gets 401 on /me"; E2E logout ends on /login.
4. Create a server: BT `guilds.test.ts` "create → owner is a member, #general exists"; E2E via the UI in `realtime-chat.spec.ts`.
5. Join a server via invite link: BT "I1 preview, I2 join, idempotent, bad code 404"; E2E `invite-join.spec.ts`.
6. Leave a server: BT "leave → 204, afterwards 403 on channels; owner gets 409"; E2E or INS of the `leave-guild-button` flow (an optional step in `invite-join.spec.ts`).
7. Create and show text channels per server: BT `channels.test.ts` (owner 201, non-owner member 403, duplicate 409, listing); E2E creates a channel and both users see it (`channel.created`).
8. Send and show messages: BT `messages.test.ts` M2/M1; E2E `realtime-chat.spec.ts`.
9. Load older history: BT "60 messages: page 1 = 50 newest with hasMore=true, page 2 via before = 10 with hasMore=false, ascending, no overlap"; E2E `history-reload.spec.ts` clicks `load-older` and older messages appear.
10. Edit and delete own messages: BT (author 200/204, others 403, editedAt set); E2E `composer.spec.ts` and `realtime-chat.spec.ts` (the other window sees the update and the delete).
11. Realtime without reload: BT `realtime.test.ts`; E2E `realtime-chat.spec.ts`.
12. Presence online/offline per server: BT "B connects → A gets presence.update online; B closes → offline; two tabs only go offline after both close"; E2E `presence.spec.ts`.
13. Responsive web client: E2E `mobile.spec.ts` at 375×740 (drawer, send works, no horizontal scroll: `document.documentElement.scrollWidth <= innerWidth`).

**Non-functional**
14. Delivery under 300 ms on a local network: BT `realtime.test.ts` measures from the POST until the subscriber's WS receives it, for 20 messages, and asserts p95 < 300 ms. E2E asserts that B sees the text within 1 s of A pressing Enter, and logs the duration. The BT test is authoritative.
15. 100 concurrent users per instance: BT `realtime.test.ts` "100 users in one guild/channel": register 100 users via services (bulk), open 100 WS connections, send 1 message, all 100 receive it within 1 s, no errors. INS: no per-user blocking work, pg pool max=20.
16. Passwords only hashed (argon2/bcrypt): BT `password.test.ts` (hash starts with `$argon2id$`, verify true/false) plus a DB row check in `auth.test.ts`. INS: the password is never logged (redaction config).
17. No secrets in the repo, config via env: CMD `git ls-files | grep -E '(^|/)\.env$'` returns nothing; `.env.example` exists; INS `config.ts` reads only from `process.env`; CMD `git grep -nEi '(password|secret)\s*[:=]\s*["'\''][^"'\'']{6,}' -- ':!*.test.ts' ':!.env.example' ':!e2e' ':!docs'` finds nothing except the documented dev defaults in docker-compose, which come via `${VAR:-default}`. Compose takes `POSTGRES_PASSWORD` from `.env` (copied from `.env.example`).
18. Tests for auth and message logic: CMD `pnpm --filter @chat-mvp/backend test` is green and includes `auth.test.ts` and `messages.test.ts`.

**Phase 0**
19. Git repo with `.gitignore`: CMD `git -C /home/user/chat-mvp rev-parse --is-inside-work-tree`; `.gitignore` contains node_modules, dist and .env.
20. Monorepo with backend/, frontend/, shared/: INS `pnpm-workspace.yaml`; CMD `pnpm -r ls --depth -1` lists all of them.
21. TypeScript, ESLint, Prettier: CMD `pnpm typecheck`, `pnpm lint` and `pnpm format:check` all exit 0.
22. `docker-compose.yml` with PostgreSQL: INS service `db` is `postgres:16-alpine` with a healthcheck; CMD `docker compose config` is valid.
23. `.env.example` and README: files exist; the README covers setup, tests and docker compose.

**Phase 1**
24. DB schema and migrations: `backend/drizzle/*.sql` is committed; CMD `pnpm db:migrate` against a fresh DB exits 0 and `\dt` shows the 6 tables; running migrate a second time is a no-op.
25. Auth via session: BT `auth.test.ts` (cookie is httpOnly, SameSite=Lax, session row exists, expired session gets 401).
26. Guilds create/list/join/leave: BT `guilds.test.ts` (G1 lists only the user's own guilds).
27. Channels per guild: BT `channels.test.ts`.
28. Messages send, paginated load, edit, delete: BT `messages.test.ts`, including validation (empty or whitespace gives 400, 2001 chars gives 400, 2000 is OK, limit>100 gives 400).
29. Authorization, members only: BT `authorization.test.ts` covers non-members on G3, G5, C1, C2, M1, M2 (403) and M3/M4 by a non-author (403), plus unauthenticated requests to every protected route (401) and the WS subscribe of a non-member (error FORBIDDEN, no events received).
30. Tests for auth and messages: same as item 18.

**Phase 2**
31. WS with auth on connect: BT (no cookie closes with 4401, bad cookie closes with 4401, wrong Origin closes with 4403, valid cookie gets `ready`).
32. Rooms per channel: BT (a subscriber to channel X doesn't receive messages from channel Y; after unsubscribe, nothing arrives).
33. Events created/updated/deleted: BT (each event arrives with the correct payload shape).
34. Presence per guild: same as item 12, plus the G5 `online` flag; a user in another guild doesn't receive the presence event.

**Phase 3**
35. Login and registration: E2E `auth.spec.ts` (register, logout, login, wrong password shows `form-error`; a guest going to `/` is redirected to `/login`).
36. Layout with server list, channels and chat window: E2E checks `guild-list`, `channel-list` and `message-list` are visible on desktop at 1280×800.
37. Message list with auto-scroll: FT `MessageList.test.tsx` (scrolls when near the bottom, shows the pill when scrolled up); E2E `realtime-chat.spec.ts` sends 30 messages, the last one is in the viewport (`toBeInViewport`).
38. "Ältere laden": E2E `history-reload.spec.ts` (seed 60 messages via the API, only 50 shown, click → 60, the first message is visible). FT checks the scroll position is kept.
39. Enter sends, Shift+Enter newline: FT `Composer.test.tsx`; E2E `composer.spec.ts` (Shift+Enter then Enter produces one message with two lines; `innerText` contains `\n`).
40. Edit and delete own messages: E2E `composer.spec.ts` (edit shows "(bearbeitet)", delete removes it; another user's message has no `message-edit`); FT `MessageItem.test.tsx`.
41. Invite page: E2E `invite-join.spec.ts` (a logged-out user opens /invite/:code, gets redirected to login, registers, comes back to the invite, clicks Beitreten, sees the guild and channel; an invalid code shows `invite-invalid`).
42. Reconnect: FT `backoff.test.ts` (delays grow, capped at 10 s); E2E `reconnect.spec.ts` (`context.setOffline(true)` shows the banner; going online hides it within 15 s; a message sent by the other user while offline appears after reconnect via refetch).
43. Mobile layout: E2E `mobile.spec.ts`.

**Phase 4**
44. Rate limit on login: BT `ratelimit.test.ts` (with `RATE_LIMIT_LOGIN_MAX=10`, the 11th login in the window gets 429 `RATE_LIMITED` with a retry-after header).
45. Rate limit on sending: BT (with `RATE_LIMIT_MESSAGE_MAX=20`, the 21st message within 10 s gets 429; a different user is unaffected).
46. Input validation: shared FT/BT `schemas.test.ts` plus BT 400 responses with `details` (field paths) on every POST/PATCH; malformed JSON gets 400.
47. XSS protection: BT `security.test.ts` (content `<img src=x onerror=alert(1)>` is stored verbatim); E2E `composer.spec.ts` (sending `<b>x</b><img src=x onerror="window.__xss=1">` renders it as literal text, `page.evaluate(()=>window.__xss)` is undefined, and there is no `<b>` element inside `message-content`). CMD `grep -rn dangerouslySetInnerHTML frontend/src` finds nothing. BT checks API responses carry helmet headers (`x-content-type-options: nosniff`, CSP). In Docker, `curl -skI https://localhost:8443/` shows a `content-security-policy` header.
48. Error handling and logging: BT (an unknown route returns 404 JSON in the error shape; a forced 500, using a test-only route registered in the test app, returns `{error:{code:"INTERNAL"}}` with no stack); INS pino redact config; CMD `docker compose logs backend` shows JSON request logs.
49. E2E test with two clients: E2E `realtime-chat.spec.ts` uses two `browser.newContext()`.
50. Docker deployment with HTTPS: CMD `cp .env.example .env && docker compose up --build -d`, then `curl -sk https://localhost:8443/api/health` returns `{"status":"ok"}`; `curl -sk https://localhost:8443/` returns HTML containing "Chat-MVP"; a WSS check via a Node one-liner or the optional Playwright smoke test (`E2E_BASE_URL=https://localhost:8443 pnpm e2e:docker` with `ignoreHTTPSErrors`, running `realtime-chat.spec.ts` against Docker).

**Success criteria**
51. Two users chat in realtime in two windows: E2E `realtime-chat.spec.ts`. A registers, creates a guild and copies the invite. B registers and joins via the invite. Both open #general. A sends and B sees it without reload; B replies and A sees it.
52. A new user joins via invite link: E2E `invite-join.spec.ts`.
53. History survives a reload: E2E `history-reload.spec.ts` (send 3 messages, `page.reload()`, all 3 visible in order; also after logout and login).

**Definition of Done**
54. Runs locally via `docker compose up` and is described in the README: item 50 plus INS of the README "Deployment" section with exactly those commands.
55. Relevant tests are green: CMD `pnpm test` (shared + backend + frontend) and `pnpm e2e` both exit 0, along with lint, typecheck and format:check.
56. Success criteria met: items 51–53 green.

## 7. Exact commands
**One-time local DB setup** (`scripts/setup-local-db.sh`, run as root):
```
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "DO \$\$BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='chat') THEN CREATE ROLE chat LOGIN PASSWORD 'chat' CREATEDB; END IF; END\$\$;"
for db in chat_mvp_dev chat_mvp_test chat_mvp_e2e; do
  sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1 || sudo -u postgres createdb -O chat "$db"
done
```
This is a local-only dev password and is documented in `.env.example`.

**Env** (in `.env.example`, which root scripts load via `dotenv-cli` or explicit env):
```
DATABASE_URL=postgres://chat:chat@localhost:5432/chat_mvp_dev
TEST_DATABASE_URL=postgres://chat:chat@localhost:5432/chat_mvp_test
E2E_DATABASE_URL=postgres://chat:chat@localhost:5432/chat_mvp_e2e
PORT=3000  HOST=0.0.0.0  LOG_LEVEL=info  COOKIE_SECURE=false  SESSION_TTL_DAYS=30
ALLOWED_ORIGINS=http://localhost:5173
RATE_LIMIT_LOGIN_MAX=10  RATE_LIMIT_LOGIN_WINDOW_MS=60000  RATE_LIMIT_MESSAGE_MAX=20  RATE_LIMIT_MESSAGE_WINDOW_MS=10000
# docker compose:
POSTGRES_USER=chat  POSTGRES_PASSWORD=change-me  POSTGRES_DB=chat_mvp  SITE_ADDRESS=localhost  HTTPS_PORT=8443  HTTP_PORT=8080
```
Backend vitest sets `DATABASE_URL=$TEST_DATABASE_URL`, falling back to `postgres://chat:chat@localhost:5432/chat_mvp_test`. Playwright's webServer starts the backend with `DATABASE_URL=$E2E_DATABASE_URL` (same fallback), `RATE_LIMIT_LOGIN_MAX=1000` and `RATE_LIMIT_MESSAGE_MAX=1000`.

**Root `package.json` scripts:**
```
"lint": "eslint .",
"format": "prettier --write .",  "format:check": "prettier --check .",
"typecheck": "pnpm -r --parallel typecheck",            # each pkg: tsc --noEmit
"test": "pnpm -r --if-present test",                    # shared, backend (vitest run), frontend (vitest run)
"e2e": "pnpm --filter @chat-mvp/e2e test",              # playwright test
"dev": "pnpm -r --parallel dev",
"build": "pnpm -r --if-present build",
"db:migrate": "pnpm --filter @chat-mvp/backend db:migrate"
```

**Order to run:**
```
cd /home/user/chat-mvp
bash scripts/setup-local-db.sh
cp .env.example .env
pnpm install
pnpm lint && pnpm format:check && pnpm typecheck
pnpm test
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm e2e        # never run `playwright install`
docker compose up --build -d && docker compose ps
curl -sk https://localhost:8443/api/health
docker compose down
```
If the installed Chromium revision (1194) doesn't match the `@playwright/test` version, pin `@playwright/test` to the release that bundles chromium-1194 (1.56.x) or set `launchOptions.executablePath` to the Chromium in /opt/pw-browsers.

**Pitfalls to tell the coder about:**
- Don't publish the compose db port, because the host's PG already uses 5432.
- Backend vitest needs `fileParallelism: false` plus `TRUNCATE` in `beforeEach`.
- Rate-limit tests build the app with low limits passed through the config object, not global env.
- Enable `trustProxy` behind Caddy so rate limiting keys on the real client IP and the Secure cookie works.
- `pnpm.onlyBuiltDependencies` may need `esbuild` and `@node-rs/argon2` in the allowlist for pnpm 10.

### Critical Files for Implementation
- /home/user/chat-mvp/backend/src/db/schema.ts
- /home/user/chat-mvp/backend/src/app.ts
- /home/user/chat-mvp/backend/src/realtime/hub.ts and /home/user/chat-mvp/backend/src/realtime/ws.route.ts
- /home/user/chat-mvp/frontend/src/realtime/socket.ts and /home/user/chat-mvp/frontend/src/components/MessageList.tsx
- /home/user/chat-mvp/docker-compose.yml, /home/user/chat-mvp/deploy/Caddyfile and /home/user/chat-mvp/e2e/playwright.config.ts