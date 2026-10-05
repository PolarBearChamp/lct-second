import type { GradeCode } from '../../../catalog/catalog';
import type { AuthoredPart, ContentBlock, FamilyDefinition, Rng } from '../../types';
import { opt, table, text } from '../helpers';

/**
 * B5. Конкурентные транзакции в PostgreSQL.
 * Junior — потерянное обновление при чтении-изменении-записи, атомарный UPDATE и блокировка строки, откат.
 * Middle — SELECT … FOR UPDATE, ошибка сериализации в REPEATABLE READ, условный UPDATE после ожидания.
 * Senior — write skew (REPEATABLE READ против SERIALIZABLE), взаимоблокировки и порядок захвата строк.
 */

type Pattern =
  | 'lost-update'
  | 'atomic'
  | 'rollback'
  | 'for-update'
  | 'rr-conflict'
  | 'conditional'
  | 'write-skew'
  | 'deadlock';

const PATTERNS: Record<GradeCode, Pattern[]> = {
  JUNIOR: ['lost-update', 'atomic', 'rollback'],
  MIDDLE: ['for-update', 'rr-conflict', 'conditional'],
  SENIOR: ['write-skew', 'deadlock'],
};

const ENTITIES = [
  { table: 'accounts', column: 'balance', what: 'баланс счёта' },
  { table: 'wallets', column: 'amount', what: 'сумму в кошельке' },
  { table: 'stock', column: 'quantity', what: 'остаток товара' },
];

const DUTY = [
  { table: 'doctors', who: 'врачей', one: 'врач', flag: 'on_call', names: ['Алиса', 'Борис', 'Вадим'] },
  { table: 'couriers', who: 'курьеров', one: 'курьер', flag: 'on_shift', names: ['Гоша', 'Дана', 'Ефим'] },
  { table: 'engineers', who: 'дежурных инженеров', one: 'инженер', flag: 'on_duty', names: ['Женя', 'Зоя', 'Игорь'] },
];

interface Params {
  pattern: Pattern;
  entity: number;
  initial: number;
  a1: number;
  a2: number;
  /** write-skew: уровень изоляции и число дежурных в начале. */
  isolation?: 'REPEATABLE READ' | 'SERIALIZABLE';
  onDuty?: number;
  duty?: number;
  /** deadlock: одинаковый или встречный порядок обновления строк. */
  sameOrder?: boolean;
}

function sampleAmounts(rng: Rng, pattern: Pattern): Pick<Params, 'initial' | 'a1' | 'a2'> {
  const step = 10;
  if (pattern === 'conditional') {
    // B >= a1, B >= a2, но B < a1 + a2: второе списание не пройдёт.
    for (;;) {
      const initial = rng.int(10, 30) * step;
      const a1 = rng.int(Math.ceil(initial / 2 / step), Math.floor(initial / step)) * step;
      const a2 = rng.int(Math.floor((initial - a1) / step) + 1, Math.floor(initial / step)) * step;
      if (a1 <= initial && a2 <= initial && a1 + a2 > initial && a1 !== a2) return { initial, a1, a2 };
    }
  }
  for (;;) {
    const initial = rng.int(20, 60) * step;
    const a1 = rng.int(2, 15) * step;
    const a2 = rng.int(2, 15) * step;
    if (a1 !== a2 && a1 + a2 < initial) return { initial, a1, a2 };
  }
}

