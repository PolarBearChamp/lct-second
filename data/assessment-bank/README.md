# Банк заданий

Версия банка: `bank-bbfda64da1` · семейств: 24 · пар «семейство × грейд»: 72 · минимум различающихся экземпляров на пару при 300 seed: **127**.

Файл сформирован `pnpm bank:manifest` (машинная форма — `manifest.json`). Определения семейств — код в `apps/api/src/domain/assessment/bank/`: экземпляр детерминированно строится из (семейство, версия, грейд, seed), публичная часть и закрытый ключ разделены, снимок экземпляра хранится в попытке и не зависит от последующих изменений банка.

## Frontend-разработчик

| Семейство | Версия | Группа | Навыки | Грейд | Различающихся экземпляров | Частей | Что меняется в грейде |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `fe.event-loop` — Порядок выполнения асинхронного кода | v1 | JavaScript/TypeScript и асинхронность | javascript, async-js | JUNIOR | 142 из 300 | 2 (ORDERING 1, NUMERIC 1) | Синхронный код, setTimeout(0) и Promise.then без вложенности. |
|  |  |  |  | MIDDLE | 298 из 300 | 2 (ORDERING 1, NUMERIC 1) | async/await, цепочки then, queueMicrotask, таймеры с разными задержками. |
|  |  |  |  | SENIOR | 299 из 300 | 2 (ORDERING 1, NUMERIC 1) | Вложенное планирование: микрозадачи из таймеров, таймеры из микрозадач, несколько await подряд. |
| `fe.promise-combinators` — Комбинаторы промисов и типы TypeScript | v1 | JavaScript/TypeScript и асинхронность | javascript, async-js, typescript | JUNIOR | 300 из 300 | 3 (SINGLE_CHOICE 2, NUMERIC 1) | Promise.all: первая ошибка по времени, время завершения, тип кортежа. |
|  |  |  |  | MIDDLE | 300 из 300 | 3 (MULTI_SELECT 1, NUMERIC 1, SINGLE_CHOICE 1) | race, any, allSettled при смешанных исходах; тип результата комбинатора. |
|  |  |  |  | SENIOR | 300 из 300 | 3 (NUMERIC 2, SINGLE_CHOICE 1) | Последовательный цикл с await против Promise.all при ошибке; сужение PromiseSettledResult. |
| `fe.ui-state` — Переходы состояния интерфейса (useReducer) | v1 | Состояние и поведение интерфейса | react, state-management | JUNIOR | 252 из 300 | 2 (SINGLE_CHOICE 1, NUMERIC 1) | Простой автомат статусов запроса: итоговый статус и переходы в loading. |
|  |  |  |  | MIDDLE | 283 из 300 | 2 (SINGLE_CHOICE 1, NUMERIC 1) | Защита от двойной отправки и повтор после ошибки: сколько запросов отправлено. |
|  |  |  |  | SENIOR | 299 из 300 | 2 (SINGLE_CHOICE 1, MULTI_SELECT 1) | Устаревшие ответы отсекаются по requestId: что отображается и какие события проигнорированы. |
| `fe.react-effects` — Эффекты, зависимости и замыкания в React | v1 | Состояние и поведение интерфейса | react, state-management | JUNIOR | 300 из 300 | 2 (NUMERIC 1, SINGLE_CHOICE 1) | Число запусков useEffect при разных массивах зависимостей. |
|  |  |  |  | MIDDLE | 237 из 300 | 2 (NUMERIC 1, SINGLE_CHOICE 1) | Устаревшее замыкание в setInterval, функциональное обновление состояния. |
|  |  |  |  | SENIOR | 300 из 300 | 2 (SINGLE_CHOICE 1, NUMERIC 1) | Гонка ответов при смене параметра, флаг отмены в cleanup. |
| `fe.http-client-errors` — Обработка ответов API на клиенте | v1 | HTTP/API и обработка ошибок клиента | http, error-handling | JUNIOR | 268 из 300 | 2 (MATCHING 1, SINGLE_CHOICE 1) | Реакция интерфейса на 401/403/404/422/409/429/500; fetch не отклоняет промис при HTTP-ошибке. |
|  |  |  |  | MIDDLE | 300 из 300 | 3 (MULTI_SELECT 1, NUMERIC 1, SINGLE_CHOICE 1) | Какие неудачные запросы можно повторять автоматически; ожидание по Retry-After. |
|  |  |  |  | SENIOR | 283 из 300 | 3 (NUMERIC 2, SINGLE_CHOICE 1) | Политика повторов: экспоненциальная задержка с ограничением, Retry-After, неповторяемые ошибки. |
| `fe.request-races` — Гонки запросов и отображение ошибок | v1 | HTTP/API и обработка ошибок клиента | http, error-handling, async-js, typescript | JUNIOR | 282 из 300 | 3 (SINGLE_CHOICE 3) | Поиск без защиты: побеждает ответ, пришедший последним; сужение discriminated union. |
|  |  |  |  | MIDDLE | 300 из 300 | 4 (NUMERIC 1, SINGLE_CHOICE 3) | Debounce: сколько запросов уйдёт; отмена предыдущих запросов через AbortController. |
|  |  |  |  | SENIOR | 300 из 300 | 3 (SINGLE_CHOICE 2, NUMERIC 1) | Ошибки отменённых запросов не показываются (AbortError); исчерпывающий switch с never. |

