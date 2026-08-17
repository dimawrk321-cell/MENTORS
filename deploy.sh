#!/usr/bin/env bash
# MENTORS dev-stand — one-command update on the server (spec 18 runbook).
# Pull latest main, rebuild the image, recreate services. Migrations run
# automatically in the web entrypoint (prisma migrate deploy) on start.
#
# Invoked from the laptop via scripts/deploy.ps1 over the tailnet, or directly:
#   cd /opt/mentors && bash deploy.sh
#
# DEPLOY_CHECK_ONLY=1 runs the guards and the pull, prints the HEAD verdict and
# exits BEFORE the build — the way to verify the guards without deploying.
set -euo pipefail
cd "$(dirname "$0")"

COMPOSE=(docker compose --env-file .env.prod -f docker-compose.prod.yml)
# Deploys come off main only (handoff: «работа идёт в main напрямую, без веток»).
DEPLOY_BRANCH="main"
CHECK_ONLY="${DEPLOY_CHECK_ONLY:-0}"

# Loud enough to survive a screenful of docker build output.
banner() {
  echo
  echo "════════════════════════════════════════════════════════════"
  echo "  $1"
  echo "════════════════════════════════════════════════════════════"
}

# Everything on stderr, banner included: mixing the two streams interleaves the
# banner with the message and the failure stops reading as one block.
die() {
  {
    banner "✗ ДЕПЛОЙ ОСТАНОВЛЕН"
    echo "$1"
    echo
  } >&2
  exit 1
}

if [ ! -f .env.prod ]; then
  die ".env.prod не найден в $(pwd) — создайте его перед деплоем."
fi

# ── Guard 1 (walk A.3): the clone must sit on the deploy branch ──────────────
# On 14.08 the stand was left on codex/pilot-ux-p0-p1. Every deploy after that
# pulled THAT branch, printed «Already up to date», rebuilt the same code and
# exited 0 — a silent no-op that looked like a успешная выкатка. A branch
# mismatch is a hard failure now, and it fires before anything is built.
if ! current_branch="$(git symbolic-ref --quiet --short HEAD)"; then
  current_branch="(отсоединённый HEAD)"
fi
if [ "$current_branch" != "$DEPLOY_BRANCH" ]; then
  die "$(
    cat <<EOF
Клон $(pwd) стоит на «$current_branch», а деплой идёт только с «$DEPLOY_BRANCH».
Образ НЕ собран, контейнеры НЕ тронуты, стенд работает на прежней версии.

Починка:
  cd $(pwd) && git checkout $DEPLOY_BRANCH && bash deploy.sh
EOF
  )"
fi

# ── Guard 2 (walk A.3): say out loud whether the pull actually moved HEAD ────
head_before="$(git rev-parse HEAD)"
echo "→ git pull --ff-only (ветка $current_branch)"
git pull --ff-only
head_after="$(git rev-parse HEAD)"

if [ "$head_before" = "$head_after" ]; then
  banner "⚠  HEAD НЕ ИЗМЕНИЛСЯ — НОВОГО КОДА НЕТ"
  echo "  HEAD:  $(git log --oneline -1 "$head_after")"
  echo
  echo "  Сборка пойдёт из того же кода, что уже работает на стенде."
  echo "  Если вы ждали новый код — проверьте, что коммит запушен в"
  echo "  origin/$DEPLOY_BRANCH: git log --oneline origin/$DEPLOY_BRANCH -3"
else
  banner "✓ HEAD ОБНОВЛЁН: $(git rev-list --count "$head_before..$head_after") коммит(ов)"
  echo "  было:  $(git log --oneline -1 "$head_before")"
  echo "  стало: $(git log --oneline -1 "$head_after")"
fi

if [ "$CHECK_ONLY" = "1" ]; then
  banner "CHECK-ONLY: гарды пройдены, сборка и выкатка пропущены"
  exit 0
fi

echo
echo "→ build web image"
"${COMPOSE[@]}" build

