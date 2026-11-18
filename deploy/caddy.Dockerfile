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
RUN pnpm install --frozen-lockfile --filter @disslxt/frontend...
COPY tsconfig.base.json ./
COPY shared shared
COPY frontend frontend
RUN pnpm --filter @disslxt/frontend build

# Stage 2: serve with Caddy
# Pinned by digest; apk upgrade pulls in Alpine security fixes the base image does not have yet (security check 2026-11-18)
FROM caddy:2.11.9-alpine@sha256:003a97808e781aa9f7e75cc2f43d34d461099031faf5e20faefb9f61126836f0
RUN apk upgrade --no-cache
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/frontend/dist /srv
