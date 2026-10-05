import { INDUSTRIES, type GradeCode, type SpecializationCode } from './catalog';

/**
 * Онбординговый опрос (onboarding-survey-v1): отрасль интереса, направление и самооценка уровня.
 * Опрос даёт только рекомендацию специализации и заявленного грейда — окончательный выбор делает кандидат,
 * а подтверждённый грейд появляется исключительно по результатам тестирования.
 */

export const SURVEY_VERSION = 'onboarding-survey-v1';

export interface SurveyOption {
  code: string;
  title: string;
}

export interface SurveyQuestion {
  code: string;
  title: string;
  hint?: string;
  kind: 'single' | 'multi';
  options: SurveyOption[];
  required: boolean;
}

export const SURVEY_QUESTIONS: SurveyQuestion[] = [
  {
    code: 'industries',
    title: 'В каких отраслях вам интересно работать?',
    hint: 'Можно выбрать несколько вариантов.',
    kind: 'multi',
    options: INDUSTRIES,
    required: true,
  },
  {
    code: 'focus',
    title: 'Что вам ближе всего в работе?',
    kind: 'single',
    required: true,
    options: [
      { code: 'UI', title: 'Интерфейсы: поведение страниц, состояние, взаимодействие с пользователем' },
      { code: 'SERVER', title: 'Серверная логика: API, базы данных, надёжность' },
      { code: 'DATA', title: 'Данные и модели: подготовка данных, эксперименты, метрики' },
      { code: 'QUALITY', title: 'Качество продукта: требования, проверки, поиск дефектов' },
    ],
  },
  {
    code: 'recentTasks',
    title: 'Какие задачи вы решали за последний год?',
    hint: 'Выберите всё, что подходит.',
    kind: 'multi',
    required: true,
    options: [
      { code: 'SPA', title: 'Разрабатывал(а) клиентское веб-приложение' },
      { code: 'API', title: 'Проектировал(а) или реализовывал(а) HTTP API' },
      { code: 'DB', title: 'Писал(а) SQL-запросы, проектировал(а) схемы БД' },
      { code: 'ML_MODEL', title: 'Обучал(а) и оценивал(а) ML-модели' },
      { code: 'DATA_PREP', title: 'Готовил(а) данные для анализа или обучения' },
      { code: 'TEST_CASES', title: 'Составлял(а) тест-кейсы и чек-листы' },
      { code: 'BUG_REPORTS', title: 'Заводил(а) баг-репорты и проверял(а) исправления' },
      { code: 'COMPETITIONS', title: 'Участвовал(а) в соревнованиях по программированию' },
    ],
  },
  {
    code: 'experience',
    title: 'Какой у вас опыт работы по специальности?',
    hint: 'Учитывайте коммерческие проекты, стажировки и командные соревнования.',
    kind: 'single',
    required: true,
    options: [
      { code: 'NONE', title: 'Пока нет коммерческого опыта' },
      { code: 'LT1', title: 'До 1 года' },
      { code: 'Y1_3', title: 'От 1 до 3 лет' },
      { code: 'Y3_PLUS', title: 'Более 3 лет' },
    ],
  },
  {
    code: 'autonomy',
    title: 'Как вы обычно решаете рабочие задачи?',
    kind: 'single',
    required: true,
    options: [
      { code: 'GUIDED', title: 'Справляюсь с типовыми задачами с подсказками коллег' },
      { code: 'INDEPENDENT', title: 'Самостоятельно решаю задачи средней сложности' },
      { code: 'LEADING', title: 'Проектирую решения, разбираю сложные случаи, помогаю другим' },
    ],
  },
  {
    code: 'fspParticipation',
    title: 'Участвовали ли вы в соревнованиях Федерации спортивного программирования?',
    hint: 'Достижения можно будет привязать в настройках — это дополнительное преимущество, а не обязательное условие.',
    kind: 'single',
    required: false,
    options: [
      { code: 'YES', title: 'Да' },
      { code: 'NO', title: 'Нет' },
    ],
  },
];