export const txIsolationFamily: FamilyDefinition<Params> = {
  id: 'be.tx-isolation',
  version: 1,
  specialization: 'BACKEND',
  group: 'BE_RELIABILITY',
  title: 'Конкурентные транзакции в PostgreSQL',
  description: 'Итог параллельных транзакций при разных уровнях изоляции, блокировках и аномалиях.',
  supportedGrades: ['JUNIOR', 'MIDDLE', 'SENIOR'],
  skillTags: ['postgresql', 'transactions', 'concurrency'],
  gradeNotes: {
    JUNIOR: 'Потерянное обновление, атомарный UPDATE и ожидание блокировки, откат транзакции.',
    MIDDLE: 'SELECT … FOR UPDATE, ошибка сериализации в REPEATABLE READ, перепроверка условия UPDATE после ожидания.',
    SENIOR: 'Write skew при REPEATABLE READ и SERIALIZABLE, взаимоблокировки и порядок захвата строк.',
  },
  sample(rng, grade) {
    const pattern = rng.pick(PATTERNS[grade]);
    const params: Params = { pattern, entity: rng.int(0, ENTITIES.length - 1), ...sampleAmounts(rng, pattern) };
    if (pattern === 'write-skew') {
      params.isolation = rng.pick(['REPEATABLE READ', 'SERIALIZABLE'] as const);
      params.onDuty = rng.pick([2, 3]);
      params.duty = rng.int(0, DUTY.length - 1);
    }
    if (pattern === 'deadlock') params.sameOrder = rng.bool(0.35);
    return params;
  },
  complexity(params) {
    return { 'lost-update': 4, atomic: 3, rollback: 4, 'for-update': 5, 'rr-conflict': 5, conditional: 6, 'write-skew': 7, deadlock: 6 }[params.pattern];
  },
  build(params) {
    const e = ENTITIES[params.entity];
    const { initial: B, a1, a2 } = params;
    const upd = (expr: string, cond = '') => `UPDATE ${e.table} SET ${e.column} = ${expr} WHERE id = 1${cond};`;
    const sel = (suffix = '') => `SELECT ${e.column} FROM ${e.table} WHERE id = 1${suffix};`;
    const intro: ContentBlock = text(`В таблице ${e.table} строка с id = 1 содержит ${e.column} = ${B}. Две транзакции выполняются параллельно в указанном порядке шагов.`);
    const parts: AuthoredPart[] = [];
    let rows: Array<Array<string | number>> = [];
    let isolationNote = 'Уровень изоляции обеих транзакций — READ COMMITTED (по умолчанию в PostgreSQL).';

    switch (params.pattern) {
      case 'lost-update': {
        rows = [
          [1, `BEGIN; ${sel()} -- получено ${B}`, ''],
          [2, '', `BEGIN; ${sel()} -- получено ${B}`],
          [3, `${upd(String(B - a1))} -- значение вычислено в приложении: ${B} − ${a1}`, ''],
          [4, 'COMMIT;', ''],
          [5, '', `${upd(String(B - a2))} -- вычислено в приложении: ${B} − ${a2}`],
          [6, '', 'COMMIT;'],
        ];
        parts.push(finalValue(e.column, B - a2));
        parts.push({
          id: 'p2',
          format: 'SINGLE_CHOICE',
          prompt: 'Какое изменение устраняет проблему, не меняя уровень изоляции?',
          options: [
            opt('atomic', `Вычислять новое значение в самом запросе: SET ${e.column} = ${e.column} - :amount`),
            opt('index', `Создать индекс по ${e.table}.id`),
            opt('reread', 'Перед UPDATE ещё раз прочитать значение обычным SELECT'),
            opt('uncommitted', 'Перевести транзакции на READ UNCOMMITTED'),
          ],
          correct: 'atomic',
          skillTags: ['transactions', 'concurrency'],
        });
        break;
      }
      case 'atomic': {
        rows = [
          [1, `BEGIN; ${upd(`${e.column} - ${a1}`)}`, ''],
          [2, '', `BEGIN; ${upd(`${e.column} - ${a2}`)}`],
          [3, 'COMMIT;', ''],
          [4, '', 'COMMIT;'],
        ];
        parts.push(finalValue(e.column, B - a1 - a2));
        parts.push({
          id: 'p2',
          format: 'SINGLE_CHOICE',
          prompt: 'Что происходит с UPDATE транзакции T2 на шаге 2?',
          options: [
            opt('waits', 'Ждёт завершения T1: строка заблокирована её незафиксированным изменением'),
            opt('serialization', 'Сразу получает ошибку сериализации'),
            opt('overwrite', `Применяется к исходному значению ${B} и перезаписывает изменение T1`),
            opt('dirty', 'Читает незафиксированное значение T1 и сразу завершается'),
          ],
          correct: 'waits',
          skillTags: ['postgresql', 'transactions', 'concurrency'],
        });
        break;
      }
      case 'rollback': {
        rows = [
          [1, `BEGIN; ${upd(`${e.column} - ${a1}`)}`, ''],
          [2, '', `BEGIN; ${upd(`${e.column} - ${a2}`)}`],
          [3, 'ROLLBACK;', ''],
          [4, '', 'COMMIT;'],
        ];
        parts.push(finalValue(e.column, B - a2));
        parts.push({
          id: 'p2',
          format: 'SINGLE_CHOICE',
          prompt: 'Почему итоговое значение именно такое?',
          options: [
            opt('rollback', 'Изменение T1 отменено, а T2 после ожидания применила своё списание к исходному значению'),
            opt('both', 'Обе транзакции списали суммы, откат влияет только на журнал'),
            opt('first-wins', 'T2 была отменена вместе с T1, потому что ждала её блокировку'),
            opt('dirty', 'T2 прочитала незафиксированное значение T1 и вычла сумму из него'),
          ],
          correct: 'rollback',
          skillTags: ['transactions', 'concurrency'],
        });
        break;
      }
      case 'for-update': {
        rows = [
          [1, `BEGIN; ${sel(' FOR UPDATE')} -- получено ${B}`, ''],
          [2, '', `BEGIN; ${sel(' FOR UPDATE')} -- результат?`],
          [3, `${upd(String(B - a1))} -- вычислено в приложении`, ''],
          [4, 'COMMIT;', ''],
          [5, '', `${upd(`<прочитанное на шаге 2> − ${a2}`)}`],
          [6, '', 'COMMIT;'],
        ];
        parts.push({
          id: 'p1',
          format: 'SINGLE_CHOICE',
          prompt: 'Какое значение получит T2 на шаге 2 и когда?',
          options: [
            opt('after', `${B - a1} — после того, как T1 зафиксируется`),
            opt('immediately', `${B} — сразу, без ожидания`),
            opt('error', 'Ошибку: строка заблокирована другой транзакцией'),
            opt('own', `${B - a2} — значение с учётом собственного списания`),
          ],
          correct: 'after',
          skillTags: ['postgresql', 'concurrency'],
        });
        parts.push(finalValue(e.column, B - a1 - a2, 'p2'));
        break;
      }
      case 'rr-conflict': {
        isolationNote = 'T1 работает на уровне REPEATABLE READ, T2 — READ COMMITTED.';
        rows = [
          [1, `BEGIN ISOLATION LEVEL REPEATABLE READ; ${sel()} -- получено ${B}`, ''],
          [2, '', `BEGIN; ${upd(`${e.column} - ${a2}`)} COMMIT;`],
          [3, upd(`${e.column} - ${a1}`), ''],
          [4, 'COMMIT; -- если дошли до этого шага', ''],
        ];
        parts.push({
          id: 'p1',
          format: 'SINGLE_CHOICE',
          prompt: 'Что произойдёт с UPDATE транзакции T1 на шаге 3?',
          options: [
            opt('serialization', 'T1 получит ошибку could not serialize access due to concurrent update; транзакцию нужно повторить'),
            opt('stale', `UPDATE применится к значению ${B} из снимка T1 и перезапишет изменение T2`),
            opt('fresh', 'UPDATE применится к актуальному значению, как в READ COMMITTED'),
            opt('deadlock', 'Возникнет взаимоблокировка с T2'),
          ],
          correct: 'serialization',
          skillTags: ['postgresql', 'transactions', 'concurrency'],
        });
        parts.push(finalValue(e.column, B - a2, 'p2', 'Каким будет значение после шага 4, если T1 не повторяют?'));
        break;
      }
      case 'conditional': {
        rows = [
          [1, `BEGIN; ${upd(`${e.column} - ${a1}`, ` AND ${e.column} >= ${a1}`)}`, ''],
          [2, '', `BEGIN; ${upd(`${e.column} - ${a2}`, ` AND ${e.column} >= ${a2}`)}`],
          [3, 'COMMIT;', ''],
          [4, '', 'COMMIT;'],
        ];
        parts.push({
          id: 'p1',
          format: 'SINGLE_CHOICE',
          prompt: 'Чем завершится UPDATE транзакции T2 (шаг 2) после того, как T1 зафиксируется?',
          options: [
            opt('zero', 'UPDATE 0: условие перепроверено на новой версии строки и не выполнено'),
            opt('one', 'UPDATE 1: условие проверено по значению на момент начала оператора'),
            opt('serialization', 'Ошибка сериализации'),
            opt('deadlock', 'Взаимоблокировка'),
          ],
          correct: 'zero',
          skillTags: ['postgresql', 'concurrency'],
        });
        parts.push(finalValue(e.column, B - a1, 'p2'));
        break;
      }
      case 'write-skew': {
        const duty = DUTY[params.duty!];
        const n = params.onDuty!;
        const who = duty.names.slice(0, n);
        isolationNote = `Обе транзакции работают на уровне ${params.isolation}.`;
        const check = `SELECT count(*) FROM ${duty.table} WHERE ${duty.flag}; -- получено ${n}`;
        rows = [
          [1, `BEGIN; ${check}`, ''],
          [2, '', `BEGIN; ${check}`],
          [3, `UPDATE ${duty.table} SET ${duty.flag} = false WHERE name = '${who[0]}';`, ''],
          [4, '', `UPDATE ${duty.table} SET ${duty.flag} = false WHERE name = '${who[1]}';`],
          [5, 'COMMIT;', ''],
          [6, '', 'COMMIT;'],
        ];
        const serializable = params.isolation === 'SERIALIZABLE';
        const intro2 = text(
          `В таблице ${duty.table} на дежурстве ${n} ${duty.who}: ${who.join(', ')}. Правило: должен остаться хотя бы один дежурный. ` +
            'Каждая транзакция снимает с дежурства одного человека, если по результату проверки дежурных больше одного.',
        );
        parts.push({
          id: 'p1',
          format: 'SINGLE_CHOICE',
          prompt: 'Чем завершатся транзакции?',
          options: [
            opt('both', 'Обе зафиксируются'),
            opt('one-fails', 'Одна получит ошибку сериализации, другая зафиксируется'),
            opt('waits', 'T2 дождётся T1 и затем зафиксируется'),
            opt('both-fail', 'Обе получат ошибку'),
          ],
          correct: serializable ? 'one-fails' : 'both',
          skillTags: ['postgresql', 'transactions'],
        });
        parts.push({
          id: 'p2',
          format: 'NUMERIC',
          prompt: `Сколько ${duty.who} останется на дежурстве после шага 6 (без повторов)?`,
          correct: serializable ? n - 1 : n - 2,
          tolerance: 0,
          integer: true,
          skillTags: ['transactions', 'concurrency'],
        });
        return { title: 'Аномалия при параллельной проверке инварианта', context: [intro2, text(isolationNote), scheduleTable(rows)], parts };
      }
      case 'deadlock': {
        isolationNote = 'Уровень изоляции — READ COMMITTED. Строки id = 1 и id = 2 существуют.';
        const second = params.sameOrder ? [`BEGIN; ${updRow(e, 1, '+', a2)}`, updRow(e, 2, '-', a2)] : [`BEGIN; ${updRow(e, 2, '+', a2)}`, updRow(e, 1, '-', a2)];
        rows = [
          [1, `BEGIN; ${updRow(e, 1, '-', a1)}`, ''],
          [2, '', second[0]],
          [3, updRow(e, 2, '+', a1), ''],
          [4, '', second[1]],
          [5, 'COMMIT;', ''],
          [6, '', 'COMMIT;'],
        ];
        parts.push({
          id: 'p1',
          format: 'NUMERIC',
          prompt: 'Сколько транзакций успешно зафиксируется (без повторов)?',
          correct: params.sameOrder ? 2 : 1,
          tolerance: 0,
          integer: true,
          skillTags: ['postgresql', 'concurrency'],
        });
        parts.push({
          id: 'p2',
          format: 'SINGLE_CHOICE',
          prompt: 'Какое правило в коде переводов надёжно предотвращает взаимоблокировки такого вида?',
          options: [
            opt('order', 'Обновлять строки в едином порядке, например по возрастанию id'),
            opt('timeout', 'Увеличить deadlock_timeout'),
            opt('serializable', 'Перевести транзакции на SERIALIZABLE'),
            opt('index', `Создать индекс по ${e.table}.id`),
          ],
          correct: 'order',
          skillTags: ['transactions', 'concurrency'],
        });
        break;
      }
    }
    return { title: 'Параллельные транзакции', context: [intro, text(isolationNote), scheduleTable(rows)], parts };
  },
};

function updRow(e: (typeof ENTITIES)[number], id: number, sign: '+' | '-', amount: number): string {
  return `UPDATE ${e.table} SET ${e.column} = ${e.column} ${sign} ${amount} WHERE id = ${id};`;
}

function scheduleTable(rows: Array<Array<string | number>>): ContentBlock {
  return table(['Шаг', 'T1', 'T2'], rows);
}

function finalValue(column: string, value: number, id = 'p1', prompt?: string): AuthoredPart {
  return {
    id,
    format: 'NUMERIC',
    prompt: prompt ?? `Каким будет значение ${column} после всех шагов?`,
    correct: value,
    tolerance: 0,
    integer: true,
    skillTags: ['postgresql', 'transactions'],
  };
}
