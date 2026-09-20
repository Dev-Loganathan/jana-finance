#!/usr/bin/env bash
# Container start: apply migrations, make sure the roles and Super Admin exist, then run the server.
# Every step is idempotent, so restarts and redeploys are safe.
set -euo pipefail
cd "$(dirname "$0")/../apps/api"

npx prisma migrate deploy
npx ts-node --transpile-only prisma/seed.ts
if [ "${SEED_DEMO:-false}" = "true" ]; then
  npx ts-node --transpile-only prisma/seed-demo.ts
fi
exec node dist/main.js
