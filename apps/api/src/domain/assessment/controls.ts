import type { GradeCode } from '../catalog/catalog';
import { getFamily } from './bank/registry';
import { evaluateItem, evaluatePart } from './evaluate';
import { instantiate } from './instantiate';
import type { ItemAnswer, PartAnswer, PartKey, PrivateTaskInstance, PublicOption, PublicPart } from './types';

/**
 * Контрольные примеры банка — экземпляры, решённые ВРУЧНУЮ по публичному условию (без обращения к закрытому ключу).
 * Ответ записан текстом вариантов (точным или уникальным началом), поэтому не зависит от непрозрачных id.
 * Из ручного верного ответа по правилам, не зависящим от генератора, строятся неверные и граничные ответы:
 * лишний/пропущенный вариант, перестановка соседних элементов, значение на границе допуска и сразу за ней и т. п.
 *
 * Контроль привязан к версии семейства и отпечатку экземпляра: если генератор изменился, контроль сообщает об этом
 * явно (INSTANCE_CHANGED / STALE_VERSION), а не проходит молча.
 */
export interface ControlEntry {
  family: string;
  familyVersion: number;
  grade: GradeCode;
  seed: string;
  fingerprint: string;
  /** Ответ по id части: строка (SINGLE_CHOICE / текстовый ответ), массив (MULTI_SELECT, ORDERING), число (NUMERIC), объект (MATCHING). */
  solution: Record<string, unknown>;
  notes: string;
}

export type ControlStatus = 'PASS' | 'FAIL' | 'STALE_VERSION' | 'INSTANCE_CHANGED';

export interface ControlResult {
  id: string;
  family: string;
  grade: GradeCode;
  status: ControlStatus;
  parts: number;
  /** Части, где ручной ответ не совпал с ключом генератора (возможна ошибка ручного решения или генератора). */
  handMismatches: Array<{ part: string; format: string; hand: string; key: string }>;
  probes: number;
  probeFailures: Array<{ part: string; kind: string; detail: string }>;
  /** Сколько проб каждого вида выполнено (для отчёта). */
  probeKinds: Record<string, number>;
  error?: string;
}

const controlId = (entry: Pick<ControlEntry, 'family' | 'grade'>) => `${entry.family}:${entry.grade}`;

/** Точное совпадение предпочитается; иначе допускается единственное совпадение по началу текста. */
function resolveOption(options: PublicOption[], ref: unknown, where: string): string {
  if (typeof ref !== 'string') throw new Error(`${where}: ожидается текст варианта, получено ${JSON.stringify(ref)}`);
  const exact = options.filter((option) => option.label === ref);
  if (exact.length === 1) return exact[0].id;
  if (exact.length > 1) throw new Error(`${where}: «${ref}» совпадает с несколькими вариантами`);
  const prefixed = options.filter((option) => option.label.startsWith(ref));
  if (prefixed.length === 1) return prefixed[0].id;
  throw new Error(`${where}: «${ref}» ${prefixed.length ? 'совпадает с несколькими вариантами' : 'не найден среди вариантов'}`);
}