export type SurveyAnswers = Record<string, string | string[]>;

export interface SurveyRecommendation {
  specialization: SpecializationCode;
  grade: GradeCode;
  reasons: string[];
}

const FOCUS_TO_SPEC: Record<string, SpecializationCode> = {
  UI: 'FRONTEND',
  SERVER: 'BACKEND',
  DATA: 'ML_ENGINEER',
  QUALITY: 'MANUAL_QA',
};

const TASK_TO_SPEC: Record<string, SpecializationCode | undefined> = {
  SPA: 'FRONTEND',
  API: 'BACKEND',
  DB: 'BACKEND',
  ML_MODEL: 'ML_ENGINEER',
  DATA_PREP: 'ML_ENGINEER',
  TEST_CASES: 'MANUAL_QA',
  BUG_REPORTS: 'MANUAL_QA',
};

/** Проверяет ответы на соответствие опросу. Возвращает список ошибок (пустой — ответы корректны). */
export function validateSurveyAnswers(answers: SurveyAnswers): string[] {
  const errors: string[] = [];
  for (const question of SURVEY_QUESTIONS) {
    const value = answers[question.code];
    const allowed = new Set(question.options.map((option) => option.code));
    if (value === undefined || (Array.isArray(value) && value.length === 0) || value === '') {
      if (question.required) errors.push(`${question.code}: ответ обязателен`);
      continue;
    }
    if (question.kind === 'single') {
      if (typeof value !== 'string' || !allowed.has(value)) errors.push(`${question.code}: недопустимый вариант`);
    } else if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !allowed.has(item))) {
      errors.push(`${question.code}: недопустимые варианты`);
    } else if (new Set(value).size !== value.length) {
      errors.push(`${question.code}: варианты повторяются`);
    }
  }
  const unknown = Object.keys(answers).filter((key) => !SURVEY_QUESTIONS.some((question) => question.code === key));
  if (unknown.length) errors.push(`неизвестные вопросы: ${unknown.join(', ')}`);
  return errors;
}

/** Рекомендация по правилам (без ML): направление — по фокусу и задачам, уровень — по опыту и самостоятельности. */
export function recommendFromSurvey(answers: SurveyAnswers): SurveyRecommendation {
  const reasons: string[] = [];
  const scores = new Map<SpecializationCode, number>();
  const focus = typeof answers.focus === 'string' ? FOCUS_TO_SPEC[answers.focus] : undefined;
  if (focus) {
    scores.set(focus, (scores.get(focus) ?? 0) + 3);
    reasons.push('учтено, что вам ближе в работе');
  }
  const tasks = Array.isArray(answers.recentTasks) ? answers.recentTasks : [];
  for (const task of tasks) {
    const spec = TASK_TO_SPEC[task];
    if (spec) scores.set(spec, (scores.get(spec) ?? 0) + 1);
  }
  if (tasks.length) reasons.push('учтены задачи за последний год');
  const order: SpecializationCode[] = ['FRONTEND', 'BACKEND', 'ML_ENGINEER', 'MANUAL_QA'];
  const specialization =
    [...scores.entries()].sort((a, b) => b[1] - a[1] || order.indexOf(a[0]) - order.indexOf(b[0]))[0]?.[0] ?? 'BACKEND';

  const experience = answers.experience;
  const autonomy = answers.autonomy;
  let level = experience === 'Y3_PLUS' ? 3 : experience === 'Y1_3' ? 2 : 1;
  if (autonomy === 'GUIDED') level = Math.min(level, 1);
  if (autonomy === 'INDEPENDENT') level = Math.min(Math.max(level, 2), 2);
  if (autonomy === 'LEADING' && level >= 2) level = 3;
  const grade: GradeCode = level >= 3 ? 'SENIOR' : level === 2 ? 'MIDDLE' : 'JUNIOR';
  reasons.push('уровень предложен по опыту и самостоятельности — это только ваша оценка до тестирования');
  return { specialization, grade, reasons };
}
