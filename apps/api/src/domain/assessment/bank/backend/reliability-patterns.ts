import type { GradeCode } from '../../../catalog/catalog';
import type { AuthoredPart, FamilyDefinition } from '../../types';
import { code, list, opt, text } from '../helpers';

/**
 * B6. Надёжность: повторы, очереди задач и transactional outbox.
 * Junior — экспоненциальная задержка повторов и выбор ошибок, которые стоит повторять.
 * Middle — очередь задач в PostgreSQL (FOR UPDATE SKIP LOCKED), падение воркера, гарантии доставки.
 * Senior — transactional outbox: повторная публикация после сбоя, свойства схемы, порядок шагов.
 */

type Pattern = 'backoff' | 'queue' | 'outbox';

const RETRYABLE = [
  { key: '503', label: '503 Service Unavailable', retry: true },
  { key: '429', label: '429 Too Many Requests (с учётом Retry-After)', retry: true },
  { key: 'timeout', label: 'Таймаут соединения', retry: true },
  { key: '504', label: '504 Gateway Timeout', retry: true },
  { key: '400', label: '400 Bad Request', retry: false },
  { key: '401', label: '401 Unauthorized', retry: false },
  { key: '422', label: '422 Unprocessable Content', retry: false },
  { key: '404', label: '404 Not Found', retry: false },
];

const TRANSFERS = [
  { key: 'accounts', text: 'Перевод 500 ₽ между двумя счетами выполняется двумя UPDATE в одной транзакции.' },
  { key: 'stock', text: 'Перемещение 3 единиц товара между складами выполняется двумя UPDATE в одной транзакции.' },
  { key: 'points', text: 'Перенос 200 бонусных баллов между клиентами выполняется двумя UPDATE в одной транзакции.' },
];

const QUEUE_DOMAINS = [
  { table: 'email_jobs', action: 'отправляет письмо', item: 'письмо' },
  { table: 'sms_jobs', action: 'отправляет SMS', item: 'SMS' },
  { table: 'webhook_jobs', action: 'вызывает вебхук партнёра', item: 'вызов вебхука' },
];

const OUTBOX_DOMAINS = [
  { entity: 'заказ', table: 'orders', event: 'OrderCreated' },
  { entity: 'платёж', table: 'payments', event: 'PaymentCaptured' },
  { entity: 'регистрация пользователя', table: 'users', event: 'UserRegistered' },
];

const OUTBOX_STATEMENTS = [
  { key: 'no-loss', label: 'Событие не теряется, если брокер недоступен в момент COMMIT', correct: true },
  { key: 'duplicates', label: 'Возможны повторные публикации: потребители должны обрабатывать события идемпотентно', correct: true },
  { key: 'atomic', label: 'Запись сущности и запись события в outbox фиксируются атомарно', correct: true },
  { key: 'exactly-once', label: 'Гарантирована доставка каждого события ровно один раз', correct: false },
  { key: 'orphan', label: 'Сущность может сохраниться без соответствующей записи в outbox', correct: false },
  { key: 'broker-in-tx', label: 'Публикация в брокер выполняется внутри транзакции, сохраняющей сущность', correct: false },
];

interface Params {
  pattern: Pattern;
  // backoff
  base?: number;
  factor?: number;
  cap?: number;
  maxRetries?: number;
  errors?: string[];
  transfer?: number;
  // queue
  domain?: number;
  pending?: number;
  workers?: number;
  batch?: number;
  queueQuestion?: 'guarantee' | 'no-skip';
  // outbox
  outboxDomain?: number;
  outboxBatch?: number;
  crashAfter?: number;
  perEvent?: boolean;
  statements?: string[];
}

export function totalBackoffMs(base: number, factor: number, cap: number, retries: number): number {
  let total = 0;
  for (let i = 0; i < retries; i += 1) total += Math.min(base * factor ** i, cap);
  return total;
}

const PATTERN_BY_GRADE: Record<GradeCode, Pattern> = { JUNIOR: 'backoff', MIDDLE: 'queue', SENIOR: 'outbox' };

