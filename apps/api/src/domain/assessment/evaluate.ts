import type { ItemAnswer, ItemEvaluation, PartAnswer, PartEvaluation, PartKey, PrivateKey, PublicPart, PublicTask } from './types';

const NUMERIC_EPSILON = 1e-9;

/**
 * Проверяет форму ответа по публичной схеме части (до сохранения).
 * Возвращает текст ошибки или null. Не раскрывает правильность ответа.
 */
export function validatePartAnswerShape(part: PublicPart, answer: unknown): string | null {
  if (answer === null || answer === undefined) return null; // пустой ответ допустим
  if (typeof answer !== 'object' || Array.isArray(answer)) return 'ответ должен быть объектом';
  const value = answer as Record<string, unknown>;
  switch (part.format) {
    case 'SINGLE_CHOICE': {
      if (typeof value.optionId !== 'string') return 'ожидается optionId';
      if (!part.options.some((o) => o.id === value.optionId)) return 'неизвестный вариант';
      return Object.keys(value).length === 1 ? null : 'лишние поля';
    }
    case 'MULTI_SELECT': {
      if (!Array.isArray(value.optionIds) || value.optionIds.some((id) => typeof id !== 'string')) return 'ожидается optionIds[]';
      if (new Set(value.optionIds).size !== value.optionIds.length) return 'варианты повторяются';
      if (value.optionIds.some((id) => !part.options.some((o) => o.id === id))) return 'неизвестный вариант';
      return Object.keys(value).length === 1 ? null : 'лишние поля';
    }
    case 'NUMERIC': {
      if (typeof value.value !== 'number' || !Number.isFinite(value.value)) return 'ожидается число';
      if (Math.abs(value.value) > 1e12) return 'слишком большое число';
      return Object.keys(value).length === 1 ? null : 'лишние поля';
    }
    case 'MATCHING': {
      if (!value.pairs || typeof value.pairs !== 'object' || Array.isArray(value.pairs)) return 'ожидается pairs';
      const pairs = value.pairs as Record<string, unknown>;
      for (const [leftId, rightId] of Object.entries(pairs)) {
        if (!part.left.some((o) => o.id === leftId)) return 'неизвестный элемент слева';
        if (typeof rightId !== 'string' || !part.right.some((o) => o.id === rightId)) return 'неизвестный элемент справа';
      }
      return Object.keys(value).length === 1 ? null : 'лишние поля';
    }
    case 'ORDERING': {
      if (!Array.isArray(value.order) || value.order.some((id) => typeof id !== 'string')) return 'ожидается order[]';
      const ids = part.items.map((o) => o.id).sort();
      const order = [...(value.order as string[])].sort();
      if (ids.length !== order.length || ids.some((id, i) => id !== order[i])) return 'порядок должен содержать все элементы по одному разу';
      return Object.keys(value).length === 1 ? null : 'лишние поля';
    }
  }
}

export function validateItemAnswerShape(task: PublicTask, answer: unknown): string | null {
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) return 'ответ должен быть объектом';
  const parts = (answer as { parts?: unknown }).parts;
  if (!parts || typeof parts !== 'object' || Array.isArray(parts)) return 'ожидается поле parts';
  for (const [partId, partAnswer] of Object.entries(parts as Record<string, unknown>)) {
    const part = task.parts.find((p) => p.id === partId);
    if (!part) return `неизвестная часть ${partId}`;
    const error = validatePartAnswerShape(part, partAnswer);
    if (error) return `${partId}: ${error}`;
  }
  return null;
}

/** Атомарная оценка части: 0 или 1. Для MULTI_SELECT — точное множество, для NUMERIC — допуск. */
export function evaluatePart(key: PartKey, answer: PartAnswer | null | undefined): PartEvaluation {
  const base = { partId: key.partId, format: key.format, skillTags: key.skillTags };
  if (!answer) return { ...base, answered: false, correct: false, score: 0 };
  let correct = false;
  switch (key.format) {
    case 'SINGLE_CHOICE':
      correct = 'optionId' in answer && answer.optionId === key.correctOptionId;
      break;
    case 'MULTI_SELECT': {
      if ('optionIds' in answer) {
        const given = [...new Set(answer.optionIds)].sort();
        correct = given.length === key.correctOptionIds.length && given.every((id, i) => id === key.correctOptionIds[i]);
      }
      break;
    }
    case 'NUMERIC':
      if ('value' in answer && typeof answer.value === 'number' && Number.isFinite(answer.value)) {
        correct = Math.abs(answer.value - key.correctValue) <= key.tolerance + NUMERIC_EPSILON;
      }
      break;
    case 'MATCHING': {
      if ('pairs' in answer) {
        const expected = Object.entries(key.correctPairs);
        correct =
          Object.keys(answer.pairs).length === expected.length &&
          expected.every(([leftId, rightId]) => answer.pairs[leftId] === rightId);
      }
      break;
    }
    case 'ORDERING':
      if ('order' in answer) {
        correct = answer.order.length === key.correctOrder.length && answer.order.every((id, i) => id === key.correctOrder[i]);
      }
      break;
  }
  return { ...base, answered: true, correct, score: correct ? 1 : 0 };
}

export function evaluateItem(key: PrivateKey, answer: ItemAnswer | null | undefined): ItemEvaluation {
  const parts = key.parts.map((partKey) => evaluatePart(partKey, answer?.parts?.[partKey.partId] ?? null));
  return { parts, earned: parts.reduce((sum, p) => sum + p.score, 0), total: parts.length };
}

/** Правильный ответ по ключу — только для серверных тестов, сидера и симуляции. Не используется в API. */
export function correctAnswerFromKey(key: PrivateKey): ItemAnswer {
  const parts: ItemAnswer['parts'] = {};
  for (const part of key.parts) {
    switch (part.format) {
      case 'SINGLE_CHOICE':
        parts[part.partId] = { optionId: part.correctOptionId };
        break;
      case 'MULTI_SELECT':
        parts[part.partId] = { optionIds: [...part.correctOptionIds] };
        break;
      case 'NUMERIC':
        parts[part.partId] = { value: part.correctValue };
        break;
      case 'MATCHING':
        parts[part.partId] = { pairs: { ...part.correctPairs } };
        break;
      case 'ORDERING':
        parts[part.partId] = { order: [...part.correctOrder] };
        break;
    }
  }
  return { parts };
}
