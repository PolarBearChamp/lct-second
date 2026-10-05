import type { GradeCode } from '../../../catalog/catalog';
import type { AuthoredPart, FamilyDefinition, Rng } from '../../types';
import { code, list, opt, table, text } from '../helpers';

/**
 * F5. Обработка ответов API на клиенте.
 * Junior — реакция интерфейса на коды ответа; fetch не отклоняет промис при HTTP-ошибке.
 * Middle — какие неудачные запросы можно повторять автоматически; ожидание по Retry-After.
 * Senior — политика повторов с экспоненциальной задержкой, Retry-After и неповторяемыми ошибками.
 */

const REACTIONS: Record<string, string> = {
  login: 'Отправить на экран входа: сессия недействительна',
  forbidden: 'Показать «Недостаточно прав» без повтора',
  notfound: 'Показать состояние «Не найдено»',
  fields: 'Подсветить ошибки в полях формы',
  conflict: 'Сообщить о конфликте и предложить обновить данные',
  wait: 'Подождать время из Retry-After и повторить',
  generic: 'Показать общее сообщение об ошибке и кнопку «Повторить»',
  ignore: 'Ничего не делать: ответ успешный',
  reload: 'Перезагрузить страницу целиком',
};

const STATUS_REACTION: Array<{ status: number; reaction: string }> = [
  { status: 401, reaction: 'login' },
  { status: 403, reaction: 'forbidden' },
  { status: 404, reaction: 'notfound' },
  { status: 422, reaction: 'fields' },
  { status: 409, reaction: 'conflict' },
  { status: 429, reaction: 'wait' },
  { status: 500, reaction: 'generic' },
];

const FETCH_CASES = [
  { key: '404-json', describe: 'Сервер ответил 404 с JSON-телом {"message": "Заказ не найден"}', outcome: 'render' },
  { key: '500-html', describe: 'Сервер ответил 500 с HTML-страницей ошибки (не JSON)', outcome: 'catch' },
  { key: 'offline', describe: 'Сеть недоступна: запрос не дошёл до сервера', outcome: 'catch' },
  { key: '422-json', describe: 'Сервер ответил 422 с JSON-телом {"errors": {...}}', outcome: 'render' },
] as const;

const RETRY_POOL = [
  { key: 'get-503', label: 'GET /orders → 503', retry: true },
  { key: 'put-502', label: 'PUT /profile (полная замена) → 502', retry: true },
  { key: 'delete-503', label: 'DELETE /cart/items/5 → 503', retry: true },
  { key: 'post-key-504', label: 'POST /payments с Idempotency-Key → 504', retry: true },
  { key: 'get-429', label: 'GET /search → 429 с Retry-After: 2', retry: true },
  { key: 'post-nokey-504', label: 'POST /payments без Idempotency-Key → 504', retry: false },
  { key: 'get-404', label: 'GET /orders/9 → 404', retry: false },
  { key: 'patch-422', label: 'PATCH /profile → 422', retry: false },
  { key: 'post-409', label: 'POST /orders → 409', retry: false },
  { key: 'get-401', label: 'GET /me → 401', retry: false },
];

interface SeniorResponse {
  status: number;
  retryAfter: number | null;
}

interface Params {
  statuses?: number[];
  distractors?: string[];
  fetchCase?: string;
  retryKeys?: string[];
  retryAfters?: number[];
  base?: number;
  cap?: number;
  maxAttempts?: number;
  responses?: SeniorResponse[];
}

/** Модель политики повторов Senior: возвращает суммарное ожидание, число запросов и итог. */
export function runRetryPolicy(responses: SeniorResponse[], base: number, cap: number, maxAttempts: number) {
  let waited = 0;
  let requests = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = responses[attempt - 1] ?? { status: 200, retryAfter: null };
    requests += 1;
    if (response.status < 400) return { waited, requests, outcome: 'success' as const, finalStatus: response.status };
    const retryable = response.status === 429 || response.status === 503 || response.status === 502;
    if (!retryable || attempt === maxAttempts) return { waited, requests, outcome: 'error' as const, finalStatus: response.status };
    waited += response.retryAfter !== null ? response.retryAfter * 1000 : Math.min(base * 2 ** (attempt - 1), cap);
  }
  return { waited, requests, outcome: 'error' as const, finalStatus: 0 };
}