Проверяемые навыки (навык подтверждается, только если реально оценён ≥ 2 кейсами и результат ≥ 70):

* `async-js` (Асинхронность JS (event loop, Promise)) — `fe.event-loop`, `fe.promise-combinators`, `fe.request-races`
* `error-handling` (Обработка ошибок на клиенте) — `fe.http-client-errors`, `fe.request-races`
* `http` (HTTP) — `fe.http-client-errors`, `fe.request-races`
* `javascript` (JavaScript) — `fe.event-loop`, `fe.promise-combinators`
* `react` (React) — `fe.react-effects`, `fe.ui-state`
* `state-management` (Управление состоянием UI) — `fe.react-effects`, `fe.ui-state`
* `typescript` (TypeScript) — `fe.promise-combinators`, `fe.request-races`

## Backend-разработчик

| Семейство | Версия | Группа | Навыки | Грейд | Различающихся экземпляров | Частей | Что меняется в грейде |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `be.http-semantics` — Семантика HTTP: методы и коды ответа | v1 | API и обработка запросов | http, rest-api | JUNIOR | 300 из 300 | 2 (MATCHING 1, SINGLE_CHOICE 1) | Базовые коды (2xx/4xx) и выбор метода под операцию. |
|  |  |  |  | MIDDLE | 300 из 300 | 2 (MATCHING 1, MULTI_SELECT 1) | Асинхронная обработка, лимиты, неподдерживаемый метод; идемпотентность методов по RFC 9110. |
|  |  |  |  | SENIOR | 300 из 300 | 2 (MATCHING 1, SINGLE_CHOICE 1) | Условные запросы и согласование типов; решение об автоматическом повторе после таймаута. |
| `be.idempotency` — Повторные запросы и идемпотентность | v1 | API и обработка запросов | rest-api, http | JUNIOR | 300 из 300 | 2 (NUMERIC 1, SINGLE_CHOICE 1) | Повтор с тем же и с другим телом, запросы без ключа. |
|  |  |  |  | MIDDLE | 300 из 300 | 2 (NUMERIC 1, SINGLE_CHOICE 1) | Плюс истечение срока хранения ключа: повтор после срока создаёт запись заново. |
|  |  |  |  | SENIOR | 300 из 300 | 3 (NUMERIC 1, SINGLE_CHOICE 1, MULTI_SELECT 1) | Плюс параллельная обработка: запрос с ключом, который ещё обрабатывается, получает 409. |
| `be.sql-query-result` — Результат SQL-запроса | v1 | SQL и моделирование данных | sql | JUNIOR | 300 из 300 | 2 (NUMERIC 2) | JOIN, фильтры, GROUP BY/HAVING, агрегаты без NULL. |
|  |  |  |  | MIDDLE | 300 из 300 | 2 (NUMERIC 2) | LEFT JOIN и место условия (ON против WHERE), COUNT(столбец), AVG и сравнения с NULL. |
|  |  |  |  | SENIOR | 300 из 300 | 2 (NUMERIC 2) | NOT IN при NULL в подзапросе, NOT EXISTS, оконные функции, агрегаты с FILTER. |
| `be.data-modeling` — Моделирование данных и ограничения | v1 | SQL и моделирование данных | sql, postgresql | JUNIOR | 299 из 300 | 2 (MATCHING 1, SINGLE_CHOICE 1) | Правила → UNIQUE/CHECK/FK, тип связи сущностей. |
|  |  |  |  | MIDDLE | 300 из 300 | 2 (MATCHING 1, SINGLE_CHOICE 1) | Уникальность по выражению и частичный индекс; порядок столбцов составного индекса. |
|  |  |  |  | SENIOR | 300 из 300 | 2 (MATCHING 1, MULTI_SELECT 1) | EXCLUDE-ограничения; механизмы, удерживающие инвариант при конкурентных вставках. |
| `be.tx-isolation` — Конкурентные транзакции в PostgreSQL | v1 | Транзакции, конкурентность и надёжность | postgresql, transactions, concurrency | JUNIOR | 300 из 300 | 2 (NUMERIC 1, SINGLE_CHOICE 1) | Потерянное обновление, атомарный UPDATE и ожидание блокировки, откат транзакции. |
|  |  |  |  | MIDDLE | 299 из 300 | 2 (SINGLE_CHOICE 1, NUMERIC 1) | SELECT … FOR UPDATE, ошибка сериализации в REPEATABLE READ, перепроверка условия UPDATE после ожидания. |
|  |  |  |  | SENIOR | 300 из 300 | 2 (SINGLE_CHOICE 1, NUMERIC 1) | Write skew при REPEATABLE READ и SERIALIZABLE, взаимоблокировки и порядок захвата строк. |
| `be.reliability-patterns` — Надёжность: повторы, очереди и outbox | v1 | Транзакции, конкурентность и надёжность | concurrency, transactions, postgresql | JUNIOR | 299 из 300 | 3 (NUMERIC 1, MULTI_SELECT 1, SINGLE_CHOICE 1) | Экспоненциальная задержка с ограничением, выбор ошибок для повтора, атомарность транзакции при сбое. |
|  |  |  |  | MIDDLE | 246 из 300 | 2 (NUMERIC 1, SINGLE_CHOICE 1) | Очередь задач с FOR UPDATE SKIP LOCKED, падение воркера до COMMIT, гарантия «не менее одного раза». |
|  |  |  |  | SENIOR | 249 из 300 | 3 (NUMERIC 1, MULTI_SELECT 1, ORDERING 1) | Transactional outbox: повторная публикация после сбоя relay, свойства схемы, порядок шагов. |

