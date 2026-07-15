#!/usr/bin/env bash
# MENTORS dev-stand — one-command update on the server (spec 18 runbook).
# Pull latest main, rebuild the image, recreate services. Migrations run
# automatically in the web entrypoint (prisma migrate deploy) on start.
#
# Invoked from the laptop via scripts/deploy.ps1 over the tailnet, or directly:
#   cd /opt/mentors && bash deploy.sh
set -euo pipefail
cd "$(dirname "$0")"

COMPOSE=(docker compose --env-file .env.prod -f docker-compose.prod.yml)

if [ ! -f .env.prod ]; then
  echo "✗ .env.prod not found in $(pwd) — create it before deploying." >&2
  exit 1
fi

echo "→ git pull --ff-only"
git pull --ff-only

echo "→ build web image"
"${COMPOSE[@]}" build

echo "→ up -d (recreate changed services; web runs migrate deploy on start)"
"${COMPOSE[@]}" up -d

echo "→ waiting for web to become healthy ..."
for i in $(seq 1 30); do
  status="$("${COMPOSE[@]}" ps --format '{{.Service}} {{.Health}}' 2>/dev/null | awk '$1=="web"{print $2}')"
  if [ "$status" = "healthy" ]; then
    echo "  web is healthy."
    break
  fi
  sleep 3
done

echo "✓ deploy done. Services:"
"${COMPOSE[@]}" ps
