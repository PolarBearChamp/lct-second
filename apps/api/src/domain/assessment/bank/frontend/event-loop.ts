import type { GradeCode } from '../../../catalog/catalog';
import type { FamilyDefinition, Rng } from '../../types';
import { code, opt, text } from '../helpers';

/**
 * F1. Порядок выполнения асинхронного кода (event loop).
 * Программа собирается из ограниченного набора конструкций с однозначной семантикой (без гонок таймеров
 * с задержками 0 и 1 мс, без thenable). Правильный порядок вычисляет модель очередей ниже — пользовательский код
 * не исполняется.
 * Junior — синхронный код, setTimeout(0) и Promise.then.
 * Middle — async/await, цепочки then, queueMicrotask, таймеры с разными задержками.
 * Senior — вложенное планирование: микрозадачи из таймеров, таймеры из микрозадач, несколько await.
 */

type Stmt =
  | { kind: 'log'; label: string }
  | { kind: 'timeout'; delay: number; body: Stmt[] }
  | { kind: 'then'; body: Stmt[] }
  | { kind: 'queue'; body: Stmt[] }
  | { kind: 'chain'; first: Stmt[]; second: Stmt[] }
  | { kind: 'async'; name: string; before: Stmt[]; after: Stmt[]; secondAwait?: Stmt[] };

interface Params {
  program: Stmt[];
}

/** Модель: синхронный код → очередь микрозадач до опустошения → таймер с минимальным (время, порядок) → … */
export function simulate(program: Stmt[]): { output: string[]; timerLabels: Set<string> } {
  const output: string[] = [];
  const timerLabels = new Set<string>();
  const micro: Array<() => void> = [];
  const timers: Array<{ at: number; seq: number; run: () => void }> = [];
  let now = 0;
  let seq = 0;
  let inTimer = false;

  const exec = (stmts: Stmt[]): void => {
    for (const st of stmts) {
      switch (st.kind) {
        case 'log':
          output.push(st.label);
          if (inTimer) timerLabels.add(st.label);
          break;
        case 'timeout':
          timers.push({ at: now + st.delay, seq: seq++, run: () => exec(st.body) });
          break;
        case 'then':
        case 'queue':
          micro.push(() => exec(st.body));
          break;
        case 'chain':
          // Второй then ставится в очередь, когда разрешается промис первого (сразу после выполнения его колбэка).
          micro.push(() => {
            exec(st.first);
            micro.push(() => exec(st.second));
          });
          break;
        case 'async':
          // Тело до первого await выполняется синхронно; await null — продолжение через одну микрозадачу.
          exec(st.before);
          micro.push(() => {
            exec(st.after);
            if (st.secondAwait) micro.push(() => exec(st.secondAwait!));
          });
          break;
      }
    }
  };
  const drain = () => {
    while (micro.length) micro.shift()!();
  };

  exec(program);
  drain();
  while (timers.length) {
    timers.sort((a, b) => a.at - b.at || a.seq - b.seq);
    const next = timers.shift()!;
    now = next.at;
    inTimer = true;
    next.run();
    drain();
    inTimer = false;
  }
  return { output, timerLabels };
}

/** Строки первого уровня, выполненные внутри колбэков таймеров (включая микрозадачи, порождённые таймером). */
function render(stmts: Stmt[], indent = ''): string {
  const lines: string[] = [];
  const inner = `${indent}  `;
  for (const st of stmts) {
    switch (st.kind) {
      case 'log':
        lines.push(`${indent}console.log('${st.label}');`);
        break;
      case 'timeout':
        lines.push(`${indent}setTimeout(() => {`, render(st.body, inner), `${indent}}, ${st.delay});`);
        break;
      case 'then':
        lines.push(`${indent}Promise.resolve().then(() => {`, render(st.body, inner), `${indent}});`);
        break;
      case 'queue':
        lines.push(`${indent}queueMicrotask(() => {`, render(st.body, inner), `${indent}});`);
        break;
      case 'chain':
        lines.push(
          `${indent}Promise.resolve()`,
          `${inner}.then(() => {`,
          render(st.first, `${inner}  `),
          `${inner}})`,
          `${inner}.then(() => {`,
          render(st.second, `${inner}  `),
          `${inner}});`,
        );
        break;
      case 'async':
        lines.push(`${indent}async function ${st.name}() {`, render(st.before, inner), `${inner}await null;`, render(st.after, inner));
        if (st.secondAwait) lines.push(`${inner}await null;`, render(st.secondAwait, inner));
        lines.push(`${indent}}`, `${indent}${st.name}();`);
        break;
    }
  }
  return lines.filter((l) => l !== '').join('\n');
}

const NAMES = ['load', 'init', 'sync', 'boot', 'fetchData', 'prepare', 'refresh'];

