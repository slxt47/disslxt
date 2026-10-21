# Stage 1: build
FROM node:22-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY e2e/package.json e2e/
RUN pnpm install --frozen-lockfile --filter @disslxt/backend...
COPY tsconfig.base.json ./
COPY shared shared
COPY backend backend
RUN pnpm --filter @disslxt/backend build \
  && pnpm --filter @disslxt/backend deploy --prod --legacy /out

# Stage 2: runtime
FROM node:22-slim
ENV NODE_ENV=production
# ffmpeg converts voice messages to AAC/m4a (plays everywhere, incl. iOS Safari).
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data/uploads \
  && chown node:node /data/uploads
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /app/backend/dist ./dist
COPY --from=build /app/backend/drizzle ./drizzle
USER node
EXPOSE 3000
# Migrations run on boot (see src/server.ts).
CMD ["node", "dist/server.js"]
