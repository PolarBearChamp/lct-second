import type { GradeCode } from '../../../catalog/catalog';
import type { AuthoredPart, FamilyDefinition, Rng } from '../../types';
import { code, opt, table, text } from '../helpers';

/**
 * F3. Переходы состояния интерфейса в useReducer.
 * Junior — простой автомат статусов запроса: итоговое состояние и число переходов в loading.
 * Middle — защита от двойной отправки и повтор после ошибки: сколько запросов реально отправлено.
 * Senior — устаревшие ответы отсекаются по requestId: что отображается и какие события проигнорированы.
 */

type Variant = 'basic' | 'guarded' | 'request-id';
type Status = 'idle' | 'loading' | 'success' | 'error';

type Event =
  | { type: 'submit'; query?: string }
  | { type: 'resolved'; requestId?: number; query?: string }
  | { type: 'failed'; requestId?: number }
  | { type: 'retry' }
  | { type: 'reset' };

interface Params {
  variant: Variant;
  domain: number;
  events: Event[];
}

const DOMAINS = [
  { title: 'Форма отправки заявки', submit: 'submit' },
  { title: 'Кнопка «Оплатить»', submit: 'submit' },
  { title: 'Поиск товаров', submit: 'search' },
  { title: 'Сохранение настроек', submit: 'submit' },
];

interface SimResult {
  status: Status;
  loadingTransitions: number;
  requestsSent: number;
  ignored: number[];
  shown: string | null;
}

export function simulateUi(variant: Variant, events: Event[]): SimResult {
  let status: Status = 'idle';
  let requestId = 0;
  let shown: string | null = null;
  let loadingTransitions = 0;
  let requestsSent = 0;
  const ignored: number[] = [];
  events.forEach((event, index) => {
    const before = status;
    let changed = true;
    switch (variant) {
      case 'basic':
        if (event.type === 'submit') status = 'loading';
        else if (event.type === 'resolved') status = 'success';
        else if (event.type === 'failed') status = 'error';
        else if (event.type === 'reset') status = 'idle';
        break;
      case 'guarded':
        if (event.type === 'submit') {
          if (status === 'loading') changed = false;
          else status = 'loading';
        } else if (event.type === 'retry') {
          if (status !== 'error') changed = false;
          else status = 'loading';
        } else if (event.type === 'resolved') {
          if (status !== 'loading') changed = false;
          else status = 'success';
        } else if (event.type === 'failed') {
          if (status !== 'loading') changed = false;
          else status = 'error';
        } else if (event.type === 'reset') status = 'idle';
        break;
      case 'request-id':
        if (event.type === 'submit') {
          requestId += 1;
          status = 'loading';
        } else if (event.type === 'resolved') {
          if (event.requestId !== requestId) changed = false;
          else {
            status = 'success';
            shown = event.query ?? null;
          }
        } else if (event.type === 'failed') {
          if (event.requestId !== requestId) changed = false;
          else status = 'error';
        }
        break;
    }
    if (!changed) ignored.push(index + 1);
    if (before !== 'loading' && status === 'loading') loadingTransitions += 1;
    // В guarded запрос отправляется при переходе в loading; в request-id — при каждом поиске.
    if (variant === 'request-id' ? event.type === 'submit' : before !== 'loading' && status === 'loading') requestsSent += 1;
  });
  return { status, loadingTransitions, requestsSent, ignored, shown };
}

const QUERIES = ['ре', 'реа', 'реак', 'реакт', 'react', 'redux', 'red'];

function sample(rng: Rng, grade: GradeCode): Params {
  const variant: Variant = grade === 'JUNIOR' ? 'basic' : grade === 'MIDDLE' ? 'guarded' : 'request-id';
  for (let guard = 0; guard < 300; guard += 1) {
    const events: Event[] = [];
    if (variant === 'basic') {
      const length = rng.int(4, 6);
      for (let i = 0; i < length; i += 1) events.push({ type: rng.pick(['submit', 'submit', 'resolved', 'failed', 'reset'] as const) });
    } else if (variant === 'guarded') {
      const length = rng.int(5, 7);
      for (let i = 0; i < length; i += 1) events.push({ type: rng.pick(['submit', 'submit', 'resolved', 'failed', 'retry'] as const) });
    } else {
      // Поиск: несколько запросов, ответы приходят в произвольном порядке.
      const queries = rng.sample(QUERIES, rng.int(3, 4));
      const pending: Array<{ id: number; query: string }> = [];
      let id = 0;
      for (const query of queries) {
        id += 1;
        events.push({ type: 'submit', query });
        pending.push({ id, query });
        if (rng.bool(0.35) && pending.length) {
          const done = pending.splice(rng.int(0, pending.length - 1), 1)[0];
          events.push(rng.bool(0.8) ? { type: 'resolved', requestId: done.id, query: done.query } : { type: 'failed', requestId: done.id });
        }
      }
      for (const done of rng.shuffle(pending)) {
        events.push(rng.bool(0.8) ? { type: 'resolved', requestId: done.id, query: done.query } : { type: 'failed', requestId: done.id });
      }
    }
    const result = simulateUi(variant, events);
    const ok =
      variant === 'basic'
        ? events.filter((e) => e.type === 'submit').length >= 2 && events[0].type === 'submit'
        : variant === 'guarded'
          ? result.ignored.length >= 1 && result.requestsSent >= 2 && events[0].type === 'submit'
          : result.ignored.length >= 1 && result.ignored.length < events.length;
    if (ok) return { variant, domain: rng.int(0, DOMAINS.length - 1), events };
  }
  throw new Error('fe.ui-state: генерация не удалась');
}

