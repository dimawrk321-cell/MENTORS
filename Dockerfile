# syntax=docker/dockerfile:1

# MENTORS dev-stand image — multi-stage, Next.js standalone output (spec 18).
# Base pinned to Debian bookworm-slim (glibc): Prisma engines and the native
# deps (@node-rs/argon2, sharp) ship glibc prebuilts, which avoids the musl
# edge cases of Alpine. Builder and runner share the base so `native` Prisma
# binary targets and prebuilt .node addons match at runtime.

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# openssl + ca-certificates: required by Prisma engines (generate + runtime).
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

# --- deps: full install (dev deps are needed to build) ---
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  pnpm install --frozen-lockfile

# --- builder: prisma generate + next build (standalone) ---
FROM base AS builder
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS=--max-old-space-size=3072
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Generate the Prisma client against the real schema (deps stage had no schema).
RUN pnpm exec prisma generate
# A dummy DATABASE_URL so any build-time evaluation never dials a real DB;
# the runtime value comes from .env.prod and overrides this.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public"
RUN pnpm run build

# --- runner: standalone server + full node_modules (pnpm-safe Prisma) ---
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app

# Standalone server (server.js + pruned server .next) + client static + public.
# We copy the standalone root files explicitly and skip its bundled node_modules
# — the full node_modules below replaces it cleanly (no symlink/dir overlay).
# public/media/import holds the imported lesson images (spec 7.14).
COPY --from=builder /app/.next/standalone/server.js ./server.js
COPY --from=builder /app/.next/standalone/package.json ./package.json
COPY --from=builder /app/.next/standalone/.next ./.next
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Prisma schema + migrations for `prisma migrate deploy` on start (spec 18).
COPY --from=builder /app/prisma ./prisma

# DECISION (dev-stand): copy the FULL builder node_modules (pnpm store +
# symlinks) rather than the standalone-traced subset. Under pnpm, Next's
# standalone trace omits the Prisma query engine (.prisma/client lives deep in
# .pnpm/), so the runtime client would be missing. A full copy makes both the
# request-time client and the `prisma` migrate CLI reliably present. Slimming
# to prod-only deps is a stage-13 optimization.
COPY --from=builder /app/node_modules ./node_modules

COPY docker/web-entrypoint.sh /usr/local/bin/web-entrypoint.sh
RUN chmod +x /usr/local/bin/web-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/web-entrypoint.sh"]
