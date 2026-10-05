import type { GradeCode } from '../../../catalog/catalog';
import type { AuthoredPart, FamilyDefinition, Rng } from '../../types';
import { code, opt, table, text } from '../helpers';

/**
 * F6. Гонки запросов и отображение результата.
 * Junior — поиск без защиты от устаревших ответов; сужение discriminated union в TypeScript.
 * Middle — debounce: сколько запросов уйдёт; отмена предыдущих через AbortController.
 * Senior — отмена, ошибки устаревших запросов (AbortError не показывается), исчерпывающий switch с never.
 */

interface Req {
  query: string;
  at: number;
  latency: number;
  fails: boolean;
}

interface Params {
  requests?: Req[];
  protection?: 'none' | 'abort';
  keystrokes?: number[];
  debounceMs?: number;
  tsCase: number;
  missingCase?: number;
}

const WORDS = ['react', 'redux', 'router', 'rollup', 'remix', 'relay', 'recoil'];
const TS_CASES = [
  { type: 'SearchResult', okField: 'items', errField: 'message', flag: 'ok' },
  { type: 'LoadState', okField: 'data', errField: 'error', flag: 'success' },
  { type: 'ApiResponse', okField: 'payload', errField: 'reason', flag: 'ok' },
];
const STATUS_UNION = ['idle', 'loading', 'success', 'error'];

/** Что отображается в конце: без защиты — ответ, пришедший последним; с отменой — только последний отправленный. */
export function raceResult(requests: Req[], protection: 'none' | 'abort') {
  const latest = requests[requests.length - 1];
  const arrivals = requests.map((r) => ({ ...r, arrival: r.at + r.latency })).sort((a, b) => a.arrival - b.arrival);
  let shown: { query: string; error: boolean } | null = null;
  let aborted = 0;
  for (const r of arrivals) {
    const isLatest = r.query === latest.query;
    if (protection === 'abort') {
      // Запрос отменён, если до его ответа был отправлен следующий запрос.
      const next = requests[requests.findIndex((x) => x.query === r.query) + 1];
      if (next && next.at < r.arrival) {
        aborted += 1;
        continue;
      }
    }
    shown = { query: r.query, error: r.fails };
    void isLatest;
  }
  return { shown, aborted };
}

/** Число запросов при debounce: запрос уходит, если после нажатия прошло debounceMs без новых нажатий. */
export function debouncedRequests(keystrokes: number[], debounceMs: number): number {
  let count = 0;
  for (let i = 0; i < keystrokes.length; i += 1) {
    const next = keystrokes[i + 1];
    if (next === undefined || next - keystrokes[i] >= debounceMs) count += 1;
  }
  return count;
}

function prefixes(word: string, count: number): string[] {
  const start = Math.max(2, word.length - count + 1);
  return Array.from({ length: count }, (_, i) => word.slice(0, start + i));
}

function sample(rng: Rng, grade: GradeCode): Params {
  const tsCase = rng.int(0, TS_CASES.length - 1);
  for (let guard = 0; guard < 300; guard += 1) {
    const word = rng.pick(WORDS);
    if (grade === 'JUNIOR') {
      const queries = prefixes(word, rng.int(2, 3));
      let at = 0;
      const requests = queries.map((query, i) => {
        if (i) at += rng.pick([80, 120, 200]);
        return { query, at, latency: rng.pick([60, 150, 300, 450, 700]), fails: false };
      });
      const r = raceResult(requests, 'none');
      if (r.shown && r.shown.query !== requests[requests.length - 1].query && new Set(requests.map((x) => x.at + x.latency)).size === requests.length) {
        return { requests, protection: 'none', tsCase };
      }
    } else if (grade === 'MIDDLE') {
      const debounceMs = rng.pick([200, 300, 400]);
      const keystrokes: number[] = [0];
      for (let i = 1; i < rng.int(5, 8); i += 1) keystrokes.push(keystrokes[i - 1] + rng.pick([60, 100, 150, 350, 500]));
      const sent = debouncedRequests(keystrokes, debounceMs);
      const queries = prefixes(word, 3);
      let at = 0;
      const requests = queries.map((query, i) => {
        if (i) at += rng.pick([100, 250, 400]);
        return { query, at, latency: rng.pick([80, 200, 350, 600]), fails: false };
      });
      const none = raceResult(requests, 'none');
      const abort = raceResult(requests, 'abort');
      const ambiguous = requests.some((r) => requests.some((x) => x.at === r.at + r.latency));
      if (sent >= 2 && sent < keystrokes.length && none.shown?.query !== abort.shown?.query && !ambiguous) {
        return { keystrokes, debounceMs, requests, protection: 'abort', tsCase };
      }
    } else {
      const queries = prefixes(word, rng.int(3, 4));
      let at = 0;
      const requests = queries.map((query, i) => {
        if (i) at += rng.pick([100, 200, 300]);
        return { query, at, latency: rng.pick([80, 150, 350, 500, 700]), fails: rng.bool(0.4) };
      });
      const r = raceResult(requests, 'abort');
      const ambiguous = requests.some((x) => requests.some((y) => y.at === x.at + x.latency));
      const staleFailure = requests.slice(0, -1).some((x) => x.fails);
      if (r.aborted >= 1 && staleFailure && !ambiguous) {
        return { requests, protection: 'abort', tsCase, missingCase: rng.int(0, STATUS_UNION.length - 1) };
      }
    }
  }
  throw new Error('fe.request-races: генерация не удалась');
}

