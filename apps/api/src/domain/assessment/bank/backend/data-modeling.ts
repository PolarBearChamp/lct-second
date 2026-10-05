import type { GradeCode } from '../../../catalog/catalog';
import type { AuthoredPart, FamilyDefinition } from '../../types';
import { code, opt, text } from '../helpers';

/**
 * B4. Моделирование данных и ограничения целостности.
 * Junior — правила → ограничения (UNIQUE, CHECK, FK), тип связи сущностей.
 * Middle — уникальность по выражению, частичный уникальный индекс; порядок столбцов составного индекса.
 * Senior — EXCLUDE-ограничения; какие механизмы удерживают правило при конкурентных вставках.
 */

interface RuleDef {
  key: string;
  answer: string;
  grades: GradeCode[];
  variants: string[];
}

const RULES: RuleDef[] = [
  {
    key: 'once-pair',
    answer: 'unique-pair',
    grades: ['JUNIOR', 'MIDDLE', 'SENIOR'],
    variants: [
      'Пользователь может применить конкретный промокод не более одного раза',
      'Сотрудник может пройти конкретный обязательный курс только один раз',
      'Покупатель может оставить на товар не более одного отзыва',
    ],
  },
  {
    key: 'non-negative',
    answer: 'check',
    grades: ['JUNIOR', 'MIDDLE', 'SENIOR'],
    variants: [
      'Остаток товара на складе не может быть отрицательным',
      'Баланс бонусных баллов клиента не может быть отрицательным',
      'Число свободных мест на мероприятии не может быть меньше нуля',
    ],
  },
  {
    key: 'cascade',
    answer: 'fk-cascade',
    grades: ['JUNIOR', 'MIDDLE', 'SENIOR'],
    variants: [
      'При удалении заказа его позиции должны удаляться автоматически',
      'При удалении черновика документа удаляются все его вложения',
      'При удалении опроса удаляются все его вопросы',
    ],
  },
  {
    key: 'restrict',
    answer: 'fk-restrict',
    grades: ['JUNIOR', 'MIDDLE', 'SENIOR'],
    variants: [
      'Товар нельзя удалить, пока на него ссылаются позиции заказов',
      'Тариф нельзя удалить, пока на нём есть активные клиенты',
      'Склад нельзя удалить, пока к нему привязаны остатки',
    ],
  },
  {
    key: 'many-to-many',
    answer: 'junction',
    grades: ['JUNIOR', 'MIDDLE', 'SENIOR'],
    variants: [
      'Студент записывается на много курсов, на курсе много студентов; повторная запись запрещена',
      'Статья имеет много тегов, тег используется во многих статьях; тег не повторяется у статьи',
      'Сотрудник участвует во многих проектах, в проекте много сотрудников; повторное участие запрещено',
    ],
  },
  {
    key: 'money',
    answer: 'numeric',
    grades: ['JUNIOR', 'MIDDLE', 'SENIOR'],
    variants: [
      'Сумма платежа должна храниться точно, без ошибок двоичного округления',
      'Цена товара с копейками должна суммироваться без погрешностей',
    ],
  },
  {
    key: 'case-insensitive',
    answer: 'unique-expr',
    grades: ['MIDDLE', 'SENIOR'],
    variants: [
      'Email пользователя уникален без учёта регистра',
      'Логин уникален независимо от регистра букв',
    ],
  },
  {
    key: 'one-active',
    answer: 'partial-unique',
    grades: ['MIDDLE', 'SENIOR'],
    variants: [
      'У пользователя может быть только одна активная подписка; завершённых — сколько угодно',
      'У сотрудника может быть только одна открытая смена; закрытых — сколько угодно',
    ],
  },
  {
    key: 'no-overlap',
    answer: 'exclude',
    grades: ['SENIOR'],
    variants: [
      'Интервалы бронирования одной переговорной не должны пересекаться',
      'Периоды аренды одного автомобиля не должны пересекаться',
    ],
  },
];

const ANSWER_LABELS: Record<string, string> = {
  'unique-pair': 'UNIQUE на паре столбцов (например, (user_id, promo_code_id))',
  check: 'Ограничение CHECK (значение >= 0)',
  'fk-cascade': 'FOREIGN KEY … ON DELETE CASCADE',
  'fk-restrict': 'FOREIGN KEY … ON DELETE RESTRICT',
  junction: 'Связующая таблица с составным первичным ключом',
  numeric: 'Тип NUMERIC(12,2) вместо double precision',
  'unique-expr': 'Уникальный индекс по выражению lower(столбец)',
  'partial-unique': "Частичный уникальный индекс … WHERE status = 'active'",
  exclude: 'Ограничение EXCLUDE USING gist (объект WITH =, период WITH &&)',
  'not-null': 'Ограничение NOT NULL',
  'default-now': 'Значение по умолчанию now()',
};

