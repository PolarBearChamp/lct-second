import type { GradeCode } from '../../../catalog/catalog';
import type { AuthoredPart, FamilyDefinition, Rng } from '../../types';
import { code, list, opt, table, text } from '../helpers';

/**
 * F4. Эффекты, зависимости и замыкания в React (production-сборка, без StrictMode).
 * Junior — сколько раз выполнится эффект при разных массивах зависимостей.
 * Middle — устаревшее замыкание в setInterval и функциональное обновление состояния.
 * Senior — гонка ответов при смене id и флаг отмены в cleanup.
 */

type Deps = 'prop' | 'empty' | 'none' | 'state';
type JuniorEvent = { kind: 'parent' } | { kind: 'prop'; value: number } | { kind: 'state' };

interface Params {
  variant: 'deps' | 'interval' | 'race';
  names: number;
  // deps
  deps?: Deps;
  events?: JuniorEvent[];
  // interval
  update?: 'stale' | 'functional' | 'stale-with-deps';
  step?: number;
  intervalMs?: number;
  ticks?: number;
  // race
  withIgnore?: boolean;
  changes?: Array<{ at: number; id: number; latency: number }>;
}

const NAMES = [
  { comp: 'ProfileCard', prop: 'userId', state: 'tab', fn: 'loadProfile' },
  { comp: 'OrderList', prop: 'customerId', state: 'page', fn: 'loadOrders' },
  { comp: 'ChatRoom', prop: 'roomId', state: 'draft', fn: 'subscribe' },
  { comp: 'Report', prop: 'reportId', state: 'filter', fn: 'loadReport' },
];
const USERS = ['Анна', 'Борис', 'Вера', 'Глеб', 'Дина'];

export function effectRuns(deps: Deps, initialProp: number, events: JuniorEvent[]): number {
  let runs = 1; // монтирование
  let prop = initialProp;
  for (const e of events) {
    const propChanged = e.kind === 'prop' && e.value !== prop;
    if (e.kind === 'prop') prop = e.value;
    if (deps === 'none') runs += 1; // каждое событие вызывает перерисовку
    if (deps === 'prop' && propChanged) runs += 1;
    if (deps === 'state' && e.kind === 'state') runs += 1;
  }
  return runs;
}

/** Гонка: какой пользователь показан в конце и сколько вызовов setUser применилось. */
export function raceOutcome(changes: Array<{ at: number; id: number; latency: number }>, withIgnore: boolean) {
  const arrivals = changes
    .map((c, index) => ({ ...c, index, arrival: c.at + c.latency, cancelledAt: changes[index + 1]?.at ?? Number.POSITIVE_INFINITY }))
    .sort((a, b) => a.arrival - b.arrival);
  let shown: number | null = null;
  let applied = 0;
  for (const a of arrivals) {
    if (withIgnore && a.arrival >= a.cancelledAt) continue;
    shown = a.id;
    applied += 1;
  }
  return { shown, applied };
}

function sample(rng: Rng, grade: GradeCode): Params {
  const names = rng.int(0, NAMES.length - 1);
  if (grade === 'JUNIOR') {
    const deps = rng.pick(['prop', 'empty', 'none', 'state'] as const);
    const events: JuniorEvent[] = [];
    let prop = 1;
    const length = rng.int(4, 6);
    for (let i = 0; i < length; i += 1) {
      const kind = rng.pick(['parent', 'prop', 'state'] as const);
      if (kind === 'prop') {
        // Иногда «изменение» на то же значение — проверка понимания сравнения зависимостей.
        const value = rng.bool(0.3) ? prop : prop + rng.int(1, 3);
        events.push({ kind, value });
        prop = value;
      } else events.push({ kind });
    }
    return { variant: 'deps', names, deps, events };
  }
  if (grade === 'MIDDLE') {
    return {
      variant: 'interval',
      names,
      update: rng.pick(['stale', 'functional', 'stale-with-deps'] as const),
      step: rng.pick([1, 2, 5]),
      intervalMs: rng.pick([500, 1000, 2000]),
      ticks: rng.int(3, 8),
    };
  }
  for (let guard = 0; guard < 200; guard += 1) {
    const count = rng.int(3, 4);
    const ids = rng.sample([1, 2, 3, 4, 5], count);
    let at = 0;
    const changes = ids.map((id, i) => {
      if (i > 0) at += rng.pick([50, 100, 150, 200]);
      return { at, id, latency: rng.pick([40, 80, 120, 250, 400, 600]) };
    });
    const withIgnore = rng.bool(0.5);
    const a = raceOutcome(changes, false);
    const b = raceOutcome(changes, true);
    // Интересны случаи, где без флага показывается устаревший пользователь.
    const arrivals = changes.map((c) => c.at + c.latency);
    const ambiguous = arrivals.some((t) => changes.some((c) => c.at === t));
    if (a.shown !== b.shown && !ambiguous && new Set(arrivals).size === changes.length) {
      return { variant: 'race', names, withIgnore, changes };
    }
  }
  throw new Error('fe.react-effects: генерация не удалась');
}