export const requestRacesFamily: FamilyDefinition<Params> = {
  id: 'fe.request-races',
  version: 1,
  specialization: 'FRONTEND',
  group: 'FE_HTTP_ERRORS',
  title: 'Гонки запросов и отображение ошибок',
  description: 'Устаревшие ответы при поиске, debounce, отмена через AbortController, типобезопасная обработка результата.',
  supportedGrades: ['JUNIOR', 'MIDDLE', 'SENIOR'],
  skillTags: ['http', 'error-handling', 'async-js', 'typescript'],
  gradeNotes: {
    JUNIOR: 'Поиск без защиты: побеждает ответ, пришедший последним; сужение discriminated union.',
    MIDDLE: 'Debounce: сколько запросов уйдёт; отмена предыдущих запросов через AbortController.',
    SENIOR: 'Ошибки отменённых запросов не показываются (AbortError); исчерпывающий switch с never.',
  },
  sample,
  complexity(params) {
    return (params.requests?.length ?? 0) * 2 + (params.keystrokes?.length ?? 0);
  },
  build(params, grade) {
    const ts = TS_CASES[params.tsCase];
    const requests = params.requests!;
    const parts: AuthoredPart[] = [];
    const reqTable = table(
      ['Запрос', 'Отправлен, мс', 'Ответ через, мс', ...(grade === 'SENIOR' ? ['Итог'] : [])],
      requests.map((r) => [`q='${r.query}'`, r.at, r.latency, ...(grade === 'SENIOR' ? [r.fails ? 'ошибка 500' : 'успех'] : [])]),
    );
    const errorPart = (id: string): AuthoredPart => ({
      id,
      format: 'SINGLE_CHOICE',
      prompt: 'Запрос поиска завершился ошибкой сервера (500). Какое поведение интерфейса корректно?',
      options: [
        opt('inline', 'Показать сообщение об ошибке рядом с полем и кнопку «Повторить», не очищая введённый запрос'),
        opt('alert-clear', 'Показать alert и очистить поле поиска'),
        opt('stale', 'Молча оставить прежние результаты, как будто они относятся к новому запросу'),
        opt('reload', 'Перезагрузить страницу целиком'),
      ],
      correct: 'inline',
      skillTags: ['error-handling', 'http'],
    });
    const tsPart = (id: string): AuthoredPart => ({
      id,
      format: 'SINGLE_CHOICE',
      prompt: `Дан тип: type ${ts.type} = { ${ts.flag}: true; ${ts.okField}: Item[] } | { ${ts.flag}: false; ${ts.errField}: string }. Какой код компилируется без ошибок и без приведения типов?`,
      options: [
        opt('narrow', `if (r.${ts.flag}) { render(r.${ts.okField}); } else { showError(r.${ts.errField}); }`),
        opt('direct', `render(r.${ts.okField} ?? []);`),
        opt('wrong-branch', `if (!r.${ts.flag}) { render(r.${ts.okField}); }`),
        opt('in-check', `if (r.${ts.errField}) { showError(r.${ts.errField}); }`),
      ],
      correct: 'narrow',
      skillTags: ['typescript'],
    });

    if (grade === 'JUNIOR') {
      const result = raceResult(requests, 'none');
      parts.push({
        id: 'p1',
        format: 'SINGLE_CHOICE',
        prompt: 'Результаты какого запроса останутся на экране, когда придут все ответы?',
        options: requests.map((r) => opt(`q-${r.query}`, `Для '${r.query}'`)).concat(opt('empty', 'Список будет пустым')),
        correct: `q-${result.shown!.query}`,
        skillTags: ['async-js', 'http'],
      });
      parts.push(tsPart('p2'));
      parts.push(errorPart('p3'));
      return {
        title: 'Поиск по мере ввода',
        context: [
          text('Каждое изменение строки поиска отправляет запрос; при получении ответа результаты сразу показываются. Защиты от устаревших ответов нет.'),
          code('javascript', "async function onInput(q) {\n  const res = await fetch(`/api/search?q=${q}`);\n  setResults(await res.json());\n}"),
          reqTable,
        ],
        parts,
      };
    }

    if (grade === 'MIDDLE') {
      const result = raceResult(requests, 'abort');
      parts.push({
        id: 'p1',
        format: 'NUMERIC',
        prompt: `Пользователь нажимал клавиши в моменты ${params.keystrokes!.join(', ')} мс. Поиск вызывается с debounce ${params.debounceMs} мс (запрос уходит, если после нажатия ${params.debounceMs} мс не было новых нажатий). Сколько запросов уйдёт на сервер?`,
        correct: debouncedRequests(params.keystrokes!, params.debounceMs!),
        tolerance: 0,
        integer: true,
        skillTags: ['async-js'],
      });
      parts.push({
        id: 'p2',
        format: 'SINGLE_CHOICE',
        prompt: 'Отдельный сценарий из таблицы: перед каждым новым запросом предыдущий отменяется через AbortController. Результаты какого запроса будут на экране в конце?',
        options: requests.map((r) => opt(`q-${r.query}`, `Для '${r.query}'`)).concat(opt('empty', 'Никакие: все запросы отменены')),
        correct: `q-${result.shown!.query}`,
        skillTags: ['async-js', 'http'],
      });
      parts.push(tsPart('p3'));
      parts.push(errorPart('p4'));
      return {
        title: 'Debounce и отмена запросов',
        context: [
          code(
            'javascript',
            "let controller;\nasync function search(q) {\n  controller?.abort();\n  controller = new AbortController();\n  const res = await fetch(`/api/search?q=${q}`, { signal: controller.signal });\n  setResults(await res.json());\n}",
          ),
          reqTable,
        ],
        parts,
      };
    }

    const result = raceResult(requests, 'abort');
    const missing = STATUS_UNION[params.missingCase!];
    const present = STATUS_UNION.filter((s) => s !== missing);
    parts.push({
      id: 'p1',
      format: 'SINGLE_CHOICE',
      prompt: 'Что увидит пользователь после того, как завершатся все запросы?',
      options: [
        ...requests.map((r) => opt(`ok-${r.query}`, `Результаты для '${r.query}'`)),
        opt('error-latest', `Сообщение об ошибке для '${requests[requests.length - 1].query}'`),
        opt('error-stale', 'Сообщение об ошибке от одного из отменённых запросов'),
      ],
      correct: result.shown!.error ? 'error-latest' : `ok-${result.shown!.query}`,
      skillTags: ['error-handling', 'async-js'],
    });
    parts.push({
      id: 'p2',
      format: 'NUMERIC',
      prompt: 'Сколько запросов завершится отказом с AbortError?',
      correct: result.aborted,
      tolerance: 0,
      integer: true,
      skillTags: ['http', 'error-handling'],
    });
    parts.push({
      id: 'p3',
      format: 'SINGLE_CHOICE',
      prompt: `Тип Status = ${STATUS_UNION.map((s) => `'${s}'`).join(' | ')}. В switch(status) обработаны случаи ${present.map((s) => `'${s}'`).join(', ')}, а в default написано const unreachable: never = status. Что сообщит TypeScript?`,
      options: [
        opt('missing', `Ошибку: тип '"${missing}"' нельзя присвоить типу 'never'`),
        opt('ok', 'Ничего: код корректен'),
        opt('runtime', 'Ошибку только во время выполнения'),
        opt('any', `Предупреждение, что status имеет тип any`),
      ],
      correct: 'missing',
      skillTags: ['typescript'],
    });
    return {
      title: 'Отмена запросов и ошибки устаревших ответов',
      context: [
        text('Перед каждым новым поиском предыдущий запрос отменяется. Отменённый fetch отклоняется с ошибкой AbortError; такие ошибки интерфейс игнорирует.'),
        code(
          'javascript',
          "let controller;\nasync function search(q) {\n  controller?.abort();\n  controller = new AbortController();\n  try {\n    const res = await fetch(`/api/search?q=${q}`, { signal: controller.signal });\n    if (!res.ok) throw new Error(`HTTP ${res.status}`);\n    setResults(await res.json());\n  } catch (e) {\n    if (e.name === 'AbortError') return;\n    showError(q);\n  }\n}",
        ),
        reqTable,
      ],
      parts,
    };
  },
};