// Junior: тип связи.
const RELATIONS = [
  { key: 'user-passport', text: 'пользователь и его паспорт (у пользователя не более одного паспорта, паспорт принадлежит одному пользователю)', answer: 'one-one' },
  { key: 'employee-desk', text: 'сотрудник и закреплённое рабочее место (одно место — за одним сотрудником)', answer: 'one-one' },
  { key: 'client-orders', text: 'клиент и его заказы (у заказа ровно один клиент)', answer: 'one-many' },
  { key: 'dept-employees', text: 'отдел и сотрудники (сотрудник работает в одном отделе)', answer: 'one-many' },
  { key: 'chat-messages', text: 'чат и сообщения в нём', answer: 'one-many' },
  { key: 'books-authors', text: 'книги и авторы (у книги может быть несколько авторов)', answer: 'many-many' },
  { key: 'products-categories', text: 'товары и категории (товар может быть в нескольких категориях)', answer: 'many-many' },
] as const;

// Middle: порядок столбцов в составном индексе.
const INDEX_CASES = [
  { table: 'events', eq: 'tenant_id', range: 'created_at' },
  { table: 'orders', eq: 'customer_id', range: 'ordered_at' },
  { table: 'messages', eq: 'chat_id', range: 'sent_at' },
  { table: 'payments', eq: 'account_id', range: 'paid_at' },
  { table: 'audit_log', eq: 'service', range: 'occurred_at' },
  { table: 'readings', eq: 'sensor_id', range: 'measured_at' },
];

// Senior: механизмы, удерживающие инвариант «одна активная запись» при конкурентных вставках.
const MECHANISMS = [
  { key: 'partial-index', label: "Частичный уникальный индекс по {owner} WHERE status = 'active'", correct: true },
  { key: 'serializable', label: 'Проверка и вставка в транзакции SERIALIZABLE с повтором при ошибке сериализации', correct: true },
  { key: 'advisory', label: 'pg_advisory_xact_lock по {owner} перед проверкой и вставкой в той же транзакции', correct: true },
  { key: 'app-select', label: 'SELECT в приложении перед INSERT в транзакции READ COMMITTED', correct: false },
  { key: 'full-unique', label: 'Уникальный индекс по {owner} для всех строк таблицы', correct: false },
  { key: 'trigger-count', label: 'Триггер BEFORE INSERT с SELECT count(*) при READ COMMITTED', correct: false },
];
const INVARIANTS = [
  { key: 'subscription', text: 'у пользователя не более одной активной подписки (история завершённых сохраняется)', owner: 'user_id' },
  { key: 'shift', text: 'у сотрудника не более одной открытой смены (закрытые смены сохраняются)', owner: 'employee_id' },
  { key: 'cart', text: 'у покупателя не более одной активной корзины (оформленные корзины сохраняются)', owner: 'customer_id' },
];

interface Params {
  rules: Array<{ key: string; variant: number }>;
  distractors: string[];
  relation?: string;
  indexCase?: number;
  invariant?: string;
  mechanisms?: string[];
}