function handAnswer(part: PublicPart, value: unknown): PartAnswer {
  const where = `часть ${part.id}`;
  switch (part.format) {
    case 'SINGLE_CHOICE':
      return { optionId: resolveOption(part.options, value, where) };
    case 'MULTI_SELECT': {
      if (!Array.isArray(value)) throw new Error(`${where}: ожидается массив вариантов`);
      return { optionIds: value.map((ref) => resolveOption(part.options, ref, where)) };
    }
    case 'NUMERIC': {
      if (typeof value !== 'number') throw new Error(`${where}: ожидается число`);
      return { value };
    }
    case 'ORDERING': {
      if (!Array.isArray(value)) throw new Error(`${where}: ожидается массив элементов в порядке`);
      return { order: value.map((ref) => resolveOption(part.items, ref, where)) };
    }
    case 'MATCHING': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${where}: ожидается объект «слева → справа»`);
      const pairs: Record<string, string> = {};
      for (const [leftRef, rightRef] of Object.entries(value as Record<string, unknown>)) {
        pairs[resolveOption(part.left, leftRef, `${where} (слева)`)] = resolveOption(part.right, rightRef, `${where} (справа)`);
      }
      return { pairs };
    }
  }
}

const labelOf = (options: PublicOption[], id: string) => options.find((o) => o.id === id)?.label ?? id;

/** Текст ключа для диагностики расхождений (только в отчёте валидации). */
function describeKey(part: PublicPart, key: PartKey): string {
  switch (key.format) {
    case 'SINGLE_CHOICE':
      return labelOf((part as Extract<PublicPart, { format: 'SINGLE_CHOICE' }>).options, key.correctOptionId);
    case 'MULTI_SELECT':
      return key.correctOptionIds.map((id) => labelOf((part as Extract<PublicPart, { format: 'MULTI_SELECT' }>).options, id)).join(' | ');
    case 'NUMERIC':
      return `${key.correctValue} (допуск ${key.tolerance})`;
    case 'ORDERING':
      return key.correctOrder.map((id) => labelOf((part as Extract<PublicPart, { format: 'ORDERING' }>).items, id)).join(' → ');
    case 'MATCHING': {
      const p = part as Extract<PublicPart, { format: 'MATCHING' }>;
      return Object.entries(key.correctPairs).map(([l, r]) => `${labelOf(p.left, l)} = ${labelOf(p.right, r)}`).join(' | ');
    }
  }
}

function describeAnswer(part: PublicPart, answer: PartAnswer): string {
  if ('optionId' in answer) return labelOf((part as Extract<PublicPart, { format: 'SINGLE_CHOICE' }>).options, answer.optionId);
  if ('optionIds' in answer) return answer.optionIds.map((id) => labelOf((part as Extract<PublicPart, { format: 'MULTI_SELECT' }>).options, id)).join(' | ');
  if ('value' in answer) return String(answer.value);
  if ('order' in answer) return answer.order.map((id) => labelOf((part as Extract<PublicPart, { format: 'ORDERING' }>).items, id)).join(' → ');
  const p = part as Extract<PublicPart, { format: 'MATCHING' }>;
  return Object.entries(answer.pairs).map(([l, r]) => `${labelOf(p.left, l)} = ${labelOf(p.right, r)}`).join(' | ');
}

interface Probe {
  kind: string;
  answer: PartAnswer | null;
  /** Ожидаемый балл части: 1 — принять, 0 — отклонить. */
  expect: 0 | 1;
  detail: string;
}

/** Неверные и граничные ответы по ручному верному ответу. Правила построения не используют ключ генератора, кроме допуска NUMERIC. */
function probesFor(part: PublicPart, hand: PartAnswer, key: PartKey): Probe[] {
  const probes: Probe[] = [{ kind: 'не отвечено', answer: null, expect: 0, detail: 'пустой ответ' }];
  switch (part.format) {
    case 'SINGLE_CHOICE': {
      const chosen = (hand as { optionId: string }).optionId;
      for (const option of part.options.filter((o) => o.id !== chosen)) {
        probes.push({ kind: 'неверный вариант', answer: { optionId: option.id }, expect: 0, detail: option.label.slice(0, 60) });
      }
      break;
    }
    case 'MULTI_SELECT': {
      const chosen = (hand as { optionIds: string[] }).optionIds;
      probes.push({ kind: 'выбраны все варианты', answer: { optionIds: part.options.map((o) => o.id) }, expect: 0, detail: 'все варианты' });
      probes.push({ kind: 'пустой выбор', answer: { optionIds: [] }, expect: 0, detail: '[]' });
      if (chosen.length >= 2) {
        for (const id of chosen) probes.push({ kind: 'пропущен верный', answer: { optionIds: chosen.filter((c) => c !== id) }, expect: 0, detail: labelOf(part.options, id).slice(0, 50) });
      }
      for (const option of part.options.filter((o) => !chosen.includes(o.id))) {
        probes.push({ kind: 'лишний вариант', answer: { optionIds: [...chosen, option.id] }, expect: 0, detail: option.label.slice(0, 50) });
      }
      break;
    }
    case 'NUMERIC': {
      const value = (hand as { value: number }).value;
      const tolerance = key.format === 'NUMERIC' ? key.tolerance : 0;
      const step = part.integer ? 1 : 0.01;
      const round = (n: number) => Math.round(n * 1e6) / 1e6;
      if (tolerance > 0) {
        probes.push({ kind: 'граница допуска (принять)', answer: { value: round(value + tolerance) }, expect: 1, detail: `+${tolerance}` });
        probes.push({ kind: 'граница допуска (принять)', answer: { value: round(value - tolerance) }, expect: 1, detail: `−${tolerance}` });
      }
      probes.push({ kind: 'за границей допуска', answer: { value: round(value + tolerance + step) }, expect: 0, detail: `+${round(tolerance + step)}` });
      probes.push({ kind: 'за границей допуска', answer: { value: round(value - tolerance - step) }, expect: 0, detail: `−${round(tolerance + step)}` });
      probes.push({ kind: 'грубая ошибка', answer: { value: round(value * 2 + 7) }, expect: 0, detail: 'значение ×2 + 7' });
      break;
    }
    case 'ORDERING': {
      const order = (hand as { order: string[] }).order;
      for (let i = 0; i < order.length - 1; i += 1) {
        const swapped = [...order];
        [swapped[i], swapped[i + 1]] = [swapped[i + 1], swapped[i]];
        probes.push({ kind: 'соседи переставлены', answer: { order: swapped }, expect: 0, detail: `${i + 1}↔${i + 2}` });
      }
      probes.push({ kind: 'обратный порядок', answer: { order: [...order].reverse() }, expect: 0, detail: 'reverse' });
      const shown = part.items.map((o) => o.id);
      if (shown.join() !== order.join()) probes.push({ kind: 'порядок «как показан»', answer: { order: shown }, expect: 0, detail: 'без изменений' });
      break;
    }
    case 'MATCHING': {
      const pairs = (hand as { pairs: Record<string, string> }).pairs;
      for (const [left, right] of Object.entries(pairs)) {
        for (const option of part.right.filter((o) => o.id !== right)) {
          probes.push({ kind: 'неверная пара', answer: { pairs: { ...pairs, [left]: option.id } }, expect: 0, detail: `${labelOf(part.left, left).slice(0, 30)} → ${option.label.slice(0, 30)}` });
        }
        const { [left]: _omitted, ...rest } = pairs;
        probes.push({ kind: 'пара пропущена', answer: { pairs: rest }, expect: 0, detail: labelOf(part.left, left).slice(0, 40) });
      }
      break;
    }
  }
  return probes;
}

export function runControl(entry: ControlEntry): ControlResult {
  const base: ControlResult = {
    id: controlId(entry),
    family: entry.family,
    grade: entry.grade,
    status: 'FAIL',
    parts: 0,
    handMismatches: [],
    probes: 0,
    probeFailures: [],
    probeKinds: {},
  };
  try {
    const family = getFamily(entry.family);
    if (!family) return { ...base, error: `Семейство ${entry.family} не найдено` };
    if (family.version !== entry.familyVersion) {
      return { ...base, status: 'STALE_VERSION', error: `контроль для версии ${entry.familyVersion}, семейство уже v${family.version}` };
    }
    const instance: PrivateTaskInstance = instantiate(family, entry.grade, entry.seed);
    if (instance.fingerprint !== entry.fingerprint) {
      return { ...base, status: 'INSTANCE_CHANGED', error: `отпечаток экземпляра изменился: контроль ${entry.fingerprint}, генератор ${instance.fingerprint}; решите экземпляр заново` };
    }

    const parts = instance.public.parts;
    base.parts = parts.length;
    const hand: ItemAnswer = { parts: {} };
    for (const part of parts) {
      if (!(part.id in entry.solution)) throw new Error(`нет ручного решения части ${part.id}`);
      hand.parts[part.id] = handAnswer(part, entry.solution[part.id]);
    }
    if (Object.keys(entry.solution).length !== parts.length) throw new Error('в контроле есть лишние части');

    // 1. Ручной ответ против ключа генератора.
    const evaluated = evaluateItem(instance.key, hand);
    for (const [index, part] of parts.entries()) {
      if (!evaluated.parts[index].correct) {
        base.handMismatches.push({
          part: part.id,
          format: part.format,
          hand: describeAnswer(part, hand.parts[part.id]!),
          key: describeKey(part, instance.key.parts[index]),
        });
      }
    }

    // 2. Пробы: неверные и граничные ответы строятся от ручного решения.
    const count = (kind: string) => {
      base.probes += 1;
      base.probeKinds[kind] = (base.probeKinds[kind] ?? 0) + 1;
    };
    for (const [index, part] of parts.entries()) {
      const key = instance.key.parts[index];
      if (!evaluated.parts[index].correct) continue; // проба строится только от подтверждённого ручного ответа
      for (const probe of probesFor(part, hand.parts[part.id]!, key)) {
        count(probe.kind);
        const single = evaluatePart(key, probe.answer);
        if (single.score !== probe.expect) {
          base.probeFailures.push({ part: part.id, kind: probe.kind, detail: `${probe.detail}: ожидалось ${probe.expect}, получено ${single.score}` });
          continue;
        }
        // Часть оценивается независимо: ошибка в одной части не меняет балл остальных.
        const mixed: ItemAnswer = { parts: { ...hand.parts, [part.id]: probe.answer } };
        const item = evaluateItem(instance.key, mixed);
        if (item.earned !== evaluated.earned - (1 - probe.expect)) {
          base.probeFailures.push({ part: part.id, kind: `${probe.kind} (независимость частей)`, detail: `итоговый балл ${item.earned} из ${item.total}` });
        }
      }
    }
    count('пустой ответ целиком');
    if (evaluateItem(instance.key, { parts: {} }).earned !== 0) base.probeFailures.push({ part: '*', kind: 'пустой ответ целиком', detail: 'балл должен быть 0' });

    // 3. Допуск числовых частей должен соответствовать формулировке («целое» — без допуска, «до сотых» — не более 0.01).
    for (const [index, part] of parts.entries()) {
      const key = instance.key.parts[index];
      if (part.format !== 'NUMERIC' || key.format !== 'NUMERIC') continue;
      count('допуск числовой части');
      if (part.integer && key.tolerance !== 0) base.probeFailures.push({ part: part.id, kind: 'допуск числовой части', detail: `целый ответ с допуском ${key.tolerance}` });
      if (!part.integer && !(key.tolerance > 0 && key.tolerance <= 0.01)) {
        base.probeFailures.push({ part: part.id, kind: 'допуск числовой части', detail: `дробный ответ с допуском ${key.tolerance} (ожидается 0 < допуск ≤ 0.01)` });
      }
    }

    base.status = base.handMismatches.length || base.probeFailures.length ? 'FAIL' : 'PASS';
    return base;
  } catch (error) {
    return { ...base, status: 'FAIL', error: (error as Error).message };
  }
}
