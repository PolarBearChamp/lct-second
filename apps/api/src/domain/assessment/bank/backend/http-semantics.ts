import type { GradeCode } from '../../../catalog/catalog';
import type { AuthoredPart, FamilyDefinition } from '../../types';
import { opt, text } from '../helpers';

/**
 * B1. Семантика HTTP: методы и коды ответа.
 * Junior — базовое соответствие ситуаций и кодов, выбор метода для операции.
 * Middle — асинхронная обработка, лимиты, неподдерживаемые методы; идемпотентность методов.
 * Senior — условные запросы (ETag/If-Match), согласование типов; безопасность автоматического повтора.
 */

interface Resource {
  key: string;
  one: string;
  plural: string;
  field: string;
}

const RESOURCES: Resource[] = [
  { key: 'orders', one: 'заказ', plural: 'orders', field: 'deliveryAddress' },
  { key: 'invoices', one: 'счёт', plural: 'invoices', field: 'amount' },
  { key: 'bookings', one: 'бронирование', plural: 'bookings', field: 'startsAt' },
  { key: 'tickets', one: 'обращение', plural: 'tickets', field: 'subject' },
  { key: 'documents', one: 'документ', plural: 'documents', field: 'title' },
  { key: 'subscriptions', one: 'подписка', plural: 'subscriptions', field: 'planId' },
  { key: 'shipments', one: 'отправление', plural: 'shipments', field: 'weightKg' },
];

interface Scenario {
  key: string;
  code: number;
  grades: GradeCode[];
  text: (r: Resource) => string;
}

const SCENARIOS: Scenario[] = [
  { key: 'created', code: 201, grades: ['JUNIOR', 'MIDDLE'], text: (r) => `POST /${r.plural}: создан новый объект «${r.one}», в ответе — его представление и заголовок Location` },
  { key: 'deleted', code: 204, grades: ['JUNIOR', 'MIDDLE', 'SENIOR'], text: (r) => `DELETE /${r.plural}/{id}: ресурс удалён, тело ответа пустое` },
  { key: 'unprocessable', code: 422, grades: ['JUNIOR', 'MIDDLE', 'SENIOR'], text: (r) => `POST /${r.plural}: JSON корректен, но поле ${r.field} не проходит бизнес-валидацию` },
  { key: 'malformed', code: 400, grades: ['JUNIOR', 'MIDDLE'], text: (r) => `POST /${r.plural}: тело запроса невозможно разобрать как JSON` },
  { key: 'notfound', code: 404, grades: ['JUNIOR', 'MIDDLE'], text: (r) => `GET /${r.plural}/{id}: объекта с таким id не существует` },
  { key: 'unauth', code: 401, grades: ['JUNIOR', 'MIDDLE', 'SENIOR'], text: () => 'Запрос пришёл без токена доступа' },
  { key: 'forbidden', code: 403, grades: ['JUNIOR', 'MIDDLE', 'SENIOR'], text: (r) => `Пользователь с ролью «наблюдатель» пытается удалить объект «${r.one}» своей организации` },
  { key: 'conflict', code: 409, grades: ['JUNIOR', 'MIDDLE', 'SENIOR'], text: (r) => `POST /${r.plural}: объект «${r.one}» с таким внешним номером уже существует (уникальное поле)` },
  { key: 'accepted', code: 202, grades: ['MIDDLE', 'SENIOR'], text: (r) => `POST /${r.plural}/export: выгрузка поставлена в очередь, клиенту возвращена ссылка для проверки статуса` },
  { key: 'ratelimited', code: 429, grades: ['MIDDLE', 'SENIOR'], text: () => 'Клиент превысил лимит запросов; сервер просит повторить через 30 секунд (Retry-After)' },
  { key: 'method', code: 405, grades: ['MIDDLE', 'SENIOR'], text: (r) => `PATCH /${r.plural}/{id}: ресурс поддерживает только GET и PUT` },
  { key: 'precondition', code: 412, grades: ['SENIOR'], text: (r) => `PUT /${r.plural}/{id} с If-Match: "v7", а текущая версия ресурса — "v8"` },
  { key: 'mediatype', code: 415, grades: ['SENIOR'], text: (r) => `POST /${r.plural} с Content-Type: text/xml; API принимает только application/json` },
  { key: 'notmodified', code: 304, grades: ['SENIOR'], text: (r) => `GET /${r.plural}/{id} с If-None-Match, ETag ресурса не изменился` },
];

