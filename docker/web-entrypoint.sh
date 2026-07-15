#!/bin/sh
set -e

# MENTORS web entrypoint (spec 18): apply DB migrations, then start the
# Next.js standalone server. `migrate deploy` is idempotent — it only applies
# pending migrations and never generates/resets, so it is safe on every start.

echo "[entrypoint] prisma migrate deploy ..."
node ./node_modules/prisma/build/index.js migrate deploy

echo "[entrypoint] starting Next.js standalone on ${HOSTNAME}:${PORT} ..."
exec node server.js