function sample(rng: Rng, grade: GradeCode): Params {
  if (grade === 'JUNIOR') {
    const picked = rng.sample(STATUS_REACTION, 4);
    const used = new Set(picked.map((p) => p.reaction));
    const distractors = rng.sample(Object.keys(REACTIONS).filter((r) => !used.has(r)), 2).sort();
    return { statuses: picked.map((p) => p.status).sort(), distractors, fetchCase: rng.pick(FETCH_CASES).key };
  }
  if (grade === 'MIDDLE') {
    let keys: string[];
    do keys = rng.sample(RETRY_POOL.map((r) => r.key), 5);
    while (keys.every((k) => RETRY_POOL.find((r) => r.key === k)!.retry) || keys.every((k) => !RETRY_POOL.find((r) => r.key === k)!.retry));
    return { retryKeys: keys.sort(), retryAfters: Array.from({ length: rng.int(2, 3) }, () => rng.int(1, 5)), fetchCase: rng.pick(FETCH_CASES).key };
  }
  for (let guard = 0; guard < 200; guard += 1) {
    const maxAttempts = rng.int(4, 5);
    const responses: SeniorResponse[] = [];
    for (let i = 0; i < maxAttempts; i += 1) {
      const kind = rng.pick(['503', '503', '429', '502', '200', '400'] as const);
      if (kind === '429') responses.push({ status: 429, retryAfter: rng.int(1, 3) });
      else responses.push({ status: Number(kind), retryAfter: null });
      if (kind === '200' || kind === '400') break;
    }
    const base = rng.pick([200, 300, 500]);
    const cap = rng.pick([1000, 1500, 2000]);
    const result = runRetryPolicy(responses, base, cap, maxAttempts);
    if (result.requests >= 3) return { base, cap, maxAttempts, responses };
  }
  throw new Error('fe.http-client-errors: генерация не удалась');
}

