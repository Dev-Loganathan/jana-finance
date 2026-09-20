#!/usr/bin/env bash
# Container start: apply migrations, make sure the roles and Super Admin exist, then run the server.
# Every step is idempotent, so restarts and redeploys are safe.
set -euo pipefail
cd "$(dirname "$0")/../apps/api"

npx prisma migrate deploy
npx ts-node --transpile-only prisma/seed.ts
# Break-glass for hosts without a shell (Render free plan): set RESET_SUPERADMIN=true, redeploy, sign in with
# SEED_SUPERADMIN_PASSWORD, then REMOVE the variable (otherwise every restart resets the account again).
if [ "${RESET_SUPERADMIN:-false}" = "true" ]; then
  npx ts-node --transpile-only prisma/reset-superadmin.ts
fi
if [ "${SEED_DEMO:-false}" = "true" ]; then
  # Demo data is a convenience: if it fails (slow host, timeouts) the server must still start. It is idempotent,
  # so the next restart picks up where it left off.
  npx ts-node --transpile-only prisma/seed-demo.ts || echo "WARNING: demo data did not finish loading; starting anyway"
fi
exec node dist/main.js