Проверяемые навыки (навык подтверждается, только если реально оценён ≥ 2 кейсами и результат ≥ 70):

* `concurrency` (Конкурентность и надёжность) — `be.reliability-patterns`, `be.tx-isolation`
* `http` (HTTP) — `be.http-semantics`, `be.idempotency`
* `postgresql` (PostgreSQL) — `be.data-modeling`, `be.reliability-patterns`, `be.tx-isolation`
* `rest-api` (REST API) — `be.http-semantics`, `be.idempotency`
* `sql` (SQL) — `be.data-modeling`, `be.sql-query-result`
* `transactions` (Транзакции и уровни изоляции) — `be.reliability-patterns`, `be.tx-isolation`

## ML-инженер

| Семейство | Версия | Группа | Навыки | Грейд | Различающихся экземпляров | Частей | Что меняется в грейде |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `ml.leakage` — Утечки данных | v1 | Подготовка данных и утечки | data-preparation, scikit-learn, pandas, python | JUNIOR | 153 из 300 | 3 (MULTI_SELECT 1, SINGLE_CHOICE 2) | Явные утечки: обучение преобразований на всех данных, признаки из будущего, копия целевой переменной. |
|  |  |  |  | MIDDLE | 289 из 300 | 4 (MULTI_SELECT 1, ORDERING 1, SINGLE_CHOICE 2) | Target encoding и SMOTE до разбиения, пересечение групп; порядок шагов корректного пайплайна. |
|  |  |  |  | SENIOR | 299 из 300 | 3 (MULTI_SELECT 2, SINGLE_CHOICE 1) | Утечки в коде scikit-learn и pandas вне фолдов кросс-валидации, направление смещения оценки. |
| `ml.pandas-prep` — Подготовка признаков в pandas | v1 | Подготовка данных и утечки | pandas, data-preparation, python, scikit-learn | JUNIOR | 300 из 300 | 2 (NUMERIC 2) | dropna, fillna средним, drop_duplicates, сравнение с NaN. |
|  |  |  |  | MIDDLE | 300 из 300 | 2 (NUMERIC 2) | groupby + transform, медиана по группам, value_counts(normalize=True). |
|  |  |  |  | SENIOR | 300 из 300 | 2 (NUMERIC 2) | Размножение строк при merge, импутация только по train, pd.cut, count против size. |
| `ml.confusion-metrics` — Матрица ошибок и метрики классификации | v1 | Метрики и оценка моделей | ml-metrics, classification | JUNIOR | 300 из 300 | 3 (NUMERIC 2, SINGLE_CHOICE 1) | Precision и recall из TP/FP/FN/TN, выбор приоритетной метрики по цене ошибки. |
|  |  |  |  | MIDDLE | 300 из 300 | 4 (NUMERIC 3, SINGLE_CHOICE 1) | F1 и специфичность, macro-precision по матрице 3×3, micro-среднее и accuracy. |
|  |  |  |  | SENIOR | 300 из 300 | 4 (NUMERIC 2, SINGLE_CHOICE 2) | Precision и recall на заданном пороге по списку оценок, выбор порога с максимальным F1. |
| `ml.imbalance-metrics` — Метрики при дисбалансе и ранжирование | v1 | Метрики и оценка моделей | ml-metrics, classification | JUNIOR | 298 из 300 | 3 (NUMERIC 2, SINGLE_CHOICE 1) | Парадокс accuracy на редком классе; F1 по TP/FP/FN. |
|  |  |  |  | MIDDLE | 300 из 300 | 3 (NUMERIC 1, MULTI_SELECT 1, SINGLE_CHOICE 1) | ROC-AUC по парам объектов; инвариантность к монотонным преобразованиям оценок. |
|  |  |  |  | SENIOR | 127 из 300 | 3 (NUMERIC 2, SINGLE_CHOICE 1) | Precision при заданных TPR, FPR и распространённости; ложные срабатывания на большой выборке. |
| `ml.validation-schemes` — Схемы валидации и подсчёт обучений | v1 | Валидация, выбор модели и эксплуатационные сценарии | model-validation, scikit-learn | JUNIOR | 292 из 300 | 3 (NUMERIC 2, SINGLE_CHOICE 1) | Размер train в k-fold, число обучений в GridSearchCV, выбор разбиения под тип данных. |
|  |  |  |  | MIDDLE | 288 из 300 | 4 (NUMERIC 2, SINGLE_CHOICE 2) | TimeSeriesSplit: размеры train и test по фолдам; разбиение без утечки из будущего. |
|  |  |  |  | SENIOR | 277 из 300 | 3 (NUMERIC 1, SINGLE_CHOICE 1, MULTI_SELECT 1) | Вложенная кросс-валидация: число обучений, роль внешнего цикла; проверка утверждений о валидации. |
| `ml.model-ops` — Диагностика моделей и эксплуатация | v1 | Валидация, выбор модели и эксплуатационные сценарии | model-validation, classification | JUNIOR | 299 из 300 | 3 (MATCHING 1, SINGLE_CHOICE 2) | Диагностика недо- и переобучения по train/validation и выбор действия. |
|  |  |  |  | MIDDLE | 300 из 300 | 3 (NUMERIC 1, SINGLE_CHOICE 2) | Выбор порога по стоимости ошибок; сравнение моделей по CV с явным правилом значимости. |
|  |  |  |  | SENIOR | 299 из 300 | 3 (NUMERIC 1, SINGLE_CHOICE 1, MATCHING 1) | PSI для мониторинга, интерпретация по порогам, типы дрейфа, порядок безопасной выкатки. |

