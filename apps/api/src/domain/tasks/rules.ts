/**
 * Правила коротких заданий работодателей — чистые функции без обращения к БД.
 *
 * Задание — не экзамен: оно не меняет подтверждённый грейд кандидата и не входит в формулу подбора. Это сигнал
 * регулярности и практики, который виден автору задания и самому кандидату.
 */

export const TASK_OFFER_INTERVAL_DAYS = 7;
export const TASK_DUE_DAYS = 7;
export const PRACTICE_WINDOW_DAYS = 90;
/** Не более такого числа одновременно активных заданий на компанию — защита от заваливания кандидатов. */
export const MAX_ACTIVE_TASKS_PER_COMPANY = 10;
export const APPROACH_MIN_LENGTH = 20;
export const APPROACH_MAX_LENGTH = 2000;

const DAY_MS = 24 * 60 * 60 * 1000;
export const addDays = (date: Date, days: number): Date => new Date(date.getTime() + days * DAY_MS);

export type TaskKind = 'QUIZ' | 'APPROACH';

export interface TaskContent {
  kind: TaskKind;
  options: readonly string[];
  correctIndex: number | null | undefined;
}

/** Ошибки содержимого задания: поле → причина (пусто — всё корректно). */
export function validateTaskContent(content: TaskContent): Record<string, string> {
  const issues: Record<string, string> = {};
  const options = content.options.map((option) => option.trim());
  if (content.kind === 'QUIZ') {
    if (options.length < 2 || options.length > 6) issues.options = 'Нужно от 2 до 6 вариантов ответа';
    else if (options.some((option) => option === '')) issues.options = 'Варианты ответа не должны быть пустыми';
    else if (new Set(options.map((option) => option.toLowerCase())).size !== options.length) issues.options = 'Варианты ответа не должны повторяться';
    if (content.correctIndex === null || content.correctIndex === undefined) issues.correctIndex = 'Укажите верный вариант';
    else if (content.correctIndex < 0 || content.correctIndex >= options.length) issues.correctIndex = 'Верный вариант должен быть одним из перечисленных';
  } else {
    if (options.length > 0) issues.options = 'Варианты ответа задаются только в тесте с одним верным ответом';
    if (content.correctIndex !== null && content.correctIndex !== undefined) issues.correctIndex = 'Верный вариант задаётся только в тесте с одним верным ответом';
  }
  return issues;
}

export interface TaskTarget {
  specializationCode: string;
  allowedGrades: readonly string[];
}

export interface ConfirmedQualification {
  specializationCode: string;
  confirmedGrade: string;
}

/** Подходит ли задание кандидату: по подтверждённой тестом квалификации, а не по заявленному грейду. */
export function isTaskEligible(task: TaskTarget, qualifications: readonly ConfirmedQualification[]): boolean {
  return qualifications.some(
    (q) => q.specializationCode === task.specializationCode && (task.allowedGrades.length === 0 || task.allowedGrades.includes(q.confirmedGrade)),
  );
}

/** Срок ответа: неделя с момента предложения, но не позже срока самого задания. */
export function dueAtFor(offeredAt: Date, deadlineAt: Date | null): Date {
  const standard = addDays(offeredAt, TASK_DUE_DAYS);
  return deadlineAt && deadlineAt < standard ? deadlineAt : standard;
}

/** Когда кандидату можно предложить следующее задание (null — ограничений нет). */
export function nextOfferAfter(lastOfferedAt: Date | null): Date | null {
  return lastOfferedAt ? addDays(lastOfferedAt, TASK_OFFER_INTERVAL_DAYS) : null;
}

export function canOfferNow(lastOfferedAt: Date | null, now: Date): boolean {
  const next = nextOfferAfter(lastOfferedAt);
  return !next || next <= now;
}

export interface OfferCandidateTask {
  id: string;
  publishedAt: Date | null;
  offeredCount: number;
  deadlineAt: Date | null;
}

/**
 * Выбор задания для предложения: сначала те, что реже предлагались (нагрузка распределяется между заданиями),
 * затем более раннее по публикации; результат детерминирован.
 */
export function pickTaskToOffer<T extends OfferCandidateTask>(tasks: readonly T[], now: Date): T | null {
  const open = tasks.filter((task) => !task.deadlineAt || task.deadlineAt > now);
  const sorted = [...open].sort(
    (a, b) =>
      a.offeredCount - b.offeredCount ||
      (a.publishedAt?.getTime() ?? 0) - (b.publishedAt?.getTime() ?? 0) ||
      a.id.localeCompare(b.id),
  );
  return sorted[0] ?? null;
}

export function normalizeAnswerText(text: string): string {
  return text.replace(/\r\n/g, '\n').trim();
}