function generate(rng: Rng, grade: GradeCode): Params {
  for (let guard = 0; guard < 500; guard += 1) {
    const labels = 'ABCDEFGHIJK'.split('');
    let next = 0;
    const L = (): Stmt => ({ kind: 'log', label: labels[next++] });
    const program: Stmt[] = [];
    // Имена async-функций не повторяются: повторное объявление function переопределило бы первую функцию.
    const names = rng.shuffle(NAMES);
    const nextName = () => names.shift() ?? `task${next}`;
    const pushRandom = (kinds: string[]) => {
      const kind = rng.pick(kinds);
      if (kind === 'log') program.push(L());
      if (kind === 'timeout0') program.push({ kind: 'timeout', delay: 0, body: [L()] });
      if (kind === 'timeoutLong') program.push({ kind: 'timeout', delay: rng.pick([20, 100]), body: [L()] });
      if (kind === 'then') program.push({ kind: 'then', body: [L()] });
      if (kind === 'queue') program.push({ kind: 'queue', body: [L()] });
      if (kind === 'chain') program.push({ kind: 'chain', first: [L()], second: [L()] });
      if (kind === 'async') program.push({ kind: 'async', name: nextName(), before: [L()], after: [L()] });
      if (kind === 'timeoutWithMicro') program.push({ kind: 'timeout', delay: 0, body: [L(), { kind: 'then', body: [L()] }] });
      if (kind === 'microWithTimeout') program.push({ kind: 'then', body: [L(), { kind: 'timeout', delay: 0, body: [L()] }] });
      if (kind === 'async2') program.push({ kind: 'async', name: nextName(), before: [L()], after: [L()], secondAwait: [L()] });
    };
    if (grade === 'JUNIOR') {
      const count = rng.int(4, 5);
      while (next < count) pushRandom(['log', 'log', 'timeout0', 'then']);
    } else if (grade === 'MIDDLE') {
      const count = rng.int(6, 7);
      while (next < count) pushRandom(['log', 'timeout0', 'timeoutLong', 'then', 'queue', 'chain', 'async']);
    } else {
      const count = rng.int(7, 9);
      while (next < count) pushRandom(['log', 'timeoutLong', 'chain', 'async2', 'timeoutWithMicro', 'microWithTimeout', 'queue']);
    }
    const { output, timerLabels } = simulate(program);
    const kinds = new Set(program.map((s) => s.kind));
    const firstTimer = output.findIndex((label) => timerLabels.has(label));
    const ok =
      output.length >= (grade === 'JUNIOR' ? 4 : 6) &&
      output.length <= 9 &&
      firstTimer > 0 &&
      kinds.has('timeout') &&
      (kinds.has('then') || kinds.has('chain') || kinds.has('async') || kinds.has('queue')) &&
      (grade === 'JUNIOR' || kinds.has('async') || kinds.has('chain')) &&
      // Порядок вывода должен отличаться от порядка строк в исходнике — иначе задача тривиальна.
      output.join('') !== [...output].sort().join('');
    if (ok) return { program };
  }
  throw new Error('fe.event-loop: не удалось сгенерировать программу');
}

function depth(stmts: Stmt[]): number {
  return Math.max(
    0,
    ...stmts.map((s) =>
      s.kind === 'timeout' || s.kind === 'then' || s.kind === 'queue'
        ? 1 + depth(s.body)
        : s.kind === 'chain'
          ? 2
          : s.kind === 'async'
            ? s.secondAwait
              ? 2
              : 1
            : 0,
    ),
  );
}

export const eventLoopFamily: FamilyDefinition<Params> = {
  id: 'fe.event-loop',
  version: 1,
  specialization: 'FRONTEND',
  group: 'FE_JS_ASYNC',
  title: 'Порядок выполнения асинхронного кода',
  description: 'Порядок вывода при смешении синхронного кода, микрозадач (Promise, queueMicrotask, await) и таймеров.',
  supportedGrades: ['JUNIOR', 'MIDDLE', 'SENIOR'],
  skillTags: ['javascript', 'async-js'],
  gradeNotes: {
    JUNIOR: 'Синхронный код, setTimeout(0) и Promise.then без вложенности.',
    MIDDLE: 'async/await, цепочки then, queueMicrotask, таймеры с разными задержками.',
    SENIOR: 'Вложенное планирование: микрозадачи из таймеров, таймеры из микрозадач, несколько await подряд.',
  },
  sample: generate,
  complexity(params) {
    return simulate(params.program).output.length + depth(params.program) * 2;
  },
  build(params) {
    const { output, timerLabels } = simulate(params.program);
    const firstTimer = output.findIndex((label) => timerLabels.has(label));
    return {
      title: 'В каком порядке выполнится код',
      context: [
        text('Код выполняется в браузере (или Node.js 20+) как скрипт-модуль. Ошибок нет; console.log выводит строку сразу.'),
        code('javascript', render(params.program)),
      ],
      parts: [
        {
          id: 'p1',
          format: 'ORDERING',
          prompt: 'Расположите строки в порядке их появления в консоли.',
          items: [...output].sort().map((label) => opt(label, `'${label}'`)),
          correct: output,
          skillTags: ['javascript', 'async-js'],
        },
        {
          id: 'p2',
          format: 'NUMERIC',
          prompt: 'Сколько строк будет выведено до первой строки из колбэка setTimeout?',
          correct: firstTimer,
          tolerance: 0,
          integer: true,
          skillTags: ['async-js'],
        },
      ],
    };
  },
};
