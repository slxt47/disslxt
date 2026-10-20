# Stage 1: build the frontend
FROM node:22-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY shared/package.json shared/
COPY frontend/package.json frontend/
COPY backend/package.json backend/
COPY e2e/package.json e2e/
RUN pnpm install --frozen-lockfile --filter @chat-mvp/frontend...
COPY tsconfig.base.json ./
COPY shared shared
COPY frontend frontend
RUN pnpm --filter @chat-mvp/frontend build

# Stage 2: serve with Caddy
FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/frontend/dist /srv