export const httpClientErrorsFamily: FamilyDefinition<Params> = {
  id: 'fe.http-client-errors',
  version: 1,
  specialization: 'FRONTEND',
  group: 'FE_HTTP_ERRORS',
  title: 'Обработка ответов API на клиенте',
  description: 'Реакция интерфейса на коды ответа, поведение fetch, безопасные повторы и политика ожидания.',
  supportedGrades: ['JUNIOR', 'MIDDLE', 'SENIOR'],
  skillTags: ['http', 'error-handling'],
  gradeNotes: {
    JUNIOR: 'Реакция интерфейса на 401/403/404/422/409/429/500; fetch не отклоняет промис при HTTP-ошибке.',
    MIDDLE: 'Какие неудачные запросы можно повторять автоматически; ожидание по Retry-After.',
    SENIOR: 'Политика повторов: экспоненциальная задержка с ограничением, Retry-After, неповторяемые ошибки.',
  },
  sample,
  complexity(params) {
    return (params.statuses?.length ?? 0) + (params.retryKeys?.length ?? 0) + (params.responses?.length ?? 0) * 2;
  },
  build(params, grade) {
    const parts: AuthoredPart[] = [];
    const fetchCase = FETCH_CASES.find((c) => c.key === params.fetchCase);
    const fetchPart = (id: string): AuthoredPart => ({
      id,
      format: 'SINGLE_CHOICE',
      prompt: `Код загружает заказ (см. выше). Что произойдёт, если: ${fetchCase!.describe}?`,
      options: [
        opt('render', 'catch не сработает: render получит тело ответа как данные'),
        opt('catch', 'Сработает catch и пользователь увидит «Не удалось загрузить»'),
        opt('throws-status', 'fetch сам выбросит исключение с кодом статуса'),
        opt('nothing', 'Ничего: промис останется в ожидании'),
      ],
      correct: fetchCase!.outcome,
      skillTags: ['http', 'error-handling'],
    });
    const fetchCode = code(
      'javascript',
      "async function showOrder(id) {\n  try {\n    const res = await fetch(`/api/orders/${id}`);\n    const data = await res.json();\n    render(data);\n  } catch (e) {\n    showError('Не удалось загрузить');\n  }\n}",
    );

    if (grade === 'JUNIOR') {
      const statuses = params.statuses!.map((s) => STATUS_REACTION.find((r) => r.status === s)!);
      const reactions = [...new Set([...statuses.map((s) => s.reaction), ...params.distractors!])].sort();
      parts.push({
        id: 'p1',
        format: 'MATCHING',
        prompt: 'Сопоставьте код ответа API с правильной реакцией интерфейса.',
        left: statuses.map((s) => opt(`s${s.status}`, `${s.status}`)),
        right: reactions.map((r) => opt(r, REACTIONS[r])),
        correct: Object.fromEntries(statuses.map((s) => [`s${s.status}`, s.reaction])),
        skillTags: ['http', 'error-handling'],
      });
      parts.push(fetchPart('p2'));
      return { title: 'Коды ответа и реакция интерфейса', context: [text('Клиентское приложение обращается к REST API.'), fetchCode], parts };
    }

    if (grade === 'MIDDLE') {
      const items = params.retryKeys!.map((k) => RETRY_POOL.find((r) => r.key === k)!);
      parts.push({
        id: 'p1',
        format: 'MULTI_SELECT',
        prompt: 'Какие неудачные запросы клиент может безопасно повторить автоматически (с паузой)?',
        options: items.map((i) => opt(i.key, i.label)),
        correct: items.filter((i) => i.retry).map((i) => i.key),
        skillTags: ['http', 'error-handling'],
      });
      const waits = params.retryAfters!;
      parts.push({
        id: 'p2',
        format: 'NUMERIC',
        prompt: `GET /search ${waits.length} раза подряд получил 429 с Retry-After: ${waits.join(', ')} (секунды), затем 200. Клиент ждёт ровно Retry-After перед каждым повтором. Сколько секунд суммарно займёт ожидание?`,
        correct: waits.reduce((a, b) => a + b, 0),
        tolerance: 0,
        integer: true,
        unit: 'с',
        skillTags: ['http'],
      });
      parts.push(fetchPart('p3'));
      return { title: 'Повторы неудачных запросов', context: [text('Клиент автоматически повторяет запросы только там, где повтор не создаст побочного эффекта.'), fetchCode], parts };
    }

    const { base, cap, maxAttempts, responses } = params as Required<Params>;
    const result = runRetryPolicy(responses, base, cap, maxAttempts);
    parts.push({
      id: 'p1',
      format: 'NUMERIC',
      prompt: 'Сколько миллисекунд клиент суммарно проведёт в ожидании между попытками?',
      correct: result.waited,
      tolerance: 0,
      integer: true,
      unit: 'мс',
      skillTags: ['http', 'error-handling'],
    });
    parts.push({
      id: 'p2',
      format: 'NUMERIC',
      prompt: 'Сколько запросов клиент отправит всего (включая первый)?',
      correct: result.requests,
      tolerance: 0,
      integer: true,
      skillTags: ['error-handling'],
    });
    parts.push({
      id: 'p3',
      format: 'SINGLE_CHOICE',
      prompt: 'Чем закончится загрузка?',
      options: [
        opt('success', 'Данные будут получены'),
        opt('error-final', 'Ошибка: попытки исчерпаны или получен неповторяемый ответ — показать ошибку с кнопкой «Повторить»'),
        opt('loop', 'Клиент будет повторять бесконечно'),
        opt('silent', 'Ошибка будет проигнорирована без сообщения пользователю'),
      ],
      correct: result.outcome === 'success' ? 'success' : 'error-final',
      skillTags: ['error-handling'],
    });
    return {
      title: 'Политика повторных попыток на клиенте',
      context: [
        text('Клиент загружает данные (GET) и применяет политику повторов:'),
        list([
          `не более ${maxAttempts} попыток, включая первую;`,
          'повторяются только ответы 429, 502 и 503; на остальные ошибки — сразу показать ошибку;',
          'если в ответе есть Retry-After (секунды) — ждать ровно это время;',
          `иначе перед повтором k (k = 1, 2, …) ждать min(${base} · 2^(k−1), ${cap}) мс.`,
        ]),
        text('Ответы сервера по порядку попыток:'),
        table(['Попытка', 'Статус', 'Retry-After'], responses.map((r, i) => [i + 1, r.status, r.retryAfter ?? '—'])),
      ],
      parts,
    };
  },
};
