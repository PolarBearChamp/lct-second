import type { GradeCode } from '../../../catalog/catalog';
import type { AuthoredPart, FamilyDefinition, Rng } from '../../types';
import { list, opt, table, text } from '../helpers';

/**
 * Q2. Комбинации условий и таблицы решений.
 * Все ответы вычисляются перебором всех 2^n комбинаций условий.
 * Junior — правила «если … иначе» (первое сработавшее): число комбинаций с результатом, результат для заданной комбинации.
 * Middle — те же правила с затенённым правилом, которое никогда не сработает.
 * Senior — независимые правила с безразличными значениями: пробелы, конфликты и минимальный набор проверок.
 */

type Tri = 'T' | 'F' | '*';

interface Rule {
  cond: Tri[];
  outcome: number;
}

interface Params {
  variant: 'first' | 'shadow' | 'table';
  conds: number[];
  rules: Rule[];
  fallback?: number;
  askMask?: number;
  askOutcome?: number;
}

const CONDITIONS = [
  { name: 'клиент авторизован', pos: 'клиент авторизован', neg: 'клиент не авторизован' },
  { name: 'сумма от 5000 ₽', pos: 'сумма заказа не менее 5000 ₽', neg: 'сумма заказа менее 5000 ₽' },
  { name: 'применён промокод', pos: 'применён промокод', neg: 'промокод не применён' },
  { name: 'первый заказ', pos: 'это первый заказ клиента', neg: 'это не первый заказ клиента' },
  { name: 'доставка в другой город', pos: 'доставка в другой город', neg: 'доставка в тот же город' },
];
const OUTCOMES = [0, 3, 5, 7, 10, 12, 15, 20];

const matches = (rule: Rule, mask: number) => rule.cond.every((c, i) => c === '*' || ((mask >> i) & 1) === (c === 'T' ? 1 : 0));

export function firstMatch(rules: Rule[], fallback: number, mask: number): { outcome: number; rule: number } {
  const index = rules.findIndex((r) => matches(r, mask));
  return index >= 0 ? { outcome: rules[index].outcome, rule: index } : { outcome: fallback, rule: -1 };
}

export function minimalCover(rules: Rule[], size: number): number {
  const masks = Array.from({ length: 1 << size }, (_, m) => m);
  const covers = masks.map((m) => rules.map((r, i) => (matches(r, m) ? i : -1)).filter((i) => i >= 0));
  for (let k = 1; k <= rules.length; k += 1) {
    const pick = (start: number, chosen: number[]): boolean => {
      if (chosen.length === k) return new Set(chosen.flatMap((m) => covers[m])).size === rules.length;
      for (let m = start; m < masks.length; m += 1) if (pick(m + 1, [...chosen, m])) return true;
      return false;
    };
    if (pick(0, [])) return k;
  }
  return rules.length;
}

function describeCombo(conds: number[], mask: number): string {
  return conds.map((c, i) => (((mask >> i) & 1) === 1 ? CONDITIONS[c].pos : CONDITIONS[c].neg)).join('; ');
}

function describeRule(conds: number[], rule: Rule): string {
  const parts = rule.cond.map((v, i) => (v === 'T' ? CONDITIONS[conds[i]].pos : v === 'F' ? CONDITIONS[conds[i]].neg : null)).filter(Boolean);
  return `${parts.join(' и ')}`;
}

function randomRule(rng: Rng, size: number, outcome: number, minSpecified: number, maxSpecified: number): Rule {
  for (;;) {
    const cond = Array.from({ length: size }, () => rng.pick(['T', 'F', '*', '*'] as const));
    const specified = cond.filter((c) => c !== '*').length;
    if (specified >= minSpecified && specified <= maxSpecified) return { cond, outcome };
  }
}

