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
10. **Docker images were not built** in this run. Docker Hub returned `429 Too Many Requests` when
    pulling `node:22-slim`. The Dockerfiles and Caddyfile are the plan-step-3 "placeholder-complete"
    versions and get verified in step 26.
