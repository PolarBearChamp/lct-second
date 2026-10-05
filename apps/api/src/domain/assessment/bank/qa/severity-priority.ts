import type { GradeCode } from '../../../catalog/catalog';
import type { AuthoredPart, FamilyDefinition, Rng } from '../../types';
import { list, opt, table, text } from '../helpers';

/**
 * Q5. Критичность (severity) и приоритет (priority) дефектов.
 * Критичность определяется техническим влиянием, приоритет — бизнес-срочностью; оба определения и правила
 * релиза приведены в условии, поэтому ответы однозначны.
 * Junior — критичность по влиянию, подсчёт дефектов, блокирующих релиз по критичности.
 * Middle — приоритет по контексту, порядок исправления (приоритет, затем критичность).
 * Senior — правила выпуска релиза: блокирующие дефекты, минимальное число исправлений, независимость осей.
 */

type Sev = 1 | 2 | 3 | 4;
type Pri = 1 | 2 | 3 | 4;

const SEVERITY_LABELS: Record<Sev, string> = {
  1: 'S1 Блокирующая: ключевая функция недоступна для всех или теряются/искажаются данные',
  2: 'S2 Критичная: основная функция не работает, но есть обходной путь',
  3: 'S3 Значительная: часть функции работает неверно, основной сценарий не затронут',
  4: 'S4 Незначительная: косметический дефект, не влияющий на понимание и работу',
};
const PRIORITY_LABELS: Record<Pri, string> = {
  1: 'P1 Срочно: исправить немедленно (хотфикс)',
  2: 'P2 Высокий: исправить до ближайшего релиза',
  3: 'P3 Средний: запланировать на один из следующих релизов',
  4: 'P4 Низкий: можно отложить',
};

const IMPACTS: Record<Sev, string[]> = {
  1: ['Приложение аварийно закрывается при открытии главной страницы у всех пользователей', 'Сумма списывается дважды, а заказ не создаётся', 'Вход в систему невозможен: сервис авторизации не отвечает'],
  2: ['Кнопка «Оплатить картой» не работает, но оплата через СБП доступна', 'Поиск не возвращает результаты, но каталог открывается по категориям', 'Экспорт отчёта в PDF завершается ошибкой, экспорт в CSV работает'],
  3: ['Фильтр по цене игнорирует верхнюю границу', 'В истории заказов неверно показана дата доставки', 'Сортировка по рейтингу работает с ошибками на второй странице списка'],
  4: ['Опечатка в подсказке к полю «Телефон»', 'Иконка корзины смещена на два пикселя', 'У неактивной кнопки неверный оттенок серого'],
};
const CONTEXTS: Record<Pri, string[]> = {
  1: ['Дефект найден за день до запуска рекламной кампании на главной странице', 'Затронут единственный платёжный сценарий в период распродажи', 'Нарушает требование регулятора: на странице неверная юридическая информация'],
  2: ['Затрагивает функцию, которой пользуются 40% клиентов', 'Дефект будет заметен на демонстрации инвестору на следующей неделе'],
  3: ['Затрагивает функцию, которой пользуются менее 5% клиентов', 'Обнаружен на редко используемой странице настроек'],
  4: ['Страницей пользуются только сотрудники поддержки раз в месяц', 'Проявляется только в устаревшем браузере с долей 0,1%'],
};
/**
 * Правило назначения приоритета: каждый бизнес-контекст из CONTEXTS подпадает ровно под один пункт, поэтому ответ однозначен.
 * (В версии 1 правила в условии не было — 40 % клиентов или «менее 5 %» можно было отнести к соседним приоритетам.)
 */
const PRIORITY_RUBRIC = [
  'P1 — блокирует продажи (единственный платёжный сценарий), нарушает требование регулятора или связан с запуском в ближайшие 2 дня;',
  'P2 — затрагивает 20% клиентов и более или связан с событием через 3–14 дней;',
  'P3 — затрагивает менее 20% клиентов или только редко используемый раздел;',
  'P4 — затрагивает только внутренних сотрудников либо менее 1% трафика.',
];
const TITLES = ['Ошибка при сохранении профиля', 'Некорректный расчёт скидки', 'Сбой при загрузке аватара', 'Неверный порядок шагов в мастере заказа', 'Пропадает корзина после выхода', 'Не приходит письмо подтверждения', 'Зависает форма адреса', 'Неверный итог в чеке', 'Не открывается страница тарифов', 'Теряется фильтр после обновления'];

interface Defect {
  id: number;
  text: string;
  sev: Sev;
  pri?: Pri;
}

interface Params {
  variant: 'severity' | 'priority' | 'release';
  defects: Defect[];
}

export const RELEASE_RULES = { blockerSeverity: 1, blockS2UpToPriority: 2, s3Limit: 2 };

export function blocksIndividually(d: { sev: Sev; pri: Pri }): boolean {
  return d.sev === 1 || (d.sev === 2 && d.pri <= RELEASE_RULES.blockS2UpToPriority);
}

