import { correctAnswerFromKey } from '../../src/domain/assessment/evaluate';
import type { ItemAnswer, PartAnswer, PartKey, PrivateTaskInstance, PublicPart, Rng } from '../../src/domain/assessment/types';

/** Заведомо неверный ответ на часть задания (проверка выполняется штатным evaluator-ом при подсчёте). */
export function wrongPartAnswer(pub: PublicPart, key: PartKey, rng: Rng): PartAnswer {
  switch (key.format) {
    case 'SINGLE_CHOICE': {
      const options = (pub as Extract<PublicPart, { format: 'SINGLE_CHOICE' }>).options.map((o) => o.id).filter((id) => id !== key.correctOptionId);
      return { optionId: rng.pick(options) };
    }
    case 'MULTI_SELECT': {
      const all = (pub as Extract<PublicPart, { format: 'MULTI_SELECT' }>).options.map((o) => o.id);
      const correct = new Set(key.correctOptionIds);
      const wrong = all.filter((id) => !correct.has(id));
      if (correct.size > 1 && (wrong.length === 0 || rng.bool(0.5))) {
        const drop = rng.pick([...correct]);
        return { optionIds: [...correct].filter((id) => id !== drop) };
      }
      return { optionIds: [...correct, rng.pick(wrong)] };
    }
    case 'NUMERIC': {
      const step = Math.max(1, Math.ceil(key.tolerance * 10));
      const delta = rng.pick([1, 2, 3, 5]) * step * (rng.bool() ? 1 : -1);
      return { value: Math.round((key.correctValue + delta) * 100) / 100 };
    }
    case 'MATCHING': {
      const left = Object.keys(key.correctPairs);
      const target = rng.pick(left);
      const rights = (pub as Extract<PublicPart, { format: 'MATCHING' }>).right.map((o) => o.id).filter((id) => id !== key.correctPairs[target]);
      return { pairs: { ...key.correctPairs, [target]: rng.pick(rights) } };
    }
    case 'ORDERING': {
      const order = [...key.correctOrder];
      const i = rng.int(0, order.length - 2);
      const j = rng.int(i + 1, order.length - 1);
      [order[i], order[j]] = [order[j], order[i]];
      return { order };
    }
  }
}

/** Синтетический «решатель» с заданной вероятностью верного ответа на часть задания. */
export function solveInstance(instance: PrivateTaskInstance, accuracy: number, rng: Rng): ItemAnswer {
  const correct = correctAnswerFromKey(instance.key);
  const parts: ItemAnswer['parts'] = {};
  instance.key.parts.forEach((key, index) => {
    parts[key.partId] = rng.next() < accuracy ? correct.parts[key.partId] : wrongPartAnswer(instance.public.parts[index], key, rng);
  });
  return { parts };
}
