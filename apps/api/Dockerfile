# API платформы (NestJS). Контекст сборки — корень монорепозитория:
#   docker build -f apps/api/Dockerfile -t fsp-talent-api:local .
#
# Образ используется тремя сервисами compose: migrate (prisma migrate deploy), seed (демо-данные, только по явному запросу) и api.
# Секреты в образ не попадают: все настройки приходят из переменных окружения (см. .env.example).
ARG NODE_IMAGE=node:24.21.0-bookworm-slim

# ── Общая основа: libssl и pnpm нужной версии ──
# libssl должен быть установлен ДО pnpm install: по нему Prisma выбирает вариант движка миграций
# (debian-openssl-3.0.x); без него загрузился бы openssl-1.1.x, а во время выполнения скачать нужный не удалось бы.
FROM ${NODE_IMAGE} AS base
ENV CI=true
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g pnpm@10.34.6 --no-fund --no-audit
WORKDIR /app

# ── Манифесты: слой с зависимостями пересобирается только при их изменении ──
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY e2e/package.json e2e/package.json

# ── Сборка (с dev-зависимостями): prisma generate + nest build ──
FROM manifests AS build
RUN pnpm install --frozen-lockfile --filter "@fsp/api..."
COPY packages/config packages/config
COPY packages/contracts packages/contracts
COPY apps/api apps/api
RUN pnpm --filter @fsp/contracts build && pnpm --filter @fsp/api build

# ── Только production-зависимости ──
FROM manifests AS prod-deps
RUN pnpm install --frozen-lockfile --prod --filter "@fsp/api..."

# ── Итоговый образ ──
FROM ${NODE_IMAGE} AS runtime
# libssl нужен движку миграций Prisma (та же версия, что и при установке зависимостей); сертификаты — для TLS (SMTP, внешняя БД).
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    PORT=3001
WORKDIR /app/apps/api

COPY --from=prod-deps /app/node_modules /app/node_modules
COPY --from=prod-deps /app/apps/api/node_modules /app/apps/api/node_modules
COPY --from=build /app/packages/contracts/package.json /app/packages/contracts/package.json
COPY --from=build /app/packages/contracts/dist /app/packages/contracts/dist
COPY --from=build /app/apps/api/package.json /app/apps/api/prisma.config.ts ./
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/prisma ./prisma
COPY --from=build /app/apps/api/assets ./assets
# Синтетический реестр достижений для MockFspProvider (искомый путь: ../../data/fixtures относительно рабочего каталога).
COPY data/fixtures /app/data/fixtures

USER node
EXPOSE 3001
CMD ["node", "dist/src/main.js"]
