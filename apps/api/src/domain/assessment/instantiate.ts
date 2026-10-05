import { createHash } from 'node:crypto';
import { isKnownSkill, type GradeCode } from '../catalog/catalog';
import { createRng } from './rng';
import type {
  AuthoredOption,
  AuthoredPart,
  AuthoredTask,
  FamilyDefinition,
  PartKey,
  PrivateTaskInstance,
  PublicOption,
  PublicPart,
} from './types';

/** Стабильная сериализация (сортировка ключей объектов) для отпечатков. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

export function fingerprintOf(family: FamilyDefinition<unknown>, grade: GradeCode, params: unknown): string {
  const canonical = family.canonical ? family.canonical(params, grade) : params;
  return createHash('sha256')
    .update(stableStringify({ family: family.id, version: family.version, grade, canonical }))
    .digest('hex')
    .slice(0, 32);
}

export class InvalidTaskError extends Error {
  constructor(familyId: string, problems: string[]) {
    super(`Семейство ${familyId}: некорректный экземпляр — ${problems.join('; ')}`);
    this.name = 'InvalidTaskError';
  }
}

/**
 * Структурная проверка экземпляра: однозначность ключа, отсутствие дублей вариантов,
 * невозможность получить балл выбором всех вариантов и т. п.
 */
export function validateAuthoredTask(family: FamilyDefinition<unknown>, task: AuthoredTask): string[] {
  const problems: string[] = [];
  if (!task.title.trim()) problems.push('пустой заголовок');
  if (task.parts.length < 2) problems.push('в кейсе должно быть не менее двух оцениваемых частей');
  const partIds = new Set<string>();
  for (const part of task.parts) {
    if (partIds.has(part.id)) problems.push(`повтор id части ${part.id}`);
    partIds.add(part.id);
    if (!part.prompt.trim()) problems.push(`${part.id}: пустая формулировка`);
    if (part.skillTags.length === 0) problems.push(`${part.id}: не указаны навыки`);
    for (const tag of part.skillTags) {
      if (!family.skillTags.includes(tag)) problems.push(`${part.id}: навык ${tag} не объявлен в семействе`);
      if (!isKnownSkill(tag)) problems.push(`${part.id}: навык ${tag} отсутствует в справочнике`);
    }
    problems.push(...validatePart(part));
  }
  return problems;
}

function uniqueOptions(partId: string, options: AuthoredOption[], what: string): string[] {
  const problems: string[] = [];
  const keys = new Set(options.map((o) => o.key));
  const labels = new Set(options.map((o) => o.label.trim().toLowerCase()));
  if (keys.size !== options.length) problems.push(`${partId}: повторяются ключи ${what}`);
  if (labels.size !== options.length) problems.push(`${partId}: повторяются формулировки ${what}`);
  if (options.some((o) => !o.label.trim())) problems.push(`${partId}: пустой вариант`);
  return problems;
}

function validatePart(part: AuthoredPart): string[] {
  const problems: string[] = [];
  switch (part.format) {
    case 'SINGLE_CHOICE': {
      if (part.options.length < 3) problems.push(`${part.id}: нужно не менее трёх вариантов`);
      problems.push(...uniqueOptions(part.id, part.options, 'вариантов'));
      if (!part.options.some((o) => o.key === part.correct)) problems.push(`${part.id}: правильный вариант отсутствует`);
      break;
    }
    case 'MULTI_SELECT': {
      if (part.options.length < 3) problems.push(`${part.id}: нужно не менее трёх вариантов`);
      problems.push(...uniqueOptions(part.id, part.options, 'вариантов'));
      const keys = new Set(part.options.map((o) => o.key));
      if (part.correct.length === 0) problems.push(`${part.id}: пустое множество правильных ответов`);
      if (new Set(part.correct).size !== part.correct.length) problems.push(`${part.id}: дубли в правильных ответах`);
      if (part.correct.some((k) => !keys.has(k))) problems.push(`${part.id}: правильный вариант отсутствует среди вариантов`);
      if (part.correct.length >= part.options.length) problems.push(`${part.id}: выбор всех вариантов не должен быть правильным`);
      break;
    }
    case 'NUMERIC': {
      if (!Number.isFinite(part.correct)) problems.push(`${part.id}: ответ не является конечным числом`);
      if (!(part.tolerance >= 0)) problems.push(`${part.id}: некорректный допуск`);
      if (part.integer && !Number.isInteger(part.correct)) problems.push(`${part.id}: ожидается целый ответ`);
      break;
    }
    case 'MATCHING': {
      if (part.left.length < 2 || part.right.length < 2) problems.push(`${part.id}: нужно не менее двух элементов с каждой стороны`);
      problems.push(...uniqueOptions(part.id, part.left, 'левой колонки'));
      problems.push(...uniqueOptions(part.id, part.right, 'правой колонки'));
      const rightKeys = new Set(part.right.map((o) => o.key));
      for (const left of part.left) {
        const target = part.correct[left.key];
        if (!target || !rightKeys.has(target)) problems.push(`${part.id}: для «${left.label}» нет корректного соответствия`);
      }
      if (Object.keys(part.correct).length !== part.left.length) problems.push(`${part.id}: лишние соответствия`);
      break;
    }
    case 'ORDERING': {
      if (part.items.length < 3) problems.push(`${part.id}: нужно не менее трёх элементов`);
      problems.push(...uniqueOptions(part.id, part.items, 'элементов'));
      const keys = part.items.map((o) => o.key).sort();
      const order = [...part.correct].sort();
      if (keys.length !== order.length || keys.some((k, i) => k !== order[i])) {
        problems.push(`${part.id}: правильный порядок не является перестановкой элементов`);
      }
      break;
    }
  }
  return problems;
}

