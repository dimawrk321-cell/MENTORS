#!/usr/bin/env bash
# MENTORS dev-stand — daily pg_dump with gzip + 14-day rotation (spec 11/18).
# Installed as a host cron (see README runbook); writes to /opt/mentors/backups.
set -euo pipefail
cd "$(dirname "$0")/.."   # -> /opt/mentors (this script lives in /opt/mentors/scripts)

BACKUP_DIR="/opt/mentors/backups"
COMPOSE=(docker compose --env-file .env.prod -f docker-compose.prod.yml)

mkdir -p "$BACKUP_DIR"
TS="$(date +%Y%m%d-%H%M)"
OUT="$BACKUP_DIR/mentors-$TS.sql.gz"

# POSTGRES_USER/DB are 'mentors' on this stand (see .env.prod).
"${COMPOSE[@]}" exec -T postgres pg_dump -U mentors -d mentors | gzip > "$OUT"

# Rotation: keep the 14 newest dumps, delete older.
ls -1t "$BACKUP_DIR"/mentors-*.sql.gz 2>/dev/null | tail -n +15 | xargs -r rm -f

echo "$(date -Is) backup ok: $OUT ($(du -h "$OUT" | cut -f1))"