const DEPS_CODE: Record<Deps, (n: (typeof NAMES)[number]) => string> = {
  prop: (n) => `[${n.prop}]`,
  empty: () => '[]',
  none: () => '',
  state: (n) => `[${n.state}]`,
};

export const reactEffectsFamily: FamilyDefinition<Params> = {
  id: 'fe.react-effects',
  version: 1,
  specialization: 'FRONTEND',
  group: 'FE_UI_STATE',
  title: 'Эффекты, зависимости и замыкания в React',
  description: 'Сколько раз выполняется эффект, что отображается при устаревшем замыкании и при гонке ответов.',
  supportedGrades: ['JUNIOR', 'MIDDLE', 'SENIOR'],
  skillTags: ['react', 'state-management'],
  gradeNotes: {
    JUNIOR: 'Число запусков useEffect при разных массивах зависимостей.',
    MIDDLE: 'Устаревшее замыкание в setInterval, функциональное обновление состояния.',
    SENIOR: 'Гонка ответов при смене параметра, флаг отмены в cleanup.',
  },
  sample,
  complexity(params) {
    return params.events?.length ?? params.ticks ?? (params.changes?.length ?? 0) * 2;
  },
  build(params) {
    const n = NAMES[params.names];
    const parts: AuthoredPart[] = [];
    if (params.variant === 'deps') {
      const deps = params.deps!;
      const depsCode = DEPS_CODE[deps](n);
      const events = params.events!;
      parts.push({
        id: 'p1',
        format: 'NUMERIC',
        prompt: `Сколько раз выполнится функция эффекта (вызов ${n.fn}) с учётом первого монтирования?`,
        correct: effectRuns(deps, 1, events),
        tolerance: 0,
        integer: true,
        skillTags: ['react'],
      });
      parts.push({
        id: 'p2',
        format: 'SINGLE_CHOICE',
        prompt: `Какой массив зависимостей нужен, чтобы ${n.fn} вызывался только при монтировании и при изменении ${n.prop}?`,
        options: [opt('prop', `[${n.prop}]`), opt('empty', '[]'), opt('none', 'Не передавать массив'), opt('both', `[${n.prop}, ${n.state}]`)],
        correct: 'prop',
        skillTags: ['react', 'state-management'],
      });
      return {
        title: `${n.comp}: сколько раз выполнится эффект`,
        context: [
          text('Production-сборка, StrictMode отключён. Компонент не обёрнут в memo; родитель передаёт проп при каждой своей перерисовке.'),
          code(
            'jsx',
            `function ${n.comp}({ ${n.prop} }) {\n  const [${n.state}, set${n.state[0].toUpperCase()}${n.state.slice(1)}] = useState('a');\n  useEffect(() => {\n    ${n.fn}(${n.prop});\n  }${depsCode ? `, ${depsCode}` : ''});\n  return <Layout ${n.state}={${n.state}} />;\n}`,
          ),
          text(`Компонент смонтирован с ${n.prop} = 1. Затем по очереди происходит:`),
          list(
            events.map((e, i) =>
              e.kind === 'parent'
                ? `${i + 1}. Родитель перерисовался, ${n.prop} не изменился`
                : e.kind === 'prop'
                  ? `${i + 1}. Родитель передал ${n.prop} = ${e.value}`
                  : `${i + 1}. Вызван setter состояния ${n.state} с новым значением`,
            ),
          ),
        ],
        parts,
      };
    }

    if (params.variant === 'interval') {
      const { update, step, intervalMs, ticks } = params as Required<Params>;
      const updateCode = update === 'functional' ? `setCount((c) => c + ${step})` : `setCount(count + ${step})`;
      const depsCode = update === 'stale-with-deps' ? '[count]' : '[]';
      const value = update === 'stale' ? step : ticks * step;
      parts.push({
        id: 'p1',
        format: 'NUMERIC',
        prompt: `Какое значение будет на экране через ${ticks * intervalMs + intervalMs / 2} мс после монтирования? Временем рендера пренебрегите.`,
        correct: value,
        tolerance: 0,
        integer: true,
        skillTags: ['react', 'state-management'],
      });
      parts.push({
        id: 'p2',
        format: 'SINGLE_CHOICE',
        prompt: 'Какой вариант корректно увеличивает счётчик на каждом тике, не пересоздавая интервал при каждом изменении count?',
        options: [
          opt('functional', `setCount((c) => c + ${step}) и массив зависимостей []`),
          opt('deps', `setCount(count + ${step}) и массив зависимостей [count]`),
          opt('ref-render', `Хранить count в обычной переменной вне useState`),
          opt('timeout', 'Заменить setInterval на setTimeout без cleanup'),
        ],
        correct: 'functional',
        skillTags: ['react', 'state-management'],
      });
      return {
        title: 'Счётчик на setInterval',
        context: [
          text('Production-сборка, StrictMode отключён.'),
          code(
            'jsx',
            `function Ticker() {\n  const [count, setCount] = useState(0);\n  useEffect(() => {\n    const id = setInterval(() => {\n      ${updateCode};\n    }, ${intervalMs});\n    return () => clearInterval(id);\n  }, ${depsCode});\n  return <span>{count}</span>;\n}`,
          ),
        ],
        parts,
      };
    }

    const changes = params.changes!;
    const withIgnore = params.withIgnore!;
    const outcome = raceOutcome(changes, withIgnore);
    const nameOf = (id: number) => USERS[id - 1];
    parts.push({
      id: 'p1',
      format: 'SINGLE_CHOICE',
      prompt: 'Имя какого пользователя будет на экране после того, как придут все ответы?',
      options: [...changes.map((c) => opt(`u${c.id}`, nameOf(c.id))), opt('none', 'Ничьё: user останется null')],
      correct: outcome.shown ? `u${outcome.shown}` : 'none',
      skillTags: ['react', 'state-management'],
    });
    parts.push({
      id: 'p2',
      format: 'NUMERIC',
      prompt: 'Сколько раз будет фактически вызван setUser?',
      correct: outcome.applied,
      tolerance: 0,
      integer: true,
      skillTags: ['react'],
    });
    const effectBody = withIgnore
      ? `    let ignore = false;\n    fetchUser(userId).then((data) => {\n      if (!ignore) setUser(data);\n    });\n    return () => {\n      ignore = true;\n    };`
      : `    fetchUser(userId).then((data) => {\n      setUser(data);\n    });`;
    return {
      title: 'Загрузка данных в useEffect при смене id',
      context: [
        text(`fetchUser(id) возвращает пользователя через указанное время. Пользователи: ${changes.map((c) => `id ${c.id} — ${nameOf(c.id)}`).join(', ')}.`),
        code(
          'jsx',
          `function UserCard({ userId }) {\n  const [user, setUser] = useState(null);\n  useEffect(() => {\n${effectBody}\n  }, [userId]);\n  return <p>{user?.name}</p>;\n}`,
        ),
        text('Проп userId меняется так (время от монтирования):'),
        table(['Момент, мс', 'userId', 'Ответ fetchUser через, мс'], changes.map((c) => [c.at, c.id, c.latency])),
      ],
      parts,
    };
  },
};