export function releasePlan(defects: Array<{ sev: Sev; pri: Pri }>) {
  const blockers = defects.filter(blocksIndividually).length;
  const s3High = defects.filter((d) => d.sev === 3 && d.pri <= 2).length;
  const extra = Math.max(0, s3High - RELEASE_RULES.s3Limit);
  return { blockers, s3High, minimalFixes: blockers + extra, canRelease: blockers + extra === 0 };
}

export const fixOrder = (defects: Array<{ id: number; sev: Sev; pri: Pri }>) => [...defects].sort((a, b) => a.pri - b.pri || a.sev - b.sev || a.id - b.id).map((d) => d.id);

const sevs: Sev[] = [1, 2, 3, 4];

export const severityPriorityFamily: FamilyDefinition<Params> = {
  id: 'qa.severity-priority',
  // v2: в условии варианта Middle добавлено правило назначения приоритета (v1 допускала разное толкование бизнес-контекста);
  // в варианте Senior вопрос о «блокирующих сами по себе» дефектах ссылается на пункты 1 и 2 правил (а не только на первый).
  version: 2,
  specialization: 'MANUAL_QA',
  group: 'QA_DEFECTS',
  title: 'Критичность и приоритет дефектов',
  description: 'Определение severity и priority по заданным правилам, порядок исправления и правила выпуска релиза.',
  supportedGrades: ['JUNIOR', 'MIDDLE', 'SENIOR'],
  skillTags: ['bug-reporting', 'test-prioritization'],
  gradeNotes: {
    JUNIOR: 'Критичность по техническому влиянию; число дефектов, блокирующих релиз по критичности.',
    MIDDLE: 'Приоритет по бизнес-контексту; порядок исправления; различие осей severity и priority.',
    SENIOR: 'Правила выпуска: блокирующие дефекты, минимальное число исправлений, дефекты с несовпадающими осями.',
  },
  sample(rng: Rng, grade: GradeCode): Params {
    if (grade === 'JUNIOR') {
      const severities = rng.sample(sevs, 3);
      const defects = severities.map((sev, i) => ({ id: i + 1, text: rng.pick(IMPACTS[sev]), sev }));
      return { variant: 'severity', defects: rng.shuffle(defects).map((d, i) => ({ ...d, id: i + 1 })) };
    }
    if (grade === 'MIDDLE') {
      for (let guard = 0; guard < 500; guard += 1) {
        const classes = rng.sample([1, 2, 3, 4] as Pri[], 3);
        const priorities = rng.shuffle([...classes, rng.pick(classes)]);
        const severities = priorities.map(() => rng.pick(sevs));
        // Пары с одинаковым приоритетом должны различаться по критичности — иначе порядок неоднозначен.
        const ok = priorities.every((p, i) => priorities.every((q, j) => i === j || p !== q || severities[i] !== severities[j]));
        if (!ok) continue;
        const defects = priorities.map((pri, i) => ({ id: i + 1, text: `${rng.pick(IMPACTS[severities[i]])}. ${rng.pick(CONTEXTS[pri])}.`, sev: severities[i], pri }));
        return { variant: 'priority', defects };
      }
      throw new Error('qa.severity-priority: генерация (Middle) не удалась');
    }
    for (let guard = 0; guard < 2000; guard += 1) {
      const titles = rng.sample(TITLES, 7);
      const defects = titles.map((title, i) => ({ id: 100 + i, text: title, sev: rng.pick(sevs), pri: rng.pick([1, 2, 3, 4] as Pri[]) }));
      const plan = releasePlan(defects as Array<{ sev: Sev; pri: Pri }>);
      const gaps = defects.map((d) => Math.abs(d.sev - (d.pri as number)));
      const best = Math.max(...gaps);
      if (plan.blockers >= 1 && plan.blockers <= 3 && plan.s3High >= 3 && best >= 2 && gaps.filter((g) => g === best).length === 1) return { variant: 'release', defects };
    }
    throw new Error('qa.severity-priority: генерация (Senior) не удалась');
  },
  complexity(params) {
    return params.defects.length * 2;
  },
  build(params) {
    const parts: AuthoredPart[] = [];
    const defects = params.defects;
    const sevDefs = list((Object.keys(SEVERITY_LABELS) as unknown as Sev[]).map((k) => SEVERITY_LABELS[k]));
    const priDefs = list((Object.keys(PRIORITY_LABELS) as unknown as Pri[]).map((k) => PRIORITY_LABELS[k]));
    if (params.variant === 'severity') {
      parts.push({ id: 'p1', format: 'MATCHING', prompt: 'Определите критичность каждого дефекта.', left: defects.map((d) => opt(`d${d.id}`, `Дефект ${d.id}: ${d.text}`)), right: sevs.map((s) => opt(`s${s}`, SEVERITY_LABELS[s])), correct: Object.fromEntries(defects.map((d) => [`d${d.id}`, `s${d.sev}`])), skillTags: ['bug-reporting'] });
      parts.push({ id: 'p2', format: 'NUMERIC', prompt: 'Релиз блокируют дефекты критичности S1 и S2. Сколько из этих дефектов блокируют релиз?', correct: defects.filter((d) => d.sev <= 2).length, tolerance: 0, integer: true, skillTags: ['bug-reporting', 'test-prioritization'] });
      parts.push({ id: 'p3', format: 'SINGLE_CHOICE', prompt: 'Что определяет критичность (severity) дефекта?', options: [opt('impact', 'Техническое влияние дефекта на работу системы'), opt('business', 'Срочность исправления для бизнеса'), opt('author', 'Должность автора дефекта'), opt('age', 'Время, прошедшее с момента обнаружения')], correct: 'impact', skillTags: ['bug-reporting'] });
      return { title: 'Критичность дефектов', context: [text('Шкала критичности, принятая в проекте:'), sevDefs], parts };
    }
    if (params.variant === 'priority') {
      const order = fixOrder(defects as Array<{ id: number; sev: Sev; pri: Pri }>);
      parts.push({ id: 'p1', format: 'MATCHING', prompt: 'Определите приоритет исправления каждого дефекта по описанию бизнес-контекста.', left: defects.map((d) => opt(`d${d.id}`, `Дефект ${d.id}: ${d.text}`)), right: ([1, 2, 3, 4] as Pri[]).map((p) => opt(`p${p}`, PRIORITY_LABELS[p])), correct: Object.fromEntries(defects.map((d) => [`d${d.id}`, `p${d.pri}`])), skillTags: ['test-prioritization', 'bug-reporting'] });
      parts.push({ id: 'p2', format: 'ORDERING', prompt: 'Расположите дефекты в порядке исправления: сначала по приоритету, при равных приоритетах — по критичности (S1 раньше S4).', items: defects.map((d) => opt(`d${d.id}`, `Дефект ${d.id}`)), correct: order.map((id) => `d${id}`), skillTags: ['test-prioritization'] });
      parts.push({ id: 'p3', format: 'SINGLE_CHOICE', prompt: 'Какое утверждение о severity и priority верно?', options: [opt('independent', 'Критичность определяется техническим влиянием, приоритет — бизнес-срочностью; они могут не совпадать'), opt('same', 'Приоритет всегда равен критичности'), opt('sev-only', 'Приоритет определяется только критичностью'), opt('tester', 'Приоритет назначает тестировщик по числу шагов воспроизведения')], correct: 'independent', skillTags: ['bug-reporting', 'test-prioritization'] });
      return {
        title: 'Приоритет и порядок исправления',
        context: [
          text('Шкалы, принятые в проекте. Критичность определяется техническим влиянием (в тексте дефекта — первое предложение), приоритет — бизнес-контекстом (второе предложение).'),
          sevDefs,
          priDefs,
          text('Правило назначения приоритета по бизнес-контексту (применяйте его, а не собственное мнение о важности):'),
          list(PRIORITY_RUBRIC),
        ],
        parts,
      };
    }
    const typed = defects as Array<{ id: number; text: string; sev: Sev; pri: Pri }>;
    const plan = releasePlan(typed);
    const gaps = typed.map((d) => Math.abs(d.sev - d.pri));
    parts.push({ id: 'p1', format: 'NUMERIC', prompt: 'Сколько дефектов блокируют релиз сами по себе (по пунктам 1 и 2 правил)?', correct: plan.blockers, tolerance: 0, integer: true, skillTags: ['test-prioritization', 'bug-reporting'] });
    parts.push({ id: 'p2', format: 'NUMERIC', prompt: 'Какое минимальное число дефектов нужно исправить, чтобы релиз стал возможен?', correct: plan.minimalFixes, tolerance: 0, integer: true, skillTags: ['test-prioritization'] });
    parts.push({ id: 'p3', format: 'SINGLE_CHOICE', prompt: 'У какого дефекта критичность и приоритет расходятся сильнее всего (наибольшая разница номеров уровней)?', options: typed.map((d) => opt(`d${d.id}`, `BUG-${d.id}: ${d.text}`)), correct: `d${typed[gaps.indexOf(Math.max(...gaps))].id}`, skillTags: ['bug-reporting', 'test-prioritization'] });
    return {
      title: 'Решение о выпуске релиза',
      context: [
        text('Правила выпуска релиза:'),
        list(['релиз блокирует любой дефект S1;', 'релиз блокирует дефект S2 с приоритетом P1 или P2;', `релиз блокируется, если дефектов S3 с приоритетом P1 или P2 больше ${RELEASE_RULES.s3Limit} (достаточно исправить лишние).`]),
        table(['Дефект', 'Критичность', 'Приоритет'], typed.map((d) => [`BUG-${d.id}: ${d.text}`, `S${d.sev}`, `P${d.pri}`])),
      ],
      parts,
    };
  },
};