# ── Guard 5 (walk B.2): the tools profile was never rebuilt ──────────────────
# `docker compose build` SILENTLY SKIPS services of inactive profiles, and the
# one-off `seed` service sits behind `--profile tools`. Its image was therefore
# frozen at the day the deploy contour was created (2026-07-15) while every
# deploy printed «✓ deploy done»: /app/scripts held five files, and — worse —
# /app/lib held month-old services. Any one-off script started through that
# image would have run OLD business logic against the CURRENT database.
# Same class of defect as the branch guard: the command succeeds and does not
# do what everyone assumes. The tools profile is built HERE, on its own line —
# `up -d` below deliberately stays without the profile so the seed container is
# never started as part of a deploy.
echo "→ build tools image (профиль tools: одноразовые скрипты и сид)"
"${COMPOSE[@]}" --profile tools build seed

echo "→ up -d (recreate changed services; web runs migrate deploy on start)"
"${COMPOSE[@]}" up -d

# ── Guard 3 (walk A.3): the health wait used to expire silently ──────────────
# The old loop just fell through after 30 attempts and the script still printed
# «✓ deploy done» and exited 0 — a failed migration in the entrypoint looked
# exactly like a successful deploy. It also only ever watched web: a
# crash-looping worker (cron jobs, Telegram bot) went through unnoticed.
wait_healthy() {
  local service="$1" attempts="$2" status
  echo "→ ждём healthy: $service (до $((attempts * 3))с)"
  for _ in $(seq 1 "$attempts"); do
    status="$("${COMPOSE[@]}" ps --format '{{.Service}} {{.Health}}' 2>/dev/null | awk -v s="$service" '$1==s{print $2}')"
    if [ "$status" = "healthy" ]; then
      echo "  $service healthy."
      return 0
    fi
    sleep 3
  done
  echo >&2
  echo "── последние строки лога $service ──" >&2
  "${COMPOSE[@]}" logs --tail 40 "$service" >&2 || true
  return 1
}

if ! wait_healthy web 30; then
  die "web не стал healthy за 90 секунд. Стенд может быть нерабочим — см. лог выше.
Частая причина: упал \`prisma migrate deploy\` в entrypoint."
fi

# worker: healthcheck has start_period 20s + interval 30s, so it needs longer.
if ! wait_healthy worker 40; then
  die "worker не стал healthy за 120 секунд. web поднялся, но джобы, стрики и
Telegram-бот не работают — см. лог выше."
fi

# ── Guard 4 (walk A.3): migrations applied == migrations in the repo ─────────
# This is the check that would have caught A.2 from the database side: the
# deploy reported success while the stand stayed one migration behind.
in_repo="$(find prisma/migrations -mindepth 1 -maxdepth 1 -type d | wc -l)"
applied="$("${COMPOSE[@]}" exec -T postgres \
  psql -U mentors -d mentors -qAt \
  -c "SELECT count(*) FROM _prisma_migrations WHERE rolled_back_at IS NULL;" 2>/dev/null | tr -d '[:space:]')"

if [ -z "$applied" ]; then
  echo "⚠  не удалось прочитать _prisma_migrations — сверку миграций пропускаю." >&2
elif [ "$applied" != "$in_repo" ]; then
  die "Миграции разошлись: в репозитории $in_repo, на стенде применено $applied.
Контейнеры подняты, но схема БД не соответствует коду."
else
  echo "  миграции: $applied из $in_repo применено."
fi

# ── Housekeeping (walk A.3): reclaim what a rebuild leaves behind ────────────
# Measured on the stand: dangling images reclaim ~0 — compose retags in place
# and leaves nothing untagged. The disk actually goes to the BuildKit cache
# (18.8G after a few deploys, 38G disk). So cap the cache instead of clearing
# it: --max-used-space keeps the newest entries, so the pnpm store and the
# node_modules layer survive and the next build stays incremental.
# Both prunes are best-effort — housekeeping must never fail a good deploy.
BUILD_CACHE_CAP="${DEPLOY_BUILD_CACHE_CAP:-8GB}"
echo "→ уборка: висячие образы + build cache до $BUILD_CACHE_CAP"
docker image prune -f || true
docker builder prune -f --max-used-space "$BUILD_CACHE_CAP" || true

banner "✓ ДЕПЛОЙ ЗАВЕРШЁН — $(git log --oneline -1 "$head_after")"
"${COMPOSE[@]}" ps
df -h / | awk 'NR==1 || /\//{print "  " $0}'
