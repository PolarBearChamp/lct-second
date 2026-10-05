import { correctAnswerFromKey } from '../../src/domain/assessment/evaluate';
import type { ItemAnswer, PrivateKey, PublicTask } from '../../src/domain/assessment/types';

/** Правильный ответ по закрытому ключу; для «wrong» — заведомо неверные числа и пустые остальные части. */
export function answerShape(key: PrivateKey, task: PublicTask, mode: 'correct' | 'wrong'): ItemAnswer {
  const correct = correctAnswerFromKey(key);
  if (mode === 'correct') return correct;
  const parts: ItemAnswer['parts'] = {};
  for (const part of key.parts) {
    if (part.format === 'NUMERIC') parts[part.partId] = { value: part.correctValue + 1000 };
    if (part.format === 'SINGLE_CHOICE') {
      const wrong = (task.parts.find((p) => p.id === part.partId) as { options: Array<{ id: string }> }).options.find((o) => o.id !== part.correctOptionId);
      parts[part.partId] = { optionId: wrong!.id };
    }
  }
  return { parts };
}
