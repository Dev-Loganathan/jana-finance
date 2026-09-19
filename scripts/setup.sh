#!/usr/bin/env bash
# One-command local setup: env file with fresh secrets, dependencies, database, migrations, seed.
# Safe to re-run: it never overwrites an existing .env or an existing Super Admin.
set -euo pipefail
cd "$(dirname "$0")/.."

PNPM="pnpm"
command -v pnpm >/dev/null 2>&1 || PNPM="corepack pnpm"

if [ ! -f .env ]; then
  echo "Creating .env with freshly generated secrets"
  cp .env.example .env
  rand() { openssl rand -base64 "$1" | tr -d '\n/+='; }
  sed -i.bak \
    -e "s|^JWT_ACCESS_SECRET=.*|JWT_ACCESS_SECRET=$(rand 48)|" \
    -e "s|^JWT_REFRESH_SECRET=.*|JWT_REFRESH_SECRET=$(rand 48)|" \
    -e "s|^FIELD_ENCRYPTION_KEY=.*|FIELD_ENCRYPTION_KEY=$(rand 32)|" \
    -e "s|^BLIND_INDEX_KEY=.*|BLIND_INDEX_KEY=$(rand 32)|" .env
  rm -f .env.bak
fi

$PNPM install
docker compose up -d --wait db mailpit
$PNPM --filter @jana/shared build
$PNPM --filter @jana/api prisma:generate
$PNPM --filter @jana/api prisma:deploy
$PNPM --filter @jana/api prisma:seed

echo
echo "Done. Start the app with:  $PNPM dev"
echo "Web: http://localhost:5173   API: http://localhost:3000   API docs: http://localhost:3000/docs   Mail: http://localhost:8025"
