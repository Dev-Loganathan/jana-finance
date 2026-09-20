# One image serves the API and the built web app. Used for the free dev/test host (Render, Koyeb, Fly...).
FROM node:22-bookworm-slim
ENV NODE_ENV=development CI=true
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY e2e/package.json e2e/
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .
RUN pnpm --filter @jana/shared build \
  && pnpm --filter @jana/api prisma:generate \
  && pnpm --filter @jana/api build \
  && pnpm --filter @jana/web build

ENV NODE_ENV=production WEB_DIST_DIR=/app/apps/web/dist API_PORT=3000
EXPOSE 3000
CMD ["bash", "scripts/start-prod.sh"]