function eventLabel(e: Event): string {
  switch (e.type) {
    case 'submit':
      return e.query !== undefined ? `{ type: 'search', query: '${e.query}' }` : "{ type: 'submit' }";
    case 'resolved':
      return e.requestId !== undefined ? `{ type: 'resolved', requestId: ${e.requestId}, query: '${e.query}' }` : "{ type: 'resolved' }";
    case 'failed':
      return e.requestId !== undefined ? `{ type: 'failed', requestId: ${e.requestId} }` : "{ type: 'failed' }";
    case 'retry':
      return "{ type: 'retry' }";
    case 'reset':
      return "{ type: 'reset' }";
  }
}

const REDUCERS: Record<Variant, string> = {
  basic: `type State = { status: 'idle' | 'loading' | 'success' | 'error' };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'submit':   return { status: 'loading' };
    case 'resolved': return { status: 'success' };
    case 'failed':   return { status: 'error' };
    case 'reset':    return { status: 'idle' };
  }
}`,
  guarded: `type State = { status: 'idle' | 'loading' | 'success' | 'error' };

// Переход в 'loading' отправляет запрос (эффект в компоненте).
function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'submit':
      return state.status === 'loading' ? state : { status: 'loading' };
    case 'retry':
      return state.status === 'error' ? { status: 'loading' } : state;
    case 'resolved':
      return state.status === 'loading' ? { status: 'success' } : state;
    case 'failed':
      return state.status === 'loading' ? { status: 'error' } : state;
    case 'reset':
      return { status: 'idle' };
  }
}`,
  'request-id': `type State = {
  status: 'idle' | 'loading' | 'success' | 'error';
  requestId: number;
  results: string | null; // для какого запроса показаны результаты
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'search':
      return { ...state, status: 'loading', requestId: state.requestId + 1 };
    case 'resolved':
      if (action.requestId !== state.requestId) return state;
      return { ...state, status: 'success', results: action.query };
    case 'failed':
      if (action.requestId !== state.requestId) return state;
      return { ...state, status: 'error' };
  }
}`,
};

export const uiStateFamily: FamilyDefinition<Params> = {
  id: 'fe.ui-state',
  version: 1,
  specialization: 'FRONTEND',
  group: 'FE_UI_STATE',
  title: 'Переходы состояния интерфейса (useReducer)',
  description: 'Итоговое состояние reducer-а и побочные эффекты для последовательности событий интерфейса.',
  supportedGrades: ['JUNIOR', 'MIDDLE', 'SENIOR'],
  skillTags: ['react', 'state-management'],
  gradeNotes: {
    JUNIOR: 'Простой автомат статусов запроса: итоговый статус и переходы в loading.',
    MIDDLE: 'Защита от двойной отправки и повтор после ошибки: сколько запросов отправлено.',
    SENIOR: 'Устаревшие ответы отсекаются по requestId: что отображается и какие события проигнорированы.',
  },
  sample,
  complexity(params) {
    return params.events.length + simulateUi(params.variant, params.events).ignored.length;
  },
  build(params) {
    const domain = DOMAINS[params.domain];
    const result = simulateUi(params.variant, params.events);
    const statusOptions = ['idle', 'loading', 'success', 'error'].map((s) => opt(s, `'${s}'`));
    const parts: AuthoredPart[] = [];
    if (params.variant === 'basic') {
      parts.push({ id: 'p1', format: 'SINGLE_CHOICE', prompt: 'Какой status будет у состояния после всех событий?', options: statusOptions, correct: result.status, skillTags: ['react', 'state-management'] });
      parts.push({
        id: 'p2',
        format: 'NUMERIC',
        prompt: "Сколько раз status менялся на 'loading' (переход из другого статуса)?",
        correct: result.loadingTransitions,
        tolerance: 0,
        integer: true,
        skillTags: ['state-management'],
      });
    } else if (params.variant === 'guarded') {
      parts.push({ id: 'p1', format: 'SINGLE_CHOICE', prompt: 'Какой status будет у состояния после всех событий?', options: statusOptions, correct: result.status, skillTags: ['react', 'state-management'] });
      parts.push({
        id: 'p2',
        format: 'NUMERIC',
        prompt: 'Сколько запросов будет отправлено на сервер (каждый переход в loading отправляет один запрос)?',
        correct: result.requestsSent,
        tolerance: 0,
        integer: true,
        skillTags: ['state-management', 'react'],
      });
    } else {
      const queries = [...new Set(params.events.filter((e) => e.type === 'submit').map((e) => e.query!))];
      parts.push({
        id: 'p1',
        format: 'SINGLE_CHOICE',
        prompt: 'Результаты какого запроса будут показаны (state.results) после всех событий?',
        options: [...queries.map((q) => opt(`q-${q}`, `'${q}'`)), opt('none', 'Никакие (results = null)')],
        correct: result.shown ? `q-${result.shown}` : 'none',
        skillTags: ['react', 'state-management'],
      });
      parts.push({
        id: 'p2',
        format: 'MULTI_SELECT',
        prompt: 'Какие события reducer проигнорировал (вернул прежнее состояние)?',
        options: params.events.map((_, i) => opt(`e${i + 1}`, `Событие №${i + 1}`)),
        correct: result.ignored.map((i) => `e${i}`),
        skillTags: ['state-management'],
      });
    }
    return {
      title: `${domain.title}: переходы состояния`,
      context: [
        text(`Компонент «${domain.title}» хранит состояние через useReducer. Начальное состояние: status = 'idle'${params.variant === 'request-id' ? ', requestId = 0, results = null' : ''}.`),
        code('typescript', REDUCERS[params.variant]),
        text('События отправляются через dispatch строго по порядку:'),
        table(['№', 'Действие'], params.events.map((e, i) => [i + 1, eventLabel(e)])),
      ],
      parts,
    };
  },
};
