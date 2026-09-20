#!/usr/bin/env bash
# Container start: apply migrations, make sure the roles and Super Admin exist, then run the server.
# Every step is idempotent, so restarts and redeploys are safe.
set -euo pipefail
cd "$(dirname "$0")/../apps/api"

npx prisma migrate deploy
npx ts-node --transpile-only prisma/seed.ts
if [ "${SEED_DEMO:-false}" = "true" ]; then
  # Demo data is a convenience: if it fails (slow host, timeouts) the server must still start. It is idempotent,
  # so the next restart picks up where it left off.
  npx ts-node --transpile-only prisma/seed-demo.ts || echo "WARNING: demo data did not finish loading; starting anyway"
fi
exec node dist/main.js
