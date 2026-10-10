/**
 * Сигналы честности прохождения теста (ответ организаторов FTT.4: проверка на списывание не обязательна, но будет большим
 * плюсом). Сигнал — информация о том, как проходилась попытка, а не доказательство нарушения: грейд он не меняет и
 * автоматических санкций нет. Кандидат заранее предупреждён и видит те же сигналы, что и работодатель.
 *
 * Чистые функции без обращения к БД: пороги берутся из INTEGRITY_POLICY (версионируются отдельно от политики оценки,
 * потому что на баллы не влияют).
 */
import { INTEGRITY_POLICY, type IntegrityPolicy } from '../../config/policies';

export type IntegrityLevel = 'NONE' | 'NOTE' | 'ATTENTION';
export type IntegritySignalCode = 'FAST_COMPLETION' | 'FAST_ITEMS' | 'TAB_HIDDEN' | 'PASTE' | 'COPY';

/** Счётчики, собранные интерфейсом теста (агрегаты, без содержимого). */
export interface IntegrityCounters {
  /** Сколько раз вкладка стала скрытой. */
  tabHiddenCount: number;
  /** Суммарное время, когда вкладка была скрыта, мс. */
  tabHiddenMs: number;
  /** Вставки текста из буфера в поля ответа. */
  pasteCount: number;
  /** Копирование текста задания. */
  copyCount: number;
  /** Потери фокуса окна (информационно, в сигналы не входит). */
  focusLossCount: number;
}

export const EMPTY_COUNTERS: IntegrityCounters = { tabHiddenCount: 0, tabHiddenMs: 0, pasteCount: 0, copyCount: 0, focusLossCount: 0 };

export interface IntegritySignal {
  code: IntegritySignalCode;
  severity: 'NOTE' | 'ATTENTION';
  /** Нейтральная формулировка для кандидата и работодателя. */
  text: string;
  /** Числовое значение сигнала (число раз, секунд и т. п.). */
  value: number;
}

/** Результат оценки: хранится в попытке и показывается в результате, карточке и PDF. */
export interface IntegrityEvaluation {
  version: string;
  level: IntegrityLevel;
  signals: IntegritySignal[];
  counters: IntegrityCounters;
}

export interface IntegrityInput {
  /** SUBMIT — кандидат завершил тест сам; EXPIRE — время вышло. Прерванные попытки не оцениваются. */
  kind: 'SUBMIT' | 'EXPIRE';
  startedAtMs: number;
  /** Сколько времени отведено на тест, мс. */
  durationMs: number;
  /** Сколько прошло от старта до завершения, мс. */
  elapsedMs: number;
  overall: number;
  passOverall: number;
  /** По одному элементу на кейс: время первого сохранения ответа (null — ответа нет) и балл кейса 0..1. */
  items: Array<{ firstSavedAtMs: number | null; score: number }>;
  counters: IntegrityCounters;
}

const minutes = (ms: number) => Math.max(1, Math.round(ms / 60_000));

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word = mod10 === 1 && mod100 !== 11 ? one : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? few : many;
  return `${n} ${word}`;
}
const times = (n: number) => plural(n, 'раз', 'раза', 'раз');

/** Кейсы, полностью верно решённые быстрее порога относительно предыдущего сохранения (или старта). */
export function fastCorrectItems(input: Pick<IntegrityInput, 'startedAtMs' | 'items'>, fastItemSeconds: number): number {
  const saved = input.items
    .filter((item): item is { firstSavedAtMs: number; score: number } => item.firstSavedAtMs !== null)
    .sort((a, b) => a.firstSavedAtMs - b.firstSavedAtMs);
  let previous = input.startedAtMs;
  let fast = 0;
  for (const item of saved) {
    if (item.firstSavedAtMs - previous < fastItemSeconds * 1000 && item.score >= 1 - 1e-9) fast += 1;
    previous = item.firstSavedAtMs;
  }
  return fast;
}

export function evaluateIntegrity(input: IntegrityInput, policy: IntegrityPolicy = INTEGRITY_POLICY): IntegrityEvaluation {
  const signals: IntegritySignal[] = [];
  const { counters } = input;

  if (input.kind === 'SUBMIT' && input.overall >= input.passOverall && input.elapsedMs < policy.fastCompletionShare * input.durationMs) {
    signals.push({
      code: 'FAST_COMPLETION',
      severity: 'NOTE',
      text: `Тест завершён за ${minutes(input.elapsedMs)} мин из ${minutes(input.durationMs)} отведённых при высоком результате`,
      value: Math.round(input.elapsedMs / 1000),
    });
  }

  const fast = fastCorrectItems(input, policy.fastItemSeconds);
  if (fast >= policy.fastItemsMin) {
    signals.push({
      code: 'FAST_ITEMS',
      severity: 'ATTENTION',
      text: `${plural(fast, 'кейс решён', 'кейса решены', 'кейсов решены')} полностью верно быстрее чем за ${policy.fastItemSeconds} с каждый`,
      value: fast,
    });
  }

  if (counters.tabHiddenCount >= policy.tabHiddenNote) {
    const attention = counters.tabHiddenCount >= policy.tabHiddenAttention || counters.tabHiddenMs >= policy.tabHiddenAttentionMs;
    signals.push({
      code: 'TAB_HIDDEN',
      severity: attention ? 'ATTENTION' : 'NOTE',
      text: `Вкладка теста скрывалась ${times(counters.tabHiddenCount)}, суммарно около ${minutes(counters.tabHiddenMs)} мин`,
      value: counters.tabHiddenCount,
    });
  }

  if (counters.pasteCount >= policy.pasteNote) {
    signals.push({
      code: 'PASTE',
      severity: counters.pasteCount >= policy.pasteAttention ? 'ATTENTION' : 'NOTE',
      text: `Вставка текста из буфера обмена в поля ответа: ${times(counters.pasteCount)}`,
      value: counters.pasteCount,
    });
  }

  if (counters.copyCount >= policy.copyNote) {
    signals.push({
      code: 'COPY',
      severity: 'NOTE',
      text: `Копирование текста задания: ${times(counters.copyCount)}`,
      value: counters.copyCount,
    });
  }

  const level: IntegrityLevel = signals.some((s) => s.severity === 'ATTENTION') ? 'ATTENTION' : signals.length ? 'NOTE' : 'NONE';
  return { version: policy.version, level, signals, counters };
}
