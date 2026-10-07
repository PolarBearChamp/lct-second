# ФСП Таланты — платформа обратного подбора ИТ-специалистов (MVP)

Работодатель описывает **потребность** в специалисте — платформа находит кандидатов с **подтверждённой тестом квалификацией**,
объясняет подбор и позволяет отправить предложение с обязательной зарплатной вилкой без публикации вакансии. Контакты кандидата
раскрываются только той компании, чьё приглашение он принял или на чью вакансию он сам откликнулся. Достижения ФСП — дополнительное преимущество, а не условие доступа.

> **Статус.** Прототип для технической демонстрации. Все данные синтетические, интеграция с ФСП — демонстрационная, внешние AI/LLM API
> не используются. Прототип **не** проверялся на соответствие законодательству о персональных данных и **не** готов к промышленной эксплуатации;
> точность оценки квалификации на реальных людях не доказана (см. [ограничения](#ограничения)).

Что внутри: четыре специализации (Frontend, Backend, ML-инженер, Manual QA) × три грейда; банк параметризованных заданий
(24 семейства, 72 пары «семейство × грейд») с закрытыми серверными ключами; подбор с жёсткими условиями, формулой
`70·предпочтения + 25·качество теста + 5·ФСП` и объяснением; сохранённые подборки и закладки; приглашения с атомарными переходами
статусов; **публикация вакансий и самостоятельные отклики кандидатов**, **загрузка PDF-резюме с автораспознаванием**, **регулярные короткие задания работодателей** и **адаптивная вёрстка для телефона** (дополнительно по ТЗ); единый презентер профиля для JSON и PDF; MockFspProvider; воспроизводимый seed (114 кандидатов, 4 компании, 8 вакансий, 12 откликов, 8 заданий и 8 ответов на них).

## Быстрый запуск

Требования: Node.js 24 (`.nvmrc`; `engines`: `>=24.11 <25`), pnpm 10.34.6 (`corepack enable`), Docker с Compose v2.

### Вариант A. Разработка на хосте (PostgreSQL и почта в Docker)

```bash
corepack enable
pnpm install
cp .env.example .env            # PowerShell: Copy-Item .env.example .env
pnpm infra:up                   # PostgreSQL (127.0.0.1:5433) и Mailpit (SMTP :1025, интерфейс http://localhost:8025)
pnpm db:migrate                 # применить миграции (prisma migrate deploy)
pnpm db:seed                    # демонстрационные данные (идемпотентно)
pnpm dev                        # web http://localhost:3000, API http://localhost:3001
```

Продуктовая сборка на хосте: `pnpm build && pnpm start`.

### Вариант B. Всё в контейнерах (web, api, postgres, mailpit)

```bash
cp .env.example .env
# Обязательно замените SESSION_SECRET в .env случайным значением (в production пример из .env.example отвергается):
#   openssl rand -hex 32        (PowerShell: -join ((1..32) | % { '{0:x2}' -f (Get-Random -Maximum 256) }))
docker compose --profile local up -d --build   # postgres → migrate (одноразово) → api → web; mailpit
docker compose --profile seed run --rm seed    # демонстрационные данные (по желанию)
```

Приложение — `http://localhost:3000`, письма — Mailpit `http://localhost:8025`, документация API — `http://localhost:3001/api/docs`
(JSON — `/api/docs/openapi.json`). Порты postgres, mailpit и API привязаны к `127.0.0.1`; интерфейс Mailpit нельзя выставлять публично.
Данные хранятся в томе `postgres-data` и переживают перезапуск; миграции выполняет одноразовый сервис `migrate` до старта API
(`db push` не используется). Сброс демо-данных: `docker compose --profile seed run --rm seed node dist/scripts/seed.js --reset`.

Внешний запуск использует настоящий SMTP (`DOCKER_SMTP_HOST`, `SMTP_*`) и HTTPS-прокси (`SESSION_COOKIE_SECURE=true`, `APP_ORIGIN=https://…`);
профиль `local` и Mailpit для этого не нужны. Публикация приложения не выполнялась.

## Демонстрационные учётные записи

Пароль всех демо-аккаунтов — `Demo-Password-2026` (меняется `SEED_DEMO_PASSWORD`). Подробный сценарий на 5–7 минут — [docs/demo-script.md](docs/demo-script.md).

| Роль | Логин | Особенность |
|---|---|---|
| Кандидат | `anna.demidova@demo.example` | Backend Middle, привязан ФСП, входящее приглашение от «Демо Финтех» |
| Кандидат | `ready.candidate@demo.example` | профиль готов, теста ещё нет |
| Кандидат | `failed.candidate@demo.example` | неуспех Middle, пересдача закрыта с датой, Junior доступен |
| Кандидат | `{fe,be,ml,qa}.{junior,middle,senior}.{01…08}@demo.example` | 96 основных кандидатов с подтверждёнными категориями |
| Работодатель | `hr.fintech@demo.example`, `hr.retail@demo.example`, `hr.industry@demo.example`, `hr.edu@demo.example` | четыре вымышленные компании, 9 потребностей |

Новые аккаунты регистрируются в интерфейсе; письмо с подтверждением приходит в Mailpit.

## Конфигурация

Все переменные — в [.env.example](.env.example) (без секретов). Приложение проверяет конфигурацию при старте и выводит понятную ошибку.

| Переменная | Назначение |
|---|---|
| `DATABASE_URL`, `TEST_DATABASE_URL` | PostgreSQL для запуска на хосте и для интеграционных тестов (`fsp_test` создаётся init-скриптом) |
| `APP_ORIGIN` | origin веб-приложения: проверка `Origin` (CSRF), ссылки в письмах |
| `API_INTERNAL_URL` | внутренний адрес API для проксирования `/api/v1` в Next.js (при сборке; в Docker — build-аргумент) |
| `SESSION_SECRET` | секрет подписи CSRF (≥ 32 символов, **обязателен**); в production пример из `.env.example` отвергается |
| `SESSION_COOKIE_NAME`, `SESSION_TTL_HOURS`, `SESSION_COOKIE_SECURE` | серверные сессии; `Secure` включён по умолчанию в production |
| `SMTP_*`, `MAIL_FROM`, `EMAIL_VERIFICATION_TTL_HOURS`, `DOCKER_SMTP_HOST/PORT` | почта (локально — Mailpit); в контейнерах адрес SMTP задают `DOCKER_SMTP_*` |
| `FSP_PROVIDER` | режим интеграции ФСП (`mock`) |
| `ASSESSMENT_POLICY_VERSION`, `MATCHING_FORMULA_VERSION`, `INVITATION_POLICY_VERSION` | версии политик (пороги, формула, срок приглашения) |
| `SWAGGER_ENABLED`, `LOG_LEVEL`, `TRUST_PROXY` | документация API, журнал, доверенные прокси |
| `SEED_DEMO_PASSWORD` | пароль демо-аккаунтов (пусто — значение по умолчанию) |

## Команды

| Команда | Что делает |
|---|---|
| `pnpm install` | установка зависимостей |
| `pnpm dev` / `pnpm build` / `pnpm start` | разработка (web + api) / сборка contracts, api, web / запуск собранного |
| `pnpm lint`, `pnpm typecheck` | ESLint и проверка типов всех пакетов |
| `pnpm test` | unit-тесты API (Jest) |
| `pnpm test:integration` | интеграционные тесты API на реальной PostgreSQL (БД `fsp_test`, требуется `pnpm infra:up`) |
| `pnpm test:e2e` | сквозные тесты Playwright против запущенного стенда (см. ниже) |
| `pnpm db:migrate`, `pnpm db:seed` | миграции и демо-данные (`pnpm --filter @fsp/api db:seed:reset` — пересоздать) |
| `pnpm bank:manifest` | манифест банка заданий (`data/assessment-bank`) |
| `pnpm validate:quality` | проверка качества подбора и тестирования → `docs/validation-results.{json,md}` |
| `pnpm openapi:export` | экспорт контракта API → `docs/openapi.json` |
| `pnpm docs:export` | единый документ `docs/submission.md` → PDF и DOCX в `docs/export/` (нужен Chromium Playwright) |
| `pnpm load:test` | короткий нагрузочный прогон основных операций через web-прокси (`--base`, `--levels`, `--duration`); результаты — в [docs/implementation-status.md](docs/implementation-status.md) |
| `pnpm infra:up` / `pnpm infra:down` | PostgreSQL и Mailpit в Docker |

### Сквозные тесты

```bash
pnpm --filter @fsp/e2e install-browsers   # один раз: Chromium для Playwright
pnpm build && pnpm start                  # или pnpm dev; pnpm infra:up и pnpm db:migrate уже выполнены
pnpm test:e2e
```

Перед прогоном `global-setup` удаляет аккаунты прошлых прогонов (`@e2e.example`) и пересоздаёт демо-данные (`apps/api/dist/scripts/seed.js --reset`; нужна
сборка API; `E2E_SKIP_SEED=1` пропускает). Правильные ответы для прохождения теста тест берёт из БД стенда через помощник `e2e/helpers/db.ts`; в API
такой конечной точки нет, защитные механизмы (CSRF, ограничение частоты) не отключаются. Против Docker-стенда: `E2E_BASE_URL`, `E2E_MAILPIT_URL`,
`DATABASE_URL`, `E2E_SKIP_SEED=1`. Ограничение частоты регистрации (10 в час с одного адреса) хранится в памяти API: полный прогон (9 файлов сценариев) тратит 8 регистраций,
поэтому перед каждым следующим полным прогоном перезапускайте API.

## Структура репозитория

```text
apps/api            NestJS: modules/ (контроллеры, сервисы), domain/ (чистая логика), prisma/, scripts/, test/
apps/web            Next.js: страницы кандидата и работодателя, клиент API
packages/contracts  общие типы и перечисления (без ключей проверки)
packages/config     общие tsconfig и ESLint
data/               банк заданий (манифест), фикстуры ФСП, разметка валидации
e2e                 сквозные тесты Playwright
docs/               документация, openapi.json, результаты валидации
scripts/            экспорт документации в PDF/DOCX
docker/, docker-compose.yml, apps/*/Dockerfile
```

## Документация

| Документ | Содержание |
|---|---|
| [docs/submission.md](docs/submission.md) | единый документ для сдачи (экспортируется в PDF/DOCX) |
| [docs/architecture.md](docs/architecture.md) | компоненты, модули, модель данных, ключевые потоки |
| [docs/assessment.md](docs/assessment.md) | банк, оценка, политика грейдов и пересдач, защита от повторов |
| [docs/matching.md](docs/matching.md) | фильтры, формула, объяснения, baseline |
| [docs/privacy.md](docs/privacy.md) | матрица доступа, PDF, доступ к контактам, журналы |
| [docs/fsp-integration.md](docs/fsp-integration.md) | mock-контракт, демонстрационный статус, будущие OIDC/API |
| [docs/assumptions.md](docs/assumptions.md) | допущения, вопросы к организаторам, где менять решения |
| [docs/validation-results.md](docs/validation-results.md) | результаты проверки качества (создаются `pnpm validate:quality`) |
| [docs/requirements-matrix.md](docs/requirements-matrix.md) | требования → функции, экраны, проверки |
| [docs/implementation-status.md](docs/implementation-status.md) | что выполнено и проверено, что нет, известные ограничения |
| [docs/demo-script.md](docs/demo-script.md), [docs/presentation-outline.md](docs/presentation-outline.md) | демонстрация и план презентации |
| [docs/openapi.json](docs/openapi.json) | контракт API (89 операций) |

## Зоны ответственности двух разработчиков

| Зона | Разработчик 1: кандидат + тестирование | Разработчик 2: работодатель + подбор + приглашения |
|---|---|---|
| API | `candidate-profiles`, `assessments`, `fsp`, `catalogs` (опрос) | `companies`, `hiring-needs`, `matching`, `invitations`, `profile-pdf` |
| Доменная логика | `domain/assessment/*`, `domain/candidate/*`, `domain/catalog/*` | `domain/matching/*`, `domain/invitations/*` |
| Интерфейс | `apps/web/src/app/candidate/*` | `apps/web/src/app/employer/*`, `components/employer/*` |
| Проверки | `assessments`, `fsp` интеграционные, `controls`/банк, E2E 1, 4, 5 | `matching`, `invitations`, `privacy`, E2E 2, 3 |

Общие и согласуемые в коде части: схема БД и миграции, контракт `packages/contracts`, авторизация и сессии (`modules/auth`), единый презентер профиля
(`domain/privacy/profile-view.ts`), политики (`config/policies.ts`), OpenAPI. Две несовместимые реализации общих сущностей не создавались.

## Ограничения

* **Данные и закон.** Данные синтетические; согласие и ролевой доступ не доказывают соответствие законодательству о персональных данных.
* **Качество оценки.** Пороги и состав банка — рабочие допущения команды, не откалиброванные на реальных людях. Результаты валидации получены на
  синтетической авторской разметке; они проверяют внутреннюю согласованность, а не точность грейдинга ([docs/validation-results.md](docs/validation-results.md)).
* **ФСП.** Только демонстрационный провайдер; реального API, OIDC и согласованного контракта нет ([docs/fsp-integration.md](docs/fsp-integration.md)).
* **Масштаб.** Ограничение частоты запросов в памяти одного процесса; ранжирование выполняется в backend после SQL-фильтрации.
* **Не реализовано:** восстановление пароля, проверка компаний и защита от фиктивных предложений, ATS, несколько
  сотрудников в компании, удаление данных по запросу, внешний (публичный) стенд.
* **Резюме.** Распознавание — правила и словари без ML; только PDF с текстовым слоем (сканы, OCR не поддерживаются); проверено на синтетических и шести ручных резюме, а не на реальных PDF из Word/Google Docs ([docs/validation-results.md](docs/validation-results.md), раздел 3). Результат — предложения: применяет их кандидат; навыки и грейд остаются самоописанием.
* **Короткие задания.** Не меняют подтверждённый грейд и подбор; предлагаются не чаще раза в неделю; нет уведомлений о новых заданиях и защиты от злоупотреблений, кроме лимита 10 активных заданий на компанию.
* **Мобильная вёрстка.** Проверена автоматически эмуляцией телефона (390 и 320 px) в Chromium на отсутствие горизонтального переполнения и работоспособность основных действий; реальные устройства, Safari и Firefox не проверялись.
* Коды ФСП одноразовые: для повторной демонстрации пересоздайте демо-данные.