function opaqueId(seed: string, partId: string, key: string, kind: string): string {
  return 'o' + createHash('sha256').update(`${seed}|${partId}|${kind}|${key}`).digest('base64url').slice(0, 10);
}

/** Генерация экземпляра: параметры → авторское задание → проверка → публичная часть + закрытый ключ. */
export function instantiate(family: FamilyDefinition<unknown>, grade: GradeCode, seed: string): PrivateTaskInstance {
  if (!family.supportedGrades.includes(grade)) {
    throw new Error(`Семейство ${family.id} не поддерживает грейд ${grade}`);
  }
  const rng = createRng(`${family.id}|v${family.version}|${grade}|${seed}|params`);
  const params = family.sample(rng, grade);
  return instantiateFromParams(family, grade, params, seed);
}

export function instantiateFromParams(
  family: FamilyDefinition<unknown>,
  grade: GradeCode,
  params: unknown,
  seed: string,
): PrivateTaskInstance {
  const authored = family.build(params, grade);
  const problems = validateAuthoredTask(family, authored);
  if (problems.length) throw new InvalidTaskError(family.id, problems);

  const shuffleRng = createRng(`${family.id}|v${family.version}|${grade}|${seed}|shuffle`);
  const semanticMap: Record<string, string> = {};
  const publicParts: PublicPart[] = [];
  const keys: PartKey[] = [];

  const mapOptions = (partId: string, options: AuthoredOption[], kind: string): { list: PublicOption[]; idOf: (key: string) => string } => {
    const ids = new Map<string, string>();
    for (const option of options) {
      const id = opaqueId(seed, partId, option.key, kind);
      ids.set(option.key, id);
      semanticMap[id] = `${partId}:${kind}:${option.key}`;
    }
    return {
      list: shuffleRng.shuffle(options).map((option) => ({ id: ids.get(option.key)!, label: option.label })),
      idOf: (key: string) => ids.get(key)!,
    };
  };

  for (const part of authored.parts) {
    switch (part.format) {
      case 'SINGLE_CHOICE': {
        const mapped = mapOptions(part.id, part.options, 'opt');
        publicParts.push({ id: part.id, format: part.format, prompt: part.prompt, options: mapped.list });
        keys.push({ partId: part.id, format: part.format, skillTags: part.skillTags, correctOptionId: mapped.idOf(part.correct) });
        break;
      }
      case 'MULTI_SELECT': {
        const mapped = mapOptions(part.id, part.options, 'opt');
        publicParts.push({ id: part.id, format: part.format, prompt: part.prompt, options: mapped.list });
        keys.push({
          partId: part.id,
          format: part.format,
          skillTags: part.skillTags,
          correctOptionIds: part.correct.map(mapped.idOf).sort(),
        });
        break;
      }
      case 'NUMERIC': {
        publicParts.push({ id: part.id, format: part.format, prompt: part.prompt, integer: part.integer, unit: part.unit });
        keys.push({
          partId: part.id,
          format: part.format,
          skillTags: part.skillTags,
          correctValue: part.correct,
          tolerance: part.tolerance,
          integer: part.integer,
        });
        break;
      }
      case 'MATCHING': {
        const left = mapOptions(part.id, part.left, 'left');
        const right = mapOptions(part.id, part.right, 'right');
        const correctPairs: Record<string, string> = {};
        for (const [leftKey, rightKey] of Object.entries(part.correct)) correctPairs[left.idOf(leftKey)] = right.idOf(rightKey);
        publicParts.push({ id: part.id, format: part.format, prompt: part.prompt, left: left.list, right: right.list });
        keys.push({ partId: part.id, format: part.format, skillTags: part.skillTags, correctPairs });
        break;
      }
      case 'ORDERING': {
        const mapped = mapOptions(part.id, part.items, 'item');
        const correctOrder = part.correct.map(mapped.idOf);
        let display = mapped.list;
        // Показанный порядок не должен совпадать с правильным — иначе ответ «по умолчанию» был бы верным.
        for (let guard = 0; guard < 20 && display.map((o) => o.id).join() === correctOrder.join(); guard += 1) {
          display = shuffleRng.shuffle(display);
        }
        publicParts.push({ id: part.id, format: part.format, prompt: part.prompt, items: display });
        keys.push({ partId: part.id, format: part.format, skillTags: part.skillTags, correctOrder });
        break;
      }
    }
  }

  const skillTags = [...new Set(authored.parts.flatMap((part) => part.skillTags))].sort();
  return {
    familyId: family.id,
    familyVersion: family.version,
    specialization: family.specialization,
    groupCode: family.group,
    grade,
    seed,
    fingerprint: fingerprintOf(family, grade, params),
    skillTags,
    complexity: family.complexity ? family.complexity(params, grade) : authored.parts.length,
    public: { title: authored.title, context: authored.context, parts: publicParts },
    key: { parts: keys, semanticMap },
  };
}

/** Переводит семантический ответ (ключи авторской формы) в непрозрачные id экземпляра. Только для тестов и сидера. */
export function opaqueIdFor(instance: PrivateTaskInstance, partId: string, kind: 'opt' | 'left' | 'right' | 'item', key: string): string {
  const target = `${partId}:${kind}:${key}`;
  const found = Object.entries(instance.key.semanticMap).find(([, semantic]) => semantic === target);
  if (!found) throw new Error(`Нет варианта ${target}`);
  return found[0];
}