export const decisionTablesFamily: FamilyDefinition<Params> = {
  id: 'qa.decision-tables',
  version: 1,
  specialization: 'MANUAL_QA',
  group: 'QA_REQUIREMENTS',
  title: 'Комбинации условий и таблицы решений',
  description: 'Результаты для комбинаций условий, затенённые правила, пробелы и конфликты в таблице решений.',
  supportedGrades: ['JUNIOR', 'MIDDLE', 'SENIOR'],
  skillTags: ['requirements-analysis', 'test-design'],
  gradeNotes: {
    JUNIOR: 'Правила «если … иначе» на трёх условиях: число комбинаций с результатом и результат для заданной комбинации.',
    MIDDLE: 'Четыре условия, затенённое правило, которое никогда не сработает.',
    SENIOR: 'Независимые правила с безразличными значениями: пробелы, конфликты и минимальный набор проверок.',
  },
  sample(rng: Rng, grade: GradeCode): Params {
    if (grade === 'JUNIOR') {
      for (let guard = 0; guard < 500; guard += 1) {
        const conds = rng.sample([0, 1, 2, 3, 4], 3);
        const outcomes = rng.sample(OUTCOMES, 4).sort((a, b) => b - a);
        const rules = [0, 1, 2].map((i) => randomRule(rng, 3, outcomes[i], 1, 2));
        const fallback = outcomes[3];
        const reached = new Set(Array.from({ length: 8 }, (_, m) => firstMatch(rules, fallback, m).rule));
        if (reached.size === 4) {
          const askMask = rng.int(0, 7);
          const askOutcome = rules[rng.int(0, 2)].outcome;
          return { variant: 'first', conds, rules, fallback, askMask, askOutcome };
        }
      }
      throw new Error('qa.decision-tables: генерация (Junior) не удалась');
    }
    if (grade === 'MIDDLE') {
      for (let guard = 0; guard < 2000; guard += 1) {
        const conds = rng.sample([0, 1, 2, 3, 4], 4);
        const outcomes = rng.sample(OUTCOMES, 5);
        const rules = [0, 1, 2, 3].map((i) => randomRule(rng, 4, outcomes[i], 1, 3));
        const fallback = outcomes[4];
        const reached = new Set(Array.from({ length: 16 }, (_, m) => firstMatch(rules, fallback, m).rule));
        const unreachable = [0, 1, 2, 3].filter((r) => !reached.has(r));
        if (unreachable.length === 1 && reached.has(-1)) {
          return { variant: 'shadow', conds, rules, fallback, askMask: rng.int(0, 15), askOutcome: rules[rng.int(0, 3)].outcome };
        }
      }
      throw new Error('qa.decision-tables: генерация (Middle) не удалась');
    }
    for (let guard = 0; guard < 5000; guard += 1) {
      const conds = rng.sample([0, 1, 2, 3, 4], 4);
      const outcomes = rng.sample(OUTCOMES, 4);
      const rules = outcomes.map((o) => randomRule(rng, 4, o, 2, 3));
      const covers = Array.from({ length: 16 }, (_, m) => rules.filter((r) => matches(r, m)).length);
      const gaps = covers.filter((c) => c === 0).length;
      const conflicts = covers.filter((c) => c >= 2).length;
      const cover = minimalCover(rules, 4);
      if (gaps >= 2 && gaps <= 8 && conflicts >= 2 && conflicts <= 6 && cover >= 2 && rules.every((r) => covers.some((_, m) => matches(r, m)))) {
        return { variant: 'table', conds, rules };
      }
    }
    throw new Error('qa.decision-tables: генерация (Senior) не удалась');
  },
  complexity(params) {
    return params.rules.length * 2 + params.conds.length;
  },
  build(params) {
    const size = params.conds.length;
    const total = 1 << size;
    const parts: AuthoredPart[] = [];
    const header = text(`Скидка в интернет-магазине зависит от ${size} условий: ${params.conds.map((c) => CONDITIONS[c].name).join('; ')}.`);

    if (params.variant === 'table') {
      const rules = params.rules;
      const covers = Array.from({ length: total }, (_, m) => rules.filter((r) => matches(r, m)).length);
      parts.push({ id: 'p1', format: 'NUMERIC', prompt: `Для скольких из ${total} комбинаций условий не сработает ни одно правило?`, correct: covers.filter((c) => c === 0).length, tolerance: 0, integer: true, skillTags: ['requirements-analysis', 'test-design'] });
      parts.push({ id: 'p2', format: 'NUMERIC', prompt: 'Для скольких комбинаций сработают сразу несколько правил с разными скидками (конфликт)?', correct: covers.filter((c) => c >= 2).length, tolerance: 0, integer: true, skillTags: ['requirements-analysis'] });
      parts.push({ id: 'p3', format: 'NUMERIC', prompt: 'Каково минимальное число проверок (комбинаций условий), при котором каждое правило сработает хотя бы раз?', correct: minimalCover(rules, size), tolerance: 0, integer: true, skillTags: ['test-design', 'requirements-analysis'] });
      return {
        title: 'Таблица решений: пробелы и конфликты',
        context: [
          header,
          text('Правила независимы: комбинация подходит правилу, если совпадают все указанные в нём значения; «—» — условие безразлично. Приоритета у правил нет.'),
          table(['Правило', ...params.conds.map((c) => CONDITIONS[c].name), 'Скидка'], rules.map((r, i) => [`№${i + 1}`, ...r.cond.map((v) => (v === 'T' ? 'да' : v === 'F' ? 'нет' : '—')), `${r.outcome}%`])),
        ],
        parts,
      };
    }

    const rules = params.rules;
    const fallback = params.fallback!;
    const outcomes = Array.from({ length: total }, (_, m) => firstMatch(rules, fallback, m));
    const ruleText = [...rules.map((r, i) => `${i === 0 ? 'Если' : 'Иначе если'} ${describeRule(params.conds, r)} — скидка ${r.outcome}%.`), `Иначе — скидка ${fallback}%.`];
    const target = params.askOutcome!;
    parts.push({ id: 'p1', format: 'NUMERIC', prompt: `Для скольких из ${total} комбинаций условий скидка составит ${target}%?`, correct: outcomes.filter((o) => o.outcome === target).length, tolerance: 0, integer: true, skillTags: ['requirements-analysis', 'test-design'] });
    const askMask = params.askMask!;
    const distinct = [...new Set([...rules.map((r) => r.outcome), fallback])].sort((a, b) => a - b);
    parts.push({ id: 'p2', format: 'SINGLE_CHOICE', prompt: `Какая скидка полагается, если: ${describeCombo(params.conds, askMask)}?`, options: distinct.map((o) => opt(`o${o}`, `${o}%`)), correct: `o${outcomes[askMask].outcome}`, skillTags: ['requirements-analysis'] });
    if (params.variant === 'first') {
      parts.push({ id: 'p3', format: 'NUMERIC', prompt: 'Сколько строк в полной таблице решений (по одной на каждую комбинацию значений условий)?', correct: total, tolerance: 0, integer: true, skillTags: ['test-design'] });
    } else {
      const reached = new Set(outcomes.map((o) => o.rule));
      const unreachable = rules.map((_, r) => r).filter((r) => !reached.has(r));
      parts.push({ id: 'p3', format: 'SINGLE_CHOICE', prompt: 'Какое правило никогда не сработает (все его комбинации перехвачены предыдущими правилами)?', options: rules.map((_, r) => opt(`r${r}`, `Правило ${r + 1}`)).concat(opt('none', 'Все правила достижимы')), correct: `r${unreachable[0]}`, skillTags: ['test-design', 'requirements-analysis'] });
    }
    return {
      title: params.variant === 'first' ? 'Скидки: правила по приоритету' : 'Скидки: затенённое правило',
      context: [header, text('Правила проверяются сверху вниз, применяется первое подходящее:'), list(ruleText)],
      parts,
    };
  },
};
