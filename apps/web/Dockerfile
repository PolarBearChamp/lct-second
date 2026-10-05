# Web-интерфейс (Next.js, standalone). Контекст сборки — корень монорепозитория:
#   docker build -f apps/web/Dockerfile --build-arg API_INTERNAL_URL=http://api:3001 -t fsp-talent-web:local .
#
# Браузер обращается к /api/v1 на том же origin, Next.js проксирует запросы во внутренний API. Адрес API
# «запекается» в сборку (rewrites сериализуются в standalone-сервер), поэтому передаётся build-аргументом.
ARG NODE_IMAGE=node:24.21.0-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV CI=true NEXT_TELEMETRY_DISABLED=1
RUN npm install -g pnpm@10.34.6 --no-fund --no-audit
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY e2e/package.json e2e/package.json
RUN pnpm install --frozen-lockfile --filter "@fsp/web..."
COPY packages/config packages/config
COPY packages/contracts packages/contracts
COPY apps/web apps/web
ARG API_INTERNAL_URL=http://api:3001
ENV API_INTERNAL_URL=${API_INTERNAL_URL}
RUN pnpm --filter @fsp/contracts build && pnpm --filter @fsp/web build

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
# outputFileTracingRoot — корень монорепозитория, поэтому сервер лежит в apps/web/server.js.
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