Проверяемые навыки (навык подтверждается, только если реально оценён ≥ 2 кейсами и результат ≥ 70):

* `classification` (Задачи классификации) — `ml.confusion-metrics`, `ml.imbalance-metrics`, `ml.model-ops`
* `data-preparation` (Подготовка данных) — `ml.leakage`, `ml.pandas-prep`
* `ml-metrics` (Метрики качества моделей) — `ml.confusion-metrics`, `ml.imbalance-metrics`
* `model-validation` (Валидация моделей) — `ml.model-ops`, `ml.validation-schemes`
* `pandas` (pandas) — `ml.leakage`, `ml.pandas-prep`
* `python` (Python) — `ml.leakage`, `ml.pandas-prep`
* `scikit-learn` (scikit-learn) — `ml.leakage`, `ml.pandas-prep`, `ml.validation-schemes`

## Инженер по ручному тестированию (Manual QA)

| Семейство | Версия | Группа | Навыки | Грейд | Различающихся экземпляров | Частей | Что меняется в грейде |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `qa.requirement-defects` — Анализ требований: дефекты и трассируемость | v1 | Анализ требований | requirements-analysis, test-design | JUNIOR | 300 из 300 | 3 (MATCHING 1, NUMERIC 1, SINGLE_CHOICE 1) | Классификация отдельных требований по заданным определениям дефектов. |
|  |  |  |  | MIDDLE | 300 из 300 | 3 (SINGLE_CHOICE 1, MULTI_SELECT 1, NUMERIC 1) | Противоречие между двумя требованиями, подсчёт пропущенных категорий, отбор требований на уточнение. |
|  |  |  |  | SENIOR | 300 из 300 | 3 (NUMERIC 2, MULTI_SELECT 1) | Трассируемость: транзитивное влияние изменения требования на тесты и пробелы покрытия. |
| `qa.decision-tables` — Комбинации условий и таблицы решений | v1 | Анализ требований | requirements-analysis, test-design | JUNIOR | 300 из 300 | 3 (NUMERIC 2, SINGLE_CHOICE 1) | Правила «если … иначе» на трёх условиях: число комбинаций с результатом и результат для заданной комбинации. |
|  |  |  |  | MIDDLE | 300 из 300 | 3 (NUMERIC 1, SINGLE_CHOICE 2) | Четыре условия, затенённое правило, которое никогда не сработает. |
|  |  |  |  | SENIOR | 300 из 300 | 3 (NUMERIC 3) | Независимые правила с безразличными значениями: пробелы, конфликты и минимальный набор проверок. |
| `qa.boundary-values` — Граничные значения и классы эквивалентности | v1 | Границы и классы эквивалентности | boundary-testing, test-design | JUNIOR | 299 из 300 | 3 (MULTI_SELECT 1, NUMERIC 1, SINGLE_CHOICE 1) | Перевод «больше / не менее / менее / не более» в допустимый интервал; двухзначный анализ границ. |
|  |  |  |  | MIDDLE | 300 из 300 | 3 (NUMERIC 1, MULTI_SELECT 1, SINGLE_CHOICE 1) | Тарифные диапазоны: число уникальных значений трёхзначного анализа; результат на границе классов. |
|  |  |  |  | SENIOR | 300 из 300 | 3 (SINGLE_CHOICE 2, NUMERIC 1) | Десятичная точность, период с включёнными датами, число тестов robust BVA для нескольких полей. |
| `qa.minimal-suite` — Минимально достаточный набор проверок | v2 | Границы и классы эквивалентности | test-design, test-prioritization, boundary-testing | JUNIOR | 300 из 300 | 3 (NUMERIC 2, SINGLE_CHOICE 1) | Полный перебор, покрытие каждого значения (классов эквивалентности), выбор техники сокращения. |
|  |  |  |  | MIDDLE | 300 из 300 | 4 (NUMERIC 3, SINGLE_CHOICE 1) | Попарное покрытие: непокрытые пары, нижняя оценка набора, лучший тест; классы эквивалентности с одним недопустимым значением на тест. |
|  |  |  |  | SENIOR | 300 из 300 | 4 (NUMERIC 3, ORDERING 1) | Минимальный набор для покрытия функций, порядок запуска по риску за минуту, ограничение по времени; классы эквивалентности. |
| `qa.severity-priority` — Критичность и приоритет дефектов | v2 | Тест-кейсы, дефекты и приоритизация | bug-reporting, test-prioritization | JUNIOR | 240 из 300 | 3 (MATCHING 1, NUMERIC 1, SINGLE_CHOICE 1) | Критичность по техническому влиянию; число дефектов, блокирующих релиз по критичности. |
|  |  |  |  | MIDDLE | 300 из 300 | 3 (MATCHING 1, ORDERING 1, SINGLE_CHOICE 1) | Приоритет по бизнес-контексту; порядок исправления; различие осей severity и priority. |
|  |  |  |  | SENIOR | 300 из 300 | 3 (NUMERIC 2, SINGLE_CHOICE 1) | Правила выпуска: блокирующие дефекты, минимальное число исправлений, дефекты с несовпадающими осями. |
| `qa.test-cases` — Тест-кейсы и отчёты о дефектах | v1 | Тест-кейсы, дефекты и приоритизация | bug-reporting, test-design | JUNIOR | 270 из 300 | 3 (SINGLE_CHOICE 1, NUMERIC 1, ORDERING 1) | Обязательные поля и шаги воспроизведения, выбор лучшего отчёта о дефекте. |
|  |  |  |  | MIDDLE | 300 из 300 | 4 (MATCHING 1, NUMERIC 2, SINGLE_CHOICE 1) | Ожидаемые коды ответа API при приоритете проверок; непокрытые тестами коды. |
|  |  |  |  | SENIOR | 300 из 300 | 3 (SINGLE_CHOICE 2, NUMERIC 1) | Условие дефекта по таблице запусков, число окружений полного перебора, информативный заголовок отчёта. |

Проверяемые навыки (навык подтверждается, только если реально оценён ≥ 2 кейсами и результат ≥ 70):

* `boundary-testing` (Граничные значения и классы эквивалентности) — `qa.boundary-values`, `qa.minimal-suite`
* `bug-reporting` (Баг-репорты, severity и priority) — `qa.severity-priority`, `qa.test-cases`
* `requirements-analysis` (Анализ требований) — `qa.decision-tables`, `qa.requirement-defects`
* `test-design` (Тест-дизайн) — `qa.boundary-values`, `qa.decision-tables`, `qa.minimal-suite`, `qa.requirement-defects`, `qa.test-cases`
* `test-prioritization` (Приоритизация проверок) — `qa.minimal-suite`, `qa.severity-priority`