export const dataModelingFamily: FamilyDefinition<Params> = {
  id: 'be.data-modeling',
  version: 1,
  specialization: 'BACKEND',
  group: 'BE_SQL',
  title: 'Моделирование данных и ограничения',
  description: 'Выбор ограничений целостности, типа связи, индексов и механизмов, удерживающих инварианты в PostgreSQL.',
  supportedGrades: ['JUNIOR', 'MIDDLE', 'SENIOR'],
  skillTags: ['sql', 'postgresql'],
  gradeNotes: {
    JUNIOR: 'Правила → UNIQUE/CHECK/FK, тип связи сущностей.',
    MIDDLE: 'Уникальность по выражению и частичный индекс; порядок столбцов составного индекса.',
    SENIOR: 'EXCLUDE-ограничения; механизмы, удерживающие инвариант при конкурентных вставках.',
  },
  sample(rng, grade) {
    const pool = RULES.filter((r) => r.grades.includes(grade));
    const ruleCount = grade === 'JUNIOR' ? 3 : 4;
    // Для Middle/Senior хотя бы одно правило уровня грейда.
    let chosen: RuleDef[];
    do chosen = rng.sample(pool, ruleCount);
    while (grade !== 'JUNIOR' && !chosen.some((r) => !r.grades.includes('JUNIOR')));
    const usedAnswers = new Set(chosen.map((r) => r.answer));
    const distractorPool = Object.keys(ANSWER_LABELS).filter((a) => !usedAnswers.has(a));
    const params: Params = {
      rules: chosen.map((r) => ({ key: r.key, variant: rng.int(0, r.variants.length - 1) })),
      distractors: rng.sample(distractorPool, 2).sort(),
    };
    if (grade === 'JUNIOR') params.relation = rng.pick(RELATIONS).key;
    if (grade === 'MIDDLE') params.indexCase = rng.int(0, INDEX_CASES.length - 1);
    if (grade === 'SENIOR') {
      params.invariant = rng.pick(INVARIANTS).key;
      let mechanisms: string[];
      do mechanisms = rng.sample(MECHANISMS.map((m) => m.key), 5);
      while (
        !mechanisms.some((k) => MECHANISMS.find((m) => m.key === k)!.correct) ||
        mechanisms.every((k) => MECHANISMS.find((m) => m.key === k)!.correct)
      );
      params.mechanisms = mechanisms.sort();
    }
    return params;
  },
  canonical(params) {
    return { ...params, rules: [...params.rules].sort((a, b) => a.key.localeCompare(b.key)) };
  },
  complexity(params) {
    return params.rules.length + (params.mechanisms?.length ?? 1);
  },
  build(params, grade) {
    const rules = params.rules.map((r) => ({ def: RULES.find((d) => d.key === r.key)!, variant: r.variant }));
    const answers = [...new Set([...rules.map((r) => r.def.answer), ...params.distractors])].sort();
    const parts: AuthoredPart[] = [
      {
        id: 'p1',
        format: 'MATCHING',
        prompt: 'Сопоставьте бизнес-правило со средством PostgreSQL, которое обеспечивает его на уровне базы данных.',
        left: rules.map((r) => opt(r.def.key, r.def.variants[r.variant])),
        right: answers.map((a) => opt(a, ANSWER_LABELS[a])),
        correct: Object.fromEntries(rules.map((r) => [r.def.key, r.def.answer])),
        skillTags: ['sql', 'postgresql'],
      },
    ];
    const context = [
      text('Вы проектируете схему PostgreSQL для нового сервиса. Правила должны соблюдаться на уровне базы данных, а не только в коде приложения.'),
    ];

    if (grade === 'JUNIOR') {
      const relation = RELATIONS.find((r) => r.key === params.relation)!;
      parts.push({
        id: 'p2',
        format: 'SINGLE_CHOICE',
        prompt: `Как связаны сущности: ${relation.text}? Выберите тип связи и способ его реализации.`,
        options: [
          opt('one-one', 'Один-к-одному: внешний ключ с ограничением UNIQUE'),
          opt('one-many', 'Один-ко-многим: внешний ключ в таблице на стороне «многие»'),
          opt('many-many', 'Многие-ко-многим: отдельная связующая таблица'),
          opt('array', 'Массив идентификаторов в каждой строке обеих таблиц'),
        ],
        correct: relation.answer,
        skillTags: ['sql'],
      });
    } else if (grade === 'MIDDLE') {
      const c = INDEX_CASES[params.indexCase!];
      context.push(code('sql', `SELECT *\nFROM ${c.table}\nWHERE ${c.eq} = $1 AND ${c.range} >= $2\nORDER BY ${c.range}\nLIMIT 20;`));
      parts.push({
        id: 'p2',
        format: 'SINGLE_CHOICE',
        prompt: `Таблица ${c.table} содержит миллионы строк, запрос выше выполняется очень часто. Какой индекс лучше всего подходит для него?`,
        options: [
          opt('eq-range', `CREATE INDEX ON ${c.table} (${c.eq}, ${c.range});`),
          opt('range-eq', `CREATE INDEX ON ${c.table} (${c.range}, ${c.eq});`),
          opt('range', `CREATE INDEX ON ${c.table} (${c.range});`),
          opt('separate', `Два отдельных индекса: (${c.eq}) и (${c.range})`),
        ],
        correct: 'eq-range',
        skillTags: ['sql', 'postgresql'],
      });
    } else {
      const invariant = INVARIANTS.find((i) => i.key === params.invariant)!;
      const mechanisms = params.mechanisms!.map((key) => MECHANISMS.find((m) => m.key === key)!);
      parts.push({
        id: 'p2',
        format: 'MULTI_SELECT',
        prompt: `Инвариант: ${invariant.text}. Какие из механизмов гарантируют его соблюдение при одновременных вставках из разных транзакций?`,
        options: mechanisms.map((m) => opt(m.key, m.label.replace('{owner}', invariant.owner))),
        correct: mechanisms.filter((m) => m.correct).map((m) => m.key),
        skillTags: ['postgresql'],
      });
    }
    return { title: 'Ограничения целостности в схеме данных', context, parts };
  },
};
