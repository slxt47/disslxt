# Deviations from docs/PLAN.md

Steps 1–15 plus the backend parts of steps 22–24.

1. **Root `test` script excludes e2e.** The plan has `"test": "pnpm -r --if-present test"`. The e2e
   package also has a `test` script (Playwright), so `pnpm test` would run Playwright as well, and
   it fails while there are no specs. The plan says `pnpm test` is shared + backend + frontend, so
   the script is now `pnpm -r --if-present --filter '!@chat-mvp/e2e' test`. Use `pnpm e2e` to run
   Playwright.
2. **`docs/` is in `.prettierignore`.** The spec and plan are inputs, so `pnpm format:check` does
   not reformat them.
3. **Tooling versions.** TypeScript is pinned to `~6.0` and ESLint to `^9`, because
   typescript-eslint 8 supports TS `<6.1` only and eslint-plugin-react-hooks needs ESLint ≤ 9.
   `@playwright/test` is pinned to `1.56.x`, which bundles chromium-1194 (see the plan's §7 note).
   zod is v4.
4. **Additional env vars:** `TRUST_PROXY` (the plan's "trustProxy" setting, which compose turns
   on) and `WS_HEARTBEAT_MS` (default 30000, so tests can shorten the heartbeat). The
   rate-limit window variables are named `*_WINDOW_MS`, as in plan §7.
5. **`docker-compose.yml` uses `${POSTGRES_PASSWORD:-change-me}`**, not a required variable, so
   `docker compose config` works without a `.env` file. The db port is still not published.
6. **Extra error codes:** `UNSUPPORTED_MEDIA_TYPE` (415, for non-JSON bodies, part of the "JSON
   only" CSRF rule), `PAYLOAD_TOO_LARGE` (413, body limit 64 KiB), `SERVICE_UNAVAILABLE` (503,
   health) and `BAD_REQUEST` (fallback).
7. **WebSocket details the plan left open:**
   - A connection with no `Origin` header is closed with 4403, because only an Origin that matches
     Host or ALLOWED_ORIGINS is allowed.
   - A socket also receives its own `presence.update`.
   - `POST /api/auth/logout` closes that session's open sockets with 4401.
8. **An empty body is accepted on JSON requests** (e.g. `POST /logout` sent with
   `content-type: application/json`), so clients can always send the JSON header.
9. **`pnpm db:migrate` and `pnpm dev` read `.env`** from the repo root (with Node's `util.parseEnv`,
   no `dotenv-cli` dependency) and do not override variables that are already set.
10. **Docker images were not built** in the first run (Docker Hub returned `429 Too Many Requests`).
    Resolved in the second run, see item 18.

## Second run: steps 16–21, frontend side of 23–24, 25–27

11. **Extra routes.** `/guilds/:guildId` exists and redirects to the guild's first channel; `/`
    redirects to the first guild when the user has one (otherwise it shows the empty state with
    "Server erstellen", `empty-create-guild`). Unknown guild/channel ids redirect to `/`.
12. **Extra `data-testid`s** beyond plan §4: `to-register`/`to-login` (auth page links that keep
    `?next=`), `current-user`, `guild-name`, `channel-title`, `guild-name-input`/
    `create-guild-submit`, `channel-name-input`/`create-channel-submit`, `empty-state`,
    `empty-create-guild`, `message-edit-cancel`/`message-edit-save`, `message-delete-cancel`,
    `message-error`, `composer-error`, `composer-counter`, `invite-guild-name`,
    `invite-member-count`, `leave-guild-confirm`, `drawer-backdrop`, `error-toast`, `loading`,
    `not-found`. `message-list` carries `data-subscribed="true|false"`.
13. **Subscription gap closed.** When the server confirms the WS `subscribe`, the chat view
    refetches the newest page once (merged by id). E2E specs wait for `data-subscribed="true"`
    before asserting realtime delivery.
14. **"Server verlassen" asks for an inline confirmation** (`leave-guild-confirm`), like message
    deletion. No `window.confirm`.
15. **Realtime client extras.** Besides the backoff/`online` handling from the plan, the client
    sends `ping` every 25 s and drops the socket when nothing arrives within 10 s, and the
    `offline` window event drops the socket immediately (so the banner shows at once). A refetch
    on reconnect also drops cached messages inside the refetched id range that no longer exist
    (deleted while offline).
16. **E2E setup details.** The backend web server is started with `tsx src/server.ts`
    (`NODE_ENV=test`, `HOST=127.0.0.1`), and the Vite proxy targets `127.0.0.1:3000` instead of
    `localhost:3000` (Node may resolve `localhost` to `::1`). Playwright starts the web servers
    before `globalSetup`, so the backend applies the migrations on boot and `global-setup.ts` only
    truncates the E2E tables; for that, `pg` is a devDependency of `@chat-mvp/e2e`. Vite's output
    is not piped into the Playwright log (it only shows harmless ws-proxy resets when contexts
    close). The desktop viewport is 1280×800 (plan item 36).
17. **`pnpm e2e:docker`** runs only the first `realtime-chat.spec.ts` test against
    `https://localhost:8443`: the second test sends 30 messages in a row, which the stack's default
    message rate limit (20 per 10 s) correctly rejects.
18. **Docker.** The backend service has a healthcheck (`/api/health`) and Caddy waits for it.
    The Caddyfile CSP uses `wss://{hostport}` rather than `wss://{host}` so the explicit source
    includes the port (8443); it also drops the `Server` header, sets long-lived caching for
    `/assets/*` and enables zstd. Verification environment: in this sandbox, containers cannot
    reach the npm registry (a TLS-intercepting proxy), so the `build` stages of both Dockerfiles
    could not run inside Docker. Their exact commands were run on the host and the results passed
    to `docker compose up --build -d` through an uncommitted override with
    `build.additional_contexts: {build: <dir>}`, which replaces the `build` stage; the runtime
    stages were built from the committed Dockerfiles unchanged. The committed files did not have
    to change for this.
19. **React Router v7 future flags** (`v7_startTransition`, `v7_relativeSplatPath`) are enabled to
    silence the v6 deprecation warnings.

## Third run: tester defects D1–D5

20. **D1 – newest page vs. cached history.** `applyLatestPage` keeps cached older messages only
    when the cache already holds the page's oldest message (cache and page are contiguous) and the
    page has `hasMore`; otherwise it drops them and takes the page's `hasMore`, so "Ältere laden"
    fetches the rest without a gap. Without `hasMore` the page reaches back to the channel start,
    so older cached messages are dropped as deleted. Re-opening a channel (ChatView mount) always
    replaces cached older messages (`{ replace: true }`), so edits/deletes made while the channel
    was not open do not survive either; already paged-in history of that channel is paged in again
    on demand. Remaining limit: after a short disconnect *without* a gap, edits/deletes of cached
    messages older than the newest page stay stale until the channel is opened again.
21. **D2 – WS hub cleanup.** A socket is removed from the hub by the `close` handler as soon as it
    is registered (not only after queued frames are drained); the heartbeat and the `onClose` hook
    remove clients right after `terminate()` (`removeClient` is idempotent).
22. **D3 – control characters.** Message content rejects C0 control characters except tab, LF and
    CR, and DEL (CR is allowed because API clients may send CRLF). Guild names reject all control
    characters (C0, DEL, C1), including newlines. Usernames, channel names and emails already
    rejected them through their regexes / email check (now covered by tests).
23. **D5 – one length definition.** `textLength()` in `@chat-mvp/shared` counts Unicode code points
    (`[...s].length`, like PostgreSQL's `char_length`). The message and guild-name schemas, the
    composer counter and the edit field use it. The guild-name input lost its HTML `maxLength`
    (which counts UTF-16 units); the schema check on submit enforces 100 characters instead.
24. **D4 – E2E ports.** Playwright starts its own backend on 3100 and Vite on 5174 (`vite.config.ts`
    takes the proxy target from `API_PROXY_TARGET`) with `reuseExistingServer: false`; ports can be
    overridden with `E2E_BACKEND_PORT` / `E2E_FRONTEND_PORT`. This supersedes the `127.0.0.1:3000`
    detail of item 16.
