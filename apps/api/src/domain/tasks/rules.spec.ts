import {
  addDays,
  canOfferNow,
  dueAtFor,
  isTaskEligible,
  nextOfferAfter,
  normalizeAnswerText,
  pickTaskToOffer,
  TASK_DUE_DAYS,
  TASK_OFFER_INTERVAL_DAYS,
  validateTaskContent,
} from './rules';

const NOW = new Date('2026-10-07T10:00:00Z');

describe('validateTaskContent', () => {
  it('корректный тест и корректный разбор — без замечаний', () => {
    expect(validateTaskContent({ kind: 'QUIZ', options: ['a', 'b'], correctIndex: 1 })).toEqual({});
    expect(validateTaskContent({ kind: 'APPROACH', options: [], correctIndex: null })).toEqual({});
  });

  it('тест: число вариантов 2–6, без пустых и повторов, верный индекс внутри диапазона', () => {
    expect(validateTaskContent({ kind: 'QUIZ', options: ['a'], correctIndex: 0 })).toHaveProperty('options');
    expect(validateTaskContent({ kind: 'QUIZ', options: ['1', '2', '3', '4', '5', '6', '7'], correctIndex: 0 })).toHaveProperty('options');
    expect(validateTaskContent({ kind: 'QUIZ', options: ['a', ' '], correctIndex: 0 })).toHaveProperty('options');
    expect(validateTaskContent({ kind: 'QUIZ', options: ['Да', 'да'], correctIndex: 0 })).toHaveProperty('options');
    expect(validateTaskContent({ kind: 'QUIZ', options: ['a', 'b'], correctIndex: 2 })).toHaveProperty('correctIndex');
    expect(validateTaskContent({ kind: 'QUIZ', options: ['a', 'b'], correctIndex: -1 })).toHaveProperty('correctIndex');
    expect(validateTaskContent({ kind: 'QUIZ', options: ['a', 'b'], correctIndex: undefined })).toHaveProperty('correctIndex');
  });

  it('разбор: варианты и верный индекс не допускаются', () => {
    expect(validateTaskContent({ kind: 'APPROACH', options: ['a', 'b'], correctIndex: null })).toHaveProperty('options');
    expect(validateTaskContent({ kind: 'APPROACH', options: [], correctIndex: 0 })).toHaveProperty('correctIndex');
  });
});

describe('isTaskEligible', () => {
  const qualifications = [{ specializationCode: 'BACKEND', confirmedGrade: 'MIDDLE' }];

  it('учитывает подтверждённую специализацию и допустимые грейды', () => {
    expect(isTaskEligible({ specializationCode: 'BACKEND', allowedGrades: [] }, qualifications)).toBe(true);
    expect(isTaskEligible({ specializationCode: 'BACKEND', allowedGrades: ['MIDDLE', 'SENIOR'] }, qualifications)).toBe(true);
    expect(isTaskEligible({ specializationCode: 'BACKEND', allowedGrades: ['SENIOR'] }, qualifications)).toBe(false);
    expect(isTaskEligible({ specializationCode: 'FRONTEND', allowedGrades: [] }, qualifications)).toBe(false);
    expect(isTaskEligible({ specializationCode: 'BACKEND', allowedGrades: [] }, [])).toBe(false);
  });
});

describe('срок и периодичность', () => {
  it('срок ответа — неделя, но не позже срока задания', () => {
    expect(dueAtFor(NOW, null)).toEqual(addDays(NOW, TASK_DUE_DAYS));
    expect(dueAtFor(NOW, addDays(NOW, 2))).toEqual(addDays(NOW, 2));
    expect(dueAtFor(NOW, addDays(NOW, 30))).toEqual(addDays(NOW, TASK_DUE_DAYS));
  });

  it('новое задание — не чаще раза в интервал', () => {
    expect(canOfferNow(null, NOW)).toBe(true);
    expect(nextOfferAfter(null)).toBeNull();
    const last = addDays(NOW, -(TASK_OFFER_INTERVAL_DAYS - 1));
    expect(canOfferNow(last, NOW)).toBe(false);
    expect(canOfferNow(addDays(NOW, -TASK_OFFER_INTERVAL_DAYS), NOW)).toBe(true);
    expect(nextOfferAfter(last)).toEqual(addDays(last, TASK_OFFER_INTERVAL_DAYS));
  });
});

describe('pickTaskToOffer', () => {
  const task = (id: string, offeredCount: number, publishedDaysAgo: number, deadlineAt: Date | null = null) => ({
    id,
    offeredCount,
    publishedAt: addDays(NOW, -publishedDaysAgo),
    deadlineAt,
  });

  it('предпочитает реже предлагавшиеся, затем более раннюю публикацию', () => {
    expect(pickTaskToOffer([task('a', 3, 10), task('b', 1, 1), task('c', 1, 5)], NOW)?.id).toBe('c');
  });

  it('пропускает задания с истёкшим сроком; пусто — null', () => {
    expect(pickTaskToOffer([task('a', 0, 10, addDays(NOW, -1))], NOW)).toBeNull();
    expect(pickTaskToOffer([], NOW)).toBeNull();
    expect(pickTaskToOffer([task('a', 0, 10, addDays(NOW, -1)), task('b', 5, 1)], NOW)?.id).toBe('b');
  });

  it('при равенстве результат детерминирован по идентификатору', () => {
    expect(pickTaskToOffer([task('b', 0, 1), task('a', 0, 1)], NOW)?.id).toBe('a');
  });
});

describe('normalizeAnswerText', () => {
  it('нормализует переводы строк и пробелы по краям', () => {
    expect(normalizeAnswerText('  строка 1\r\nстрока 2  ')).toBe('строка 1\nстрока 2');
  });
});