const STATUS_LABELS: Record<number, string> = {
  200: '200 OK',
  201: '201 Created',
  202: '202 Accepted',
  204: '204 No Content',
  304: '304 Not Modified',
  400: '400 Bad Request',
  401: '401 Unauthorized',
  403: '403 Forbidden',
  404: '404 Not Found',
  405: '405 Method Not Allowed',
  409: '409 Conflict',
  412: '412 Precondition Failed',
  415: '415 Unsupported Media Type',
  422: '422 Unprocessable Content',
  429: '429 Too Many Requests',
  500: '500 Internal Server Error',
  503: '503 Service Unavailable',
};

// Junior: выбор метода для операции.
const OPERATIONS = [
  { key: 'list', text: (r: Resource) => `получить список (${r.plural}) с фильтрацией`, method: 'GET' },
  { key: 'create', text: (r: Resource) => `создать новый объект «${r.one}», идентификатор назначает сервер`, method: 'POST' },
  { key: 'replace', text: (r: Resource) => `полностью заменить объект «${r.one}» с известным id новым представлением`, method: 'PUT' },
  { key: 'partial', text: (r: Resource) => `изменить только одно поле существующего объекта «${r.one}», не передавая остальные`, method: 'PATCH' },
  { key: 'delete', text: (r: Resource) => `удалить объект «${r.one}» по id`, method: 'DELETE' },
] as const;

const METHODS = ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE', 'POST', 'PATCH'] as const;
const IDEMPOTENT = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']);

// Senior: можно ли повторить запрос после таймаута.
const RETRY_CASES = [
  { key: 'put', text: (r: Resource) => `PUT /${r.plural}/42 с полным представлением объекта`, verdict: 'idempotent' },
  { key: 'post-nokey', text: (r: Resource) => `POST /${r.plural} без заголовка Idempotency-Key`, verdict: 'unsafe' },
  { key: 'post-key', text: (r: Resource) => `POST /${r.plural} с Idempotency-Key; сервер хранит ключи и результаты 24 часа`, verdict: 'key' },
  { key: 'patch-inc', text: (r: Resource) => `PATCH /${r.plural}/42 с телом {"op": "increment", "field": "version"}`, verdict: 'unsafe' },
  { key: 'delete', text: (r: Resource) => `DELETE /${r.plural}/42`, verdict: 'idempotent' },
] as const;

interface Params {
  resource: string;
  scenarios: string[];
  distractorCodes: number[];
  operation?: string;
  methods?: string[];
  retryCase?: string;
}

const resourceOf = (key: string) => RESOURCES.find((r) => r.key === key)!;