export const reliabilityPatternsFamily: FamilyDefinition<Params> = {
  id: 'be.reliability-patterns',
  version: 1,
  specialization: 'BACKEND',
  group: 'BE_RELIABILITY',
  title: 'Надёжность: повторы, очереди и outbox',
  description: 'Расчёт политики повторов, поведение очереди задач в PostgreSQL и свойства transactional outbox.',
  supportedGrades: ['JUNIOR', 'MIDDLE', 'SENIOR'],
  skillTags: ['concurrency', 'transactions', 'postgresql'],
  gradeNotes: {
    JUNIOR: 'Экспоненциальная задержка с ограничением, выбор ошибок для повтора, атомарность транзакции при сбое.',
    MIDDLE: 'Очередь задач с FOR UPDATE SKIP LOCKED, падение воркера до COMMIT, гарантия «не менее одного раза».',
    SENIOR: 'Transactional outbox: повторная публикация после сбоя relay, свойства схемы, порядок шагов.',
  },
  sample(rng, grade) {
    const pattern = PATTERN_BY_GRADE[grade];
    if (pattern === 'backoff') {
      let errors: string[];
      do errors = rng.sample(RETRYABLE.map((r) => r.key), 5);
      while (errors.every((k) => RETRYABLE.find((r) => r.key === k)!.retry) || errors.every((k) => !RETRYABLE.find((r) => r.key === k)!.retry));
      return {
        pattern,
        base: rng.pick([100, 200, 250, 500]),
        factor: rng.pick([2, 3]),
        cap: rng.pick([1000, 2000, 3000, 5000]),
        maxRetries: rng.int(3, 6),
        errors: errors.sort(),
        transfer: rng.int(0, TRANSFERS.length - 1),
      };
    }
    if (pattern === 'queue') {
      const workers = rng.int(2, 4);
      const batch = rng.int(2, 5);
      return {
        pattern,
        domain: rng.int(0, QUEUE_DOMAINS.length - 1),
        workers,
        batch,
        pending: workers * batch + rng.int(1, 12),
        queueQuestion: rng.pick(['guarantee', 'no-skip'] as const),
      };
    }
    const outboxBatch = rng.int(3, 8);
    let statements: string[];
    do statements = rng.sample(OUTBOX_STATEMENTS.map((s) => s.key), 5);
    while (
      statements.every((k) => OUTBOX_STATEMENTS.find((s) => s.key === k)!.correct) ||
      statements.every((k) => !OUTBOX_STATEMENTS.find((s) => s.key === k)!.correct)
    );
    return {
      pattern,
      outboxDomain: rng.int(0, OUTBOX_DOMAINS.length - 1),
      outboxBatch,
      crashAfter: rng.int(2, outboxBatch),
      perEvent: rng.bool(),
      statements: statements.sort(),
    };
  },
  complexity(params) {
    if (params.pattern === 'backoff') return params.maxRetries! + 1;
    if (params.pattern === 'queue') return params.workers! + 2;
    return 6;
  },
  build(params) {
    const parts: AuthoredPart[] = [];
    if (params.pattern === 'backoff') {
      const { base, factor, cap, maxRetries } = params as Required<Params>;
      parts.push({
        id: 'p1',
        format: 'NUMERIC',
        prompt: 'Сколько миллисекунд клиент суммарно проведёт в задержках между попытками, прежде чем сдастся?',
        correct: totalBackoffMs(base, factor, cap, maxRetries),
        tolerance: 0,
        integer: true,
        unit: 'мс',
        skillTags: ['concurrency'],
      });
      const errors = params.errors!.map((key) => RETRYABLE.find((r) => r.key === key)!);
      parts.push({
        id: 'p2',
        format: 'MULTI_SELECT',
        prompt: 'При каких результатах автоматический повтор этого идемпотентного запроса оправдан?',
        options: errors.map((e) => opt(e.key, e.label)),
        correct: errors.filter((e) => e.retry).map((e) => e.key),
        skillTags: ['concurrency'],
      });
      const t = TRANSFERS[params.transfer!];
      parts.push({
        id: 'p3',
        format: 'SINGLE_CHOICE',
        prompt: `Отдельный вопрос. ${t.text} Процесс приложения упал после первого UPDATE, до COMMIT. Что произойдёт с данными?`,
        options: [
          opt('rollback', 'Оба значения останутся прежними: незафиксированная транзакция будет отменена'),
          opt('partial', 'Сохранится только первое изменение'),
          opt('double', 'При перезапуске изменения применятся дважды'),
          opt('locked', 'Строки останутся заблокированными до ручного вмешательства администратора'),
        ],
        correct: 'rollback',
        skillTags: ['transactions'],
      });
      return {
        title: 'Политика повторных попыток',
        context: [
          text('Клиент вызывает идемпотентный метод PUT /devices/{id}/settings. При ошибке он повторяет запрос по политике:'),
          list([
            `первая задержка перед повтором — ${base} мс;`,
            `каждая следующая задержка в ${factor} раза больше предыдущей, но не больше ${cap} мс;`,
            `не более ${maxRetries} повторов после первой попытки.`,
          ]),
          text('Сервер недоступен и на каждую попытку отвечает 503. Временем самих запросов пренебрегите.'),
        ],
        parts,
      };
    }

    if (params.pattern === 'queue') {
      const d = QUEUE_DOMAINS[params.domain!];
      const { workers, batch, pending } = params as Required<Params>;
      parts.push({
        id: 'p1',
        format: 'NUMERIC',
        prompt: `Сколько задач будет в статусе pending сразу после того, как все воркеры завершат первый цикл (включая аварийное завершение одного из них)?`,
        correct: pending - workers * batch + batch,
        tolerance: 0,
        integer: true,
        skillTags: ['postgresql', 'concurrency', 'transactions'],
      });
      if (params.queueQuestion === 'guarantee') {
        parts.push({
          id: 'p2',
          format: 'SINGLE_CHOICE',
          prompt: `Какую гарантию даёт такая схема относительно действия «${d.item}»?`,
          options: [
            opt('at-least-once', 'Не менее одного раза: после сбоя возможны повторы'),
            opt('exactly-once', 'Ровно один раз'),
            opt('at-most-once', 'Не более одного раза: после сбоя действие может потеряться'),
            opt('ordered', 'Строгий порядок выполнения по id без повторов'),
          ],
          correct: 'at-least-once',
          skillTags: ['transactions', 'concurrency'],
        });
      } else {
        parts.push({
          id: 'p2',
          format: 'SINGLE_CHOICE',
          prompt: 'Что изменится, если убрать из запроса SKIP LOCKED (оставив FOR UPDATE)?',
          options: [
            opt('wait', 'Воркеры будут ждать снятия блокировок со строк, захваченных другими воркерами, и работать фактически по очереди'),
            opt('duplicates', 'Несколько воркеров одновременно получат одни и те же задачи и обработают их параллельно'),
            opt('error', 'Запрос завершится ошибкой, если строка заблокирована'),
            opt('nothing', 'Ничего: FOR UPDATE без SKIP LOCKED работает так же'),
          ],
          correct: 'wait',
          skillTags: ['postgresql', 'concurrency'],
        });
      }
      return {
        title: 'Очередь задач в PostgreSQL',
        context: [
          text(`В таблице ${d.table} ${pending} задач в статусе pending. ${workers} воркера(ов) стартуют одновременно; каждый в своей транзакции выполняет:`),
          code(
            'sql',
            `BEGIN;\nSELECT id FROM ${d.table}\nWHERE status = 'pending'\nORDER BY id\nLIMIT ${batch}\nFOR UPDATE SKIP LOCKED;\n-- для каждой задачи воркер ${d.action}\nUPDATE ${d.table} SET status = 'done' WHERE id = ANY(:ids);\nCOMMIT;`,
          ),
          text(`Один из воркеров выполнил внешнее действие для всех своих задач, но процесс упал до COMMIT (транзакция откатилась). Остальные успешно зафиксировали изменения.`),
        ],
        parts,
      };
    }

    const d = OUTBOX_DOMAINS[params.outboxDomain!];
    const { outboxBatch, crashAfter, perEvent } = params as Required<Params>;
    parts.push({
      id: 'p1',
      format: 'NUMERIC',
      prompt: 'Сколько событий из этой пачки будет опубликовано повторно после перезапуска relay?',
      correct: perEvent ? 1 : crashAfter,
      tolerance: 0,
      integer: true,
      skillTags: ['transactions', 'concurrency'],
    });
    const statements = params.statements!.map((key) => OUTBOX_STATEMENTS.find((s) => s.key === key)!);
    parts.push({
      id: 'p2',
      format: 'MULTI_SELECT',
      prompt: 'Какие утверждения о схеме transactional outbox верны?',
      options: statements.map((s) => opt(s.key, s.label)),
      correct: statements.filter((s) => s.correct).map((s) => s.key),
      skillTags: ['transactions'],
    });
    parts.push({
      id: 'p3',
      format: 'ORDERING',
      prompt: 'Расположите шаги обработки в правильном порядке.',
      items: [
        opt('begin', 'BEGIN'),
        opt('insert-entity', `INSERT INTO ${d.table} …`),
        opt('insert-outbox', `INSERT INTO outbox (событие ${d.event})`),
        opt('commit', 'COMMIT'),
        opt('relay-select', 'Relay выбирает неопубликованные события (FOR UPDATE SKIP LOCKED)'),
        opt('publish', 'Relay публикует событие в брокер'),
        opt('mark', 'Relay отмечает событие опубликованным (published_at)'),
      ],
      correct: ['begin', 'insert-entity', 'insert-outbox', 'commit', 'relay-select', 'publish', 'mark'],
      skillTags: ['transactions', 'postgresql'],
    });
    return {
      title: 'Transactional outbox',
      context: [
        text(`Сервис сохраняет ${d.entity} и должен опубликовать событие ${d.event} в брокер сообщений. Используется transactional outbox.`),
        text(
          `Relay читает неопубликованные события пачками по ${outboxBatch} шт. и публикует их по одному. ` +
            (perEvent
              ? 'После публикации каждого события он сразу отмечает его опубликованным отдельной транзакцией.'
              : 'Отметку published_at он ставит одним UPDATE после публикации всей пачки.'),
        ),
        text(`Relay аварийно завершился сразу после публикации ${crashAfter}-го события пачки, до записи отметки об этом событии.`),
      ],
      parts,
    };
  },
};
