#!/usr/bin/env bash
# Container start: apply migrations, make sure the roles and Super Admin exist, then run the server.
# Every step is idempotent, so restarts and redeploys are safe.
set -euo pipefail
cd "$(dirname "$0")/../apps/api"

npx prisma migrate deploy
npx ts-node --transpile-only prisma/seed.ts
# Break-glass for hosts without a shell (Render free plan): set RESET_SUPERADMIN to any word (e.g. "unlock1") and
# redeploy. It is applied ONCE per value, so leaving it set is harmless when the host sleeps and wakes the app. To reset
# again, change the value. Then sign in with SEED_SUPERADMIN_PASSWORD and set a new password and 2FA.
if [ -n "${RESET_SUPERADMIN:-}" ] && [ "${RESET_SUPERADMIN}" != "false" ]; then
  RESET_TOKEN="${RESET_SUPERADMIN}" npx ts-node --transpile-only prisma/reset-superadmin.ts
fi
if [ "${SEED_DEMO:-false}" = "true" ]; then
  # Demo data is a convenience: if it fails (slow host, timeouts) the server must still start. It is idempotent,
  # so the next restart picks up where it left off.
  npx ts-node --transpile-only prisma/seed-demo.ts || echo "WARNING: demo data did not finish loading; starting anyway"
fi
exec node dist/main.js
