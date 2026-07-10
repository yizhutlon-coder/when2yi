# syntax=docker/dockerfile:1
# Multi-stage build → tiny standalone runtime image.
# NOTE: better-sqlite3 is a native module; build on the SAME CPU arch you deploy on
# (RackNerd = linux/amd64). On Apple Silicon build with:  docker build --platform linux/amd64 .

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Prefer prebuilt better-sqlite3 binary (no compiler needed); fall back gracefully.
RUN npm ci

FROM node:22-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_PATH=/app/data/when2yi.db

# Run as an unprivileged user; own the data dir so SQLite can write.
RUN groupadd -g 1001 nodejs && useradd -u 1001 -g nodejs -m nextjs \
    && mkdir -p /app/data && chown -R nextjs:nodejs /app

# Standalone server bundle (traced deps incl. the better-sqlite3 binary) + assets.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node", "server.js"]