export const httpSemanticsFamily: FamilyDefinition<Params> = {
  id: 'be.http-semantics',
  version: 1,
  specialization: 'BACKEND',
  group: 'BE_API',
  title: 'Семантика HTTP: методы и коды ответа',
  description: 'Сопоставление ситуаций API с кодами ответа и выбор семантики методов.',
  supportedGrades: ['JUNIOR', 'MIDDLE', 'SENIOR'],
  skillTags: ['http', 'rest-api'],
  gradeNotes: {
    JUNIOR: 'Базовые коды (2xx/4xx) и выбор метода под операцию.',
    MIDDLE: 'Асинхронная обработка, лимиты, неподдерживаемый метод; идемпотентность методов по RFC 9110.',
    SENIOR: 'Условные запросы и согласование типов; решение об автоматическом повторе после таймаута.',
  },
  sample(rng, grade) {
    const resource = rng.pick(RESOURCES).key;
    const pool = SCENARIOS.filter((s) => s.grades.includes(grade));
    // Сценарии с разными кодами, чтобы соответствие было однозначным.
    const picked: Scenario[] = [];
    for (const scenario of rng.shuffle(pool)) {
      if (picked.length === 4) break;
      if (!picked.some((p) => p.code === scenario.code)) picked.push(scenario);
    }
    const used = new Set(picked.map((p) => p.code));
    const distractorPool = Object.keys(STATUS_LABELS).map(Number).filter((c) => !used.has(c));
    const params: Params = {
      resource,
      scenarios: picked.map((p) => p.key),
      distractorCodes: rng.sample(distractorPool, 2).sort((a, b) => a - b),
    };
    if (grade === 'JUNIOR') params.operation = rng.pick(OPERATIONS).key;
    if (grade === 'MIDDLE') {
      // 5 методов: хотя бы один неидемпотентный и хотя бы один идемпотентный.
      let methods: string[] = [];
      do methods = rng.sample(METHODS, 5);
      while (methods.every((m) => IDEMPOTENT.has(m)) || methods.every((m) => !IDEMPOTENT.has(m)));
      params.methods = methods.sort();
    }
    if (grade === 'SENIOR') params.retryCase = rng.pick(RETRY_CASES).key;
    return params;
  },
  canonical(params) {
    return { ...params, scenarios: [...params.scenarios].sort() };
  },
  complexity(params) {
    return params.scenarios.length + (params.methods ? 2 : 1);
  },
  build(params, grade) {
    const r = resourceOf(params.resource);
    const scenarios = params.scenarios.map((key) => SCENARIOS.find((s) => s.key === key)!);
    const codes = [...new Set([...scenarios.map((s) => s.code), ...params.distractorCodes])].sort((a, b) => a - b);
    const parts: AuthoredPart[] = [
      {
        id: 'p1',
        format: 'MATCHING',
        prompt: 'Сопоставьте каждую ситуацию с кодом ответа, который должен вернуть сервер.',
        left: scenarios.map((s) => opt(s.key, s.text(r))),
        right: codes.map((c) => opt(`c${c}`, STATUS_LABELS[c])),
        correct: Object.fromEntries(scenarios.map((s) => [s.key, `c${s.code}`])),
        skillTags: ['http', 'rest-api'],
      },
    ];

    if (grade === 'JUNIOR') {
      const operation = OPERATIONS.find((o) => o.key === params.operation)!;
      parts.push({
        id: 'p2',
        format: 'SINGLE_CHOICE',
        prompt: `Какой HTTP-метод следует использовать, чтобы ${operation.text(r)}?`,
        options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => opt(m, m)),
        correct: operation.method,
        skillTags: ['rest-api'],
      });
    } else if (grade === 'MIDDLE') {
      const methods = params.methods!;
      parts.push({
        id: 'p2',
        format: 'MULTI_SELECT',
        prompt: 'Отметьте методы, которые по спецификации HTTP (RFC 9110) являются идемпотентными.',
        options: methods.map((m) => opt(m, m)),
        correct: methods.filter((m) => IDEMPOTENT.has(m)),
        skillTags: ['http'],
      });
    } else {
      const retry = RETRY_CASES.find((c) => c.key === params.retryCase)!;
      parts.push({
        id: 'p2',
        format: 'SINGLE_CHOICE',
        prompt: `Клиент отправил ${retry.text(r)} и не получил ответ из-за таймаута сети. Можно ли автоматически повторить запрос без риска повторного побочного эффекта?`,
        options: [
          opt('idempotent', 'Да: метод идемпотентен, повтор приведёт к тому же состоянию'),
          opt('key', 'Да: повтор с тем же ключом вернёт сохранённый результат, не создавая дубликат'),
          opt('unsafe', 'Нет: повтор может применить операцию повторно'),
          opt('never', 'Нет: спецификация запрещает повтор любых методов, кроме GET'),
        ],
        correct: retry.verdict,
        skillTags: ['http', 'rest-api'],
      });
    }

    return {
      title: `HTTP API ресурса «${r.plural}»`,
      context: [
        text(
          `Вы проектируете REST API сервиса, который управляет сущностью «${r.one}» (/${r.plural}). ` +
            'Соглашение API: 400 — тело запроса не разбирается; 422 — данные синтаксически корректны, но нарушают правила; ' +
            '403 — пользователь аутентифицирован, но его роль не позволяет действие.',
        ),
      ],
      parts,
    };
  },
};
