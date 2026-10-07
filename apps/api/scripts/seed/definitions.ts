import type { GradeCode, SpecializationCode } from '../../src/domain/catalog/catalog';
import { SEED_PARTICIPANTS_PER_SPEC, SEED_SPECS, seedParticipantCode, seedParticipantId } from './fsp-data';
import { personName } from './people';

/** Описания демонстрационных данных. Роли «героев» сценария указаны в note и попадают в README. */

export type AttemptOutcome = 'PASS' | 'FAIL' | 'EXPIRED' | 'ABANDONED';

export interface AttemptPlan {
  grade: GradeCode;
  outcome: AttemptOutcome;
  /** Сколько дней назад завершена (для EXPIRED/ABANDONED — начата). */
  daysAgo: number;
  hoursAgo?: number;
  accuracy?: [number, number, number];
  confident?: boolean;
}

export type FspPlan = { kind: 'LINK'; id: string; code: string } | { kind: 'SYNC_ERROR'; id: string };

export interface CandidateDef {
  key: string;
  email: string;
  fullName: string;
  female: boolean;
  emailVerified: boolean;
  /** Заполнены ли обязательные поля профиля, опрос и стек. */
  profile: 'FULL' | 'PARTIAL' | 'EMPTY';
  specialization: SpecializationCode | null;
  declaredGrade: GradeCode | null;
  survey: boolean;
  publication: 'PUBLISHED' | 'HIDDEN' | 'NO_CONSENT';
  availability: 'ACTIVE' | 'PAUSED';
  attempts: AttemptPlan[];
  fsp?: FspPlan;
  showSalary: boolean;
  showFsp: boolean;
  role: 'MAIN' | 'EXTRA';
  note: string;
}

const SPEC_SHORT: Record<SpecializationCode, string> = { FRONTEND: 'fe', BACKEND: 'be', ML_ENGINEER: 'ml', MANUAL_QA: 'qa' };
const GRADE_SHORT: Record<GradeCode, string> = { JUNIOR: 'junior', MIDDLE: 'middle', SENIOR: 'senior' };
const GRADES: GradeCode[] = ['JUNIOR', 'MIDDLE', 'SENIOR'];
const HIGHER: Record<GradeCode, GradeCode> = { JUNIOR: 'MIDDLE', MIDDLE: 'SENIOR', SENIOR: 'SENIOR' };

export const emailFor = (spec: SpecializationCode, grade: GradeCode, n: number) => `${SPEC_SHORT[spec]}.${GRADE_SHORT[grade]}.${String(n).padStart(2, '0')}@demo.example`;

/**
 * 96 основных кандидатов: 8 на каждую комбинацию специализация × грейд, все с подтверждением по результатам синтетических попыток.
 * perCell > 8 (SEED_PER_CELL) создаёт больше кандидатов на ячейку — только для нагрузочного прогона; имена при этом могут повторяться.
 */
export function mainCandidates(used: Set<string>, perCell = 8): CandidateDef[] {
  const result: CandidateDef[] = [];
  let counter = 0;
  const heroSkip = new Set<string>();
  SEED_SPECS.forEach((spec, specIndex) => {
    let participantIndex = 0;
    GRADES.forEach((grade) => {
      for (let n = 1; n <= perCell; n += 1) {
        counter += 1;
        const name = personName(counter + 3, used, perCell > 8);
        const priorFailure = n === 3;
        const longAgo = n === 8;
        const attempts: AttemptPlan[] = [];
        const passDaysAgo = longAgo ? 96 + counter % 40 : 6 + ((counter * 7) % 70);
        if (priorFailure) attempts.push({ grade: HIGHER[grade], outcome: 'FAIL', daysAgo: passDaysAgo + 3 + (counter % 5) });
        attempts.push({ grade, outcome: 'PASS', daysAgo: passDaysAgo, confident: n === 1 || n === 5 ? true : undefined });
        let fsp: FspPlan | undefined;
        if (n <= 3 && participantIndex < SEED_PARTICIPANTS_PER_SPEC - 1) {
          const number = specIndex + 1 + SEED_SPECS.length * participantIndex;
          participantIndex += 1;
          fsp = { kind: 'LINK', id: seedParticipantId(number), code: seedParticipantCode(number) };
        } else if (grade === 'MIDDLE' && n === 4) {
          // Привязан, но без истории — последние четыре участника в фикстуре.
          const number = SEED_PARTICIPANTS_PER_SPEC * SEED_SPECS.length - SEED_SPECS.length + specIndex + 1;
          fsp = { kind: 'LINK', id: seedParticipantId(number), code: seedParticipantCode(number) };
        }
        const key = `${SPEC_SHORT[spec]}-${GRADE_SHORT[grade]}-${n}`;
        heroSkip.add(key);
        result.push({
          key,
          email: emailFor(spec, grade, n),
          fullName: name.full,
          female: name.female,
          emailVerified: true,
          profile: 'FULL',
          specialization: spec,
          declaredGrade: priorFailure ? HIGHER[grade] : grade,
          survey: true,
          publication: 'PUBLISHED',
          availability: 'ACTIVE',
          attempts,
          fsp,
          showSalary: counter % 9 !== 0,
          showFsp: counter % 11 !== 0,
          role: 'MAIN',
          note: `${spec} ${grade}${priorFailure ? ', была неудачная попытка на более высокий уровень' : ''}${longAgo ? ', срок переоценки уже наступил' : ''}`,
        });
      }
    });
  });
  return result;
}

const heroName = (full: string, female: boolean, used: Set<string>) => {
  used.add(full);
  return { fullName: full, female };
};

/** Кандидаты с особыми состояниями для демонстрации и проверки граничных случаев. */
export function extraCandidates(used: Set<string>): CandidateDef[] {
  const make = (def: Omit<CandidateDef, 'role' | 'survey' | 'showSalary' | 'showFsp' | 'availability' | 'profile' | 'emailVerified'> & Partial<CandidateDef>): CandidateDef => ({
    emailVerified: true,
    profile: 'FULL',
    survey: true,
    availability: 'ACTIVE',
    showSalary: true,
    showFsp: true,
    role: 'EXTRA',
    ...def,
  });
  return [
    make({ key: 'hero-anna', email: 'anna.demidova@demo.example', ...heroName('Анна Демидова', true, used), specialization: 'BACKEND', declaredGrade: 'MIDDLE', publication: 'PUBLISHED', attempts: [{ grade: 'MIDDLE', outcome: 'PASS', daysAgo: 12, accuracy: [0.95, 0.9, 0.85] }], fsp: { kind: 'LINK', id: 'FSP-DEMO-1001', code: '731905' }, note: 'Backend Middle, привязан ФСП (2 достижения); получает приглашение от «Демо Финтех» — основной сценарий кандидата' }),
    make({ key: 'hero-igor', email: 'igor.sokolov@demo.example', ...heroName('Игорь Соколов', false, used), specialization: 'FRONTEND', declaredGrade: 'MIDDLE', publication: 'PUBLISHED', attempts: [{ grade: 'MIDDLE', outcome: 'PASS', daysAgo: 20, accuracy: [0.9, 0.95, 0.8] }], fsp: { kind: 'LINK', id: 'FSP-DEMO-1002', code: '284613' }, note: 'Frontend Middle, привязан ФСП' }),
    make({ key: 'hero-maria', email: 'maria.volkova@demo.example', ...heroName('Мария Волкова', true, used), specialization: 'ML_ENGINEER', declaredGrade: 'MIDDLE', publication: 'PUBLISHED', attempts: [{ grade: 'MIDDLE', outcome: 'PASS', daysAgo: 9, confident: true }], fsp: { kind: 'LINK', id: 'FSP-DEMO-1003', code: '905172' }, note: 'ML Middle, уверенное прохождение, три записи ФСП (одно мероприятие — две записи)' }),
    make({ key: 'hero-oleg', email: 'oleg.tikhonov@demo.example', ...heroName('Олег Тихонов', false, used), specialization: 'MANUAL_QA', declaredGrade: 'JUNIOR', publication: 'PUBLISHED', attempts: [{ grade: 'JUNIOR', outcome: 'PASS', daysAgo: 30 }], fsp: { kind: 'LINK', id: 'FSP-DEMO-1004', code: '118402' }, note: 'QA Junior; в ФСП есть нерелевантное достижение (робототехника)' }),
    make({ key: 'ready', email: 'ready.candidate@demo.example', ...heroName('Тимур Готовый', false, used), specialization: 'BACKEND', declaredGrade: 'MIDDLE', publication: 'NO_CONSENT', attempts: [], note: 'Профиль и опрос заполнены, теста ещё не было — «пройти тест вживую» на демонстрации' }),
    make({ key: 'failed', email: 'failed.candidate@demo.example', ...heroName('Ксения Неудачная', true, used), specialization: 'FRONTEND', declaredGrade: 'MIDDLE', publication: 'NO_CONSENT', attempts: [{ grade: 'MIDDLE', outcome: 'FAIL', daysAgo: 3, accuracy: [0.55, 0.5, 0.6] }], note: 'Не прошла Middle 3 дня назад: можно пересдать Middle или пройти Junior; в поиске её нет' }),
    make({ key: 'cooldown', email: 'cooldown.candidate@demo.example', ...heroName('Роман Недавний', false, used), specialization: 'BACKEND', declaredGrade: 'SENIOR', publication: 'NO_CONSENT', attempts: [{ grade: 'SENIOR', outcome: 'FAIL', daysAgo: 0, hoursAgo: 3, accuracy: [0.6, 0.5, 0.55] }], note: 'Неуспех 3 часа назад: пересдача Senior закрыта на 24 ч, Middle и Junior доступны' }),
    make({ key: 'abandoned', email: 'abandoned.candidate@demo.example', ...heroName('Елена Прервавшая', true, used), specialization: 'MANUAL_QA', declaredGrade: 'MIDDLE', publication: 'NO_CONSENT', attempts: [{ grade: 'MIDDLE', outcome: 'ABANDONED', daysAgo: 0, hoursAgo: 5 }], note: 'Прервала попытку 5 часов назад: задержка пересдачи как после неуспеха' }),
    make({ key: 'expired', email: 'expired.candidate@demo.example', ...heroName('Георгий Опоздавший', false, used), specialization: 'ML_ENGINEER', declaredGrade: 'JUNIOR', publication: 'NO_CONSENT', attempts: [{ grade: 'JUNIOR', outcome: 'EXPIRED', daysAgo: 2, accuracy: [0.8, 0.8, 0.8] }], note: 'Время теста истекло два дня назад: баллы по сохранённым ответам показаны, квалификации нет' }),
    make({ key: 'hidden', email: 'hidden.candidate@demo.example', ...heroName('Наталья Скрытая', true, used), specialization: 'BACKEND', declaredGrade: 'SENIOR', publication: 'HIDDEN', attempts: [{ grade: 'SENIOR', outcome: 'PASS', daysAgo: 25 }], note: 'Подтверждён Backend Senior, но скрыл профиль из поиска (согласие осталось) — не появляется в подборках' }),
    make({ key: 'nopublish', email: 'nopublish.candidate@demo.example', ...heroName('Сергей Непубличный', false, used), specialization: 'FRONTEND', declaredGrade: 'JUNIOR', publication: 'NO_CONSENT', attempts: [{ grade: 'JUNIOR', outcome: 'PASS', daysAgo: 14 }], note: 'Подтверждён Frontend Junior, но не давал согласия на публикацию — в поиске его нет' }),
    make({ key: 'paused', email: 'paused.candidate@demo.example', ...heroName('Диана Пауза', true, used), specialization: 'FRONTEND', declaredGrade: 'JUNIOR', publication: 'PUBLISHED', availability: 'PAUSED', attempts: [{ grade: 'JUNIOR', outcome: 'PASS', daysAgo: 40 }], note: 'Подтверждён, но поиск работы на паузе — в подборках нет' }),
    make({ key: 'unverified', email: 'unverified.candidate@demo.example', ...heroName('Фёдор Неподтверждённый', false, used), emailVerified: false, profile: 'PARTIAL', specialization: null, declaredGrade: null, survey: false, publication: 'NO_CONSENT', attempts: [], note: 'Email не подтверждён: доступны только экран подтверждения, повторная отправка и выход' }),
    make({ key: 'incomplete', email: 'incomplete.candidate@demo.example', ...heroName('Алиса Начинающая', true, used), profile: 'EMPTY', specialization: null, declaredGrade: null, survey: false, publication: 'NO_CONSENT', attempts: [], note: 'Email подтверждён, профиль пуст, опроса нет — начало онбординга' }),
    make({ key: 'retest', email: 'retest.candidate@demo.example', ...heroName('Павел Переоценка', false, used), specialization: 'BACKEND', declaredGrade: 'JUNIOR', publication: 'PUBLISHED', attempts: [{ grade: 'JUNIOR', outcome: 'PASS', daysAgo: 100, confident: true }], note: 'Junior подтверждён 100 дней назад с уверенным результатом: срок переоценки истёк, можно пройти Middle (повышение)' }),
    make({ key: 'fsp-error', email: 'fsp.error@demo.example', ...heroName('Виктор Сбойный', false, used), specialization: 'BACKEND', declaredGrade: 'SENIOR', publication: 'PUBLISHED', attempts: [{ grade: 'SENIOR', outcome: 'PASS', daysAgo: 18 }], fsp: { kind: 'SYNC_ERROR', id: 'FSP-DEMO-3001' }, note: 'ФСП в состоянии SYNC_ERROR: реестр недоступен, последняя успешная история сохранена' }),
    make({ key: 'fsp-empty-1', email: 'fsp.empty1@demo.example', ...heroName('Юлия Пустая', true, used), specialization: 'FRONTEND', declaredGrade: 'MIDDLE', publication: 'PUBLISHED', attempts: [{ grade: 'MIDDLE', outcome: 'PASS', daysAgo: 22 }], fsp: { kind: 'LINK', id: 'FSP-DEMO-2001', code: '502288' }, note: 'ФСП привязан, истории нет — основной сценарий не ломается' }),
    make({ key: 'fsp-empty-2', email: 'fsp.empty2@demo.example', ...heroName('Артём Нулевой', false, used), specialization: 'MANUAL_QA', declaredGrade: 'MIDDLE', publication: 'PUBLISHED', attempts: [{ grade: 'MIDDLE', outcome: 'PASS', daysAgo: 33 }], fsp: { kind: 'LINK', id: 'FSP-DEMO-2002', code: '377190' }, note: 'ФСП привязан, истории нет' }),
  ];
}

export interface CompanyDef {
  key: string;
  email: string;
  name: string;
  industry: string;
  website: string;
  description: string;
  contactPersonName: string;
  contactChannelType: 'EMAIL' | 'PHONE' | 'MESSENGER';
  contactValue: string;
}

export const COMPANIES: CompanyDef[] = [
  { key: 'fintech', email: 'hr.fintech@demo.example', name: 'Демо Финтех', industry: 'FINTECH', website: 'https://fintech.demo.example', description: 'Вымышленная платёжная платформа: приём платежей, переводы и антифрод.', contactPersonName: 'Светлана Кузьмина', contactChannelType: 'EMAIL', contactValue: 'jobs@fintech.demo.example' },
  { key: 'retail', email: 'hr.retail@demo.example', name: 'Демо Ритейл', industry: 'ECOMMERCE', website: 'https://retail.demo.example', description: 'Вымышленный интернет-магазин электроники с собственной логистикой.', contactPersonName: 'Максим Орлов', contactChannelType: 'MESSENGER', contactValue: '@retail_demo_hr' },
  { key: 'industry', email: 'hr.industry@demo.example', name: 'Демо Индустрия', industry: 'INDUSTRIAL', website: 'https://industry.demo.example', description: 'Вымышленный производитель промышленного оборудования, развивает аналитику и предиктивное обслуживание.', contactPersonName: 'Ирина Белова', contactChannelType: 'EMAIL', contactValue: 'talent@industry.demo.example' },
  { key: 'edu', email: 'hr.edu@demo.example', name: 'Демо Образование', industry: 'EDTECH', website: 'https://edu.demo.example', description: 'Вымышленная онлайн-школа программирования.', contactPersonName: 'Павел Громов', contactChannelType: 'PHONE', contactValue: '+7 (900) 000-00-42' },
];

export interface NeedDef {
  key: string;
  company: string;
  title: string;
  description: string;
  specialization: SpecializationCode;
  allowedGrades: GradeCode[];
  requiredSkills: string[];
  preferredSkills: Array<{ skill: string; mode: 'SELF_REPORTED_ALLOWED' | 'VERIFIED_ONLY' }>;
  workFormat: 'REMOTE' | 'HYBRID' | 'OFFICE';
  city?: string;
  salaryFrom: number;
  salaryTo: number;
}

export const NEEDS: NeedDef[] = [
  { key: 'fintech-backend', company: 'fintech', title: 'Backend-разработчик в команду платежей', description: 'API приёма платежей, идемпотентность операций, PostgreSQL, очереди. Команда из шести человек, релизы раз в неделю.', specialization: 'BACKEND', allowedGrades: ['MIDDLE', 'SENIOR'], requiredSkills: ['sql', 'postgresql'], preferredSkills: [{ skill: 'transactions', mode: 'VERIFIED_ONLY' }, { skill: 'kafka', mode: 'SELF_REPORTED_ALLOWED' }, { skill: 'nestjs', mode: 'SELF_REPORTED_ALLOWED' }], workFormat: 'REMOTE', salaryFrom: 250_000, salaryTo: 350_000 },
  { key: 'fintech-frontend', company: 'fintech', title: 'Frontend-разработчик личного кабинета', description: 'Личный кабинет клиента: формы платежей, отчёты, доступность. React и TypeScript, тесты интерфейса.', specialization: 'FRONTEND', allowedGrades: ['MIDDLE', 'SENIOR'], requiredSkills: ['typescript', 'async-js'], preferredSkills: [{ skill: 'react', mode: 'VERIFIED_ONLY' }, { skill: 'nextjs', mode: 'SELF_REPORTED_ALLOWED' }, { skill: 'web-accessibility', mode: 'SELF_REPORTED_ALLOWED' }], workFormat: 'HYBRID', city: 'Москва', salaryFrom: 220_000, salaryTo: 320_000 },
  { key: 'fintech-qa', company: 'fintech', title: 'Senior QA: приоритизация и отчёты', description: 'Планирование регрессии по рискам, ведение отчётов о дефектах, участие в приёмке релизов.', specialization: 'MANUAL_QA', allowedGrades: ['SENIOR'], requiredSkills: ['test-prioritization', 'bug-reporting'], preferredSkills: [{ skill: 'requirements-analysis', mode: 'VERIFIED_ONLY' }, { skill: 'jira', mode: 'SELF_REPORTED_ALLOWED' }], workFormat: 'REMOTE', salaryFrom: 220_000, salaryTo: 300_000 },
  { key: 'retail-frontend', company: 'retail', title: 'Frontend-разработчик витрины', description: 'Каталог, корзина и оформление заказа интернет-магазина. Важна скорость интерфейса и аккуратная работа с API.', specialization: 'FRONTEND', allowedGrades: ['JUNIOR', 'MIDDLE'], requiredSkills: ['javascript'], preferredSkills: [{ skill: 'react', mode: 'VERIFIED_ONLY' }, { skill: 'typescript', mode: 'VERIFIED_ONLY' }, { skill: 'web-accessibility', mode: 'SELF_REPORTED_ALLOWED' }], workFormat: 'REMOTE', salaryFrom: 110_000, salaryTo: 200_000 },
  { key: 'retail-qa', company: 'retail', title: 'Тестировщик витрины и оформления заказа', description: 'Ручное тестирование веб-интерфейса и API заказов, регрессия перед релизами, отчёты о дефектах.', specialization: 'MANUAL_QA', allowedGrades: ['JUNIOR', 'MIDDLE'], requiredSkills: ['test-design'], preferredSkills: [{ skill: 'bug-reporting', mode: 'VERIFIED_ONLY' }, { skill: 'api-testing', mode: 'SELF_REPORTED_ALLOWED' }], workFormat: 'OFFICE', city: 'Санкт-Петербург', salaryFrom: 90_000, salaryTo: 160_000 },
  { key: 'industry-ml', company: 'industry', title: 'ML-инженер: предиктивное обслуживание', description: 'Модели отказов оборудования на временных рядах датчиков, валидация без утечек, мониторинг в эксплуатации.', specialization: 'ML_ENGINEER', allowedGrades: ['MIDDLE', 'SENIOR'], requiredSkills: ['python', 'ml-metrics'], preferredSkills: [{ skill: 'pandas', mode: 'VERIFIED_ONLY' }, { skill: 'model-validation', mode: 'VERIFIED_ONLY' }, { skill: 'pytorch', mode: 'SELF_REPORTED_ALLOWED' }], workFormat: 'REMOTE', salaryFrom: 300_000, salaryTo: 420_000 },
  { key: 'industry-backend', company: 'industry', title: 'Backend-разработчик промышленных API', description: 'Сервисы сбора данных с оборудования, REST API и хранение в PostgreSQL.', specialization: 'BACKEND', allowedGrades: ['JUNIOR', 'MIDDLE'], requiredSkills: ['rest-api'], preferredSkills: [{ skill: 'sql', mode: 'VERIFIED_ONLY' }, { skill: 'python', mode: 'SELF_REPORTED_ALLOWED' }], workFormat: 'HYBRID', city: 'Екатеринбург', salaryFrom: 120_000, salaryTo: 220_000 },
  { key: 'edu-qa', company: 'edu', title: 'QA-инженер платформы обучения', description: 'Анализ требований к учебным модулям, тест-дизайн, граничные значения оценивания.', specialization: 'MANUAL_QA', allowedGrades: ['MIDDLE', 'SENIOR'], requiredSkills: ['requirements-analysis', 'boundary-testing'], preferredSkills: [{ skill: 'test-prioritization', mode: 'VERIFIED_ONLY' }, { skill: 'jira', mode: 'SELF_REPORTED_ALLOWED' }], workFormat: 'REMOTE', salaryFrom: 160_000, salaryTo: 260_000 },
  { key: 'edu-ml', company: 'edu', title: 'ML-инженер: рекомендации заданий', description: 'Подготовка данных об учениках, модели рекомендаций следующего задания, оценка качества.', specialization: 'ML_ENGINEER', allowedGrades: ['JUNIOR', 'MIDDLE'], requiredSkills: ['data-preparation'], preferredSkills: [{ skill: 'scikit-learn', mode: 'VERIFIED_ONLY' }, { skill: 'classification', mode: 'VERIFIED_ONLY' }], workFormat: 'REMOTE', salaryFrom: 140_000, salaryTo: 240_000 },
];

export type InvitationOutcome = 'SENT' | 'VIEWED' | 'ACCEPTED' | 'ACCEPTED_REVOKED' | 'DECLINED' | 'WITHDRAWN' | 'EXPIRED';

export interface InvitationDef {
  company: string;
  candidate: string;
  need: string | null;
  daysAgo: number;
  outcome: InvitationOutcome;
  title: string;
  description: string;
  salaryFrom: number;
  salaryTo: number;
  workFormat: 'REMOTE' | 'HYBRID' | 'OFFICE';
}

export const INVITATIONS: InvitationDef[] = [
  { company: 'fintech', candidate: 'hero-anna', need: 'fintech-backend', daysAgo: 1, outcome: 'SENT', title: 'Backend-разработчик в команду платежей', description: 'API приёма платежей, идемпотентность, PostgreSQL. Команда из шести человек, релизы раз в неделю, удалённо.', salaryFrom: 260_000, salaryTo: 330_000, workFormat: 'REMOTE' },
  { company: 'fintech', candidate: 'be-middle-2', need: 'fintech-backend', daysAgo: 3, outcome: 'VIEWED', title: 'Backend-разработчик в команду платежей', description: 'Развитие платёжного API; код-ревью, дежурства раз в шесть недель.', salaryFrom: 250_000, salaryTo: 320_000, workFormat: 'REMOTE' },
  { company: 'fintech', candidate: 'be-senior-1', need: 'fintech-backend', daysAgo: 6, outcome: 'ACCEPTED', title: 'Ведущий backend-разработчик (платежи)', description: 'Проектирование надёжных платёжных сценариев, наставничество в команде.', salaryFrom: 320_000, salaryTo: 400_000, workFormat: 'REMOTE' },
  { company: 'retail', candidate: 'be-senior-1', need: null, daysAgo: 2, outcome: 'SENT', title: 'Backend-инженер логистических сервисов', description: 'Сервисы маршрутизации заказов и складской учёт. Предложение без публикации вакансии.', salaryFrom: 300_000, salaryTo: 380_000, workFormat: 'HYBRID' },
  { company: 'retail', candidate: 'fe-middle-3', need: 'retail-frontend', daysAgo: 9, outcome: 'ACCEPTED_REVOKED', title: 'Frontend-разработчик витрины', description: 'Каталог и оформление заказа, скорость интерфейса.', salaryFrom: 170_000, salaryTo: 210_000, workFormat: 'REMOTE' },
  { company: 'industry', candidate: 'ml-senior-2', need: 'industry-ml', daysAgo: 8, outcome: 'DECLINED', title: 'ML-инженер: предиктивное обслуживание', description: 'Модели отказов оборудования, мониторинг дрейфа.', salaryFrom: 350_000, salaryTo: 420_000, workFormat: 'REMOTE' },
  { company: 'industry', candidate: 'ml-middle-4', need: 'industry-ml', daysAgo: 4, outcome: 'WITHDRAWN', title: 'ML-инженер: предиктивное обслуживание', description: 'Временные ряды датчиков, валидация без утечек.', salaryFrom: 280_000, salaryTo: 340_000, workFormat: 'REMOTE' },
  { company: 'edu', candidate: 'qa-middle-1', need: 'edu-qa', daysAgo: 20, outcome: 'EXPIRED', title: 'QA-инженер платформы обучения', description: 'Тест-дизайн учебных модулей, граничные значения оценивания.', salaryFrom: 170_000, salaryTo: 230_000, workFormat: 'REMOTE' },
  { company: 'edu', candidate: 'qa-senior-2', need: 'edu-qa', daysAgo: 5, outcome: 'ACCEPTED', title: 'Старший QA-инженер', description: 'Приоритизация проверок, наставничество, ведение метрик качества.', salaryFrom: 230_000, salaryTo: 270_000, workFormat: 'REMOTE' },
  { company: 'fintech', candidate: 'fe-senior-1', need: 'fintech-frontend', daysAgo: 0, outcome: 'SENT', title: 'Frontend-разработчик личного кабинета', description: 'React и TypeScript, формы платежей, отчёты. Гибрид, Москва.', salaryFrom: 280_000, salaryTo: 330_000, workFormat: 'HYBRID' },
];

export type VacancyState = 'PUBLISHED' | 'DRAFT' | 'CLOSED';

/** Публичные вакансии демо-компаний. Требования берутся из потребности с ключом `need`; описание — публичное, для кандидатов. */
export interface VacancyDef {
  key: string;
  need: string;
  description: string;
  state: VacancyState;
  /** Сколько дней назад опубликована (для CLOSED — закрыта примерно через неделю после публикации). */
  publishedDaysAgo: number;
  /** Публичная вакансия может отличаться от внутренней потребности, например форматом работы. */
  workFormat?: 'REMOTE' | 'HYBRID' | 'OFFICE';
  city?: string | null;
}

export const VACANCIES: VacancyDef[] = [
  { key: 'fintech-backend', need: 'fintech-backend', state: 'PUBLISHED', publishedDaysAgo: 14, description: 'Развиваем API приёма платежей: идемпотентность операций, PostgreSQL, очереди. Команда из шести человек, релизы раз в неделю, работа полностью удалённо. Зарплатная вилка указана до вычета налогов.' },
  { key: 'fintech-frontend', need: 'fintech-frontend', state: 'PUBLISHED', publishedDaysAgo: 10, workFormat: 'REMOTE', city: null, description: 'Личный кабинет клиента платёжной платформы: формы платежей, отчёты, доступность. React и TypeScript, тесты интерфейса. Полностью удалённо (внутренняя потребность допускала гибрид — публичная вакансия шире).' },
  { key: 'fintech-qa', need: 'fintech-qa', state: 'DRAFT', publishedDaysAgo: 0, description: 'Планирование регрессии по рискам, ведение отчётов о дефектах, участие в приёмке релизов. Удалённо.' },
  { key: 'retail-frontend', need: 'retail-frontend', state: 'PUBLISHED', publishedDaysAgo: 12, description: 'Каталог, корзина и оформление заказа интернет-магазина. Важна скорость интерфейса и аккуратная работа с API. Подходит для уровня Junior и Middle.' },
  { key: 'retail-qa', need: 'retail-qa', state: 'PUBLISHED', publishedDaysAgo: 9, description: 'Ручное тестирование веб-интерфейса и API заказов, регрессия перед релизами, отчёты о дефектах. Офис в Санкт-Петербурге.' },
  { key: 'industry-ml', need: 'industry-ml', state: 'PUBLISHED', publishedDaysAgo: 11, description: 'Модели отказов оборудования на временных рядах датчиков, валидация без утечек, мониторинг в эксплуатации. Удалённо.' },
  { key: 'edu-qa', need: 'edu-qa', state: 'CLOSED', publishedDaysAgo: 25, description: 'Анализ требований к учебным модулям, тест-дизайн, граничные значения оценивания. Вакансия закрыта: набор завершён.' },
  { key: 'edu-ml', need: 'edu-ml', state: 'PUBLISHED', publishedDaysAgo: 6, description: 'Подготовка данных об учениках, модели рекомендаций следующего задания, оценка качества. Удалённо; подходит для уровня Junior и Middle.' },
];

export type ApplicationOutcome = 'SENT' | 'VIEWED' | 'SHORTLISTED' | 'REJECTED' | 'WITHDRAWN';

/** Самостоятельные отклики кандидатов на вакансии — во всех статусах. */
export interface ApplicationDef {
  candidate: string;
  vacancy: string;
  daysAgo: number;
  outcome: ApplicationOutcome;
  coverNote?: string;
  note: string;
}

export const APPLICATIONS: ApplicationDef[] = [
  { candidate: 'fe-middle-3', vacancy: 'fintech-frontend', daysAgo: 1, outcome: 'SENT', coverNote: 'Делал личные кабинеты на React и TypeScript, работаю удалённо. Готов обсудить формат и условия.', note: 'новый отклик с сообщением, подходит по всем условиям: «Демо Финтех» видит счётчик новых откликов' },
  { candidate: 'hero-igor', vacancy: 'fintech-frontend', daysAgo: 3, outcome: 'VIEWED', note: 'просмотрен; в профиле только офис — отклик не отсекается, но помечен «не все обязательные условия»' },
  { candidate: 'fe-middle-4', vacancy: 'fintech-frontend', daysAgo: 4, outcome: 'SHORTLISTED', note: 'в шорт-листе' },
  { candidate: 'be-junior-1', vacancy: 'fintech-backend', daysAgo: 2, outcome: 'SENT', coverNote: 'Недавно подтвердил Junior, но очень хочу в платежи — готов быстро расти.', note: 'грейд вне допустимых: отклик не отсекается, но помечен «не все обязательные условия»' },
  { candidate: 'fe-junior-2', vacancy: 'retail-frontend', daysAgo: 5, outcome: 'SHORTLISTED', note: 'в шорт-листе' },
  { candidate: 'fe-junior-5', vacancy: 'retail-frontend', daysAgo: 7, outcome: 'REJECTED', note: 'отклонён работодателем' },
  { candidate: 'nopublish', vacancy: 'retail-frontend', daysAgo: 1, outcome: 'SENT', coverNote: 'Профиль в общем поиске скрыт, но на эту вакансию откликаюсь сам.', note: 'кандидат без публикации профиля: компания видит его только благодаря отклику' },
  { candidate: 'hero-oleg', vacancy: 'retail-qa', daysAgo: 2, outcome: 'SENT', note: 'QA Junior с нерелевантным достижением ФСП' },
  { candidate: 'qa-middle-3', vacancy: 'retail-qa', daysAgo: 6, outcome: 'WITHDRAWN', note: 'отозван кандидатом вместе с доступом к контактам' },
  { candidate: 'ml-middle-1', vacancy: 'industry-ml', daysAgo: 4, outcome: 'VIEWED', note: 'просмотрен' },
  { candidate: 'ml-junior-2', vacancy: 'edu-ml', daysAgo: 3, outcome: 'SHORTLISTED', note: 'в шорт-листе' },
  { candidate: 'qa-senior-1', vacancy: 'edu-qa', daysAgo: 18, outcome: 'SHORTLISTED', note: 'отклик на вакансию, которая потом закрыта: остаётся в работе' },
];

export const SELECTION_NEEDS = ['fintech-backend', 'retail-frontend', 'industry-ml', 'edu-qa'];
export const BOOKMARKS: Array<{ company: string; need: string; take: number }> = [
  { company: 'fintech', need: 'fintech-backend', take: 3 },
  { company: 'retail', need: 'retail-frontend', take: 2 },
];

export type TaskState = 'ACTIVE' | 'DRAFT' | 'CLOSED';

/** Короткое задание работодателя. */
export interface TaskDef {
  key: string;
  company: string;
  title: string;
  prompt: string;
  specialization: SpecializationCode;
  allowedGrades: Array<'JUNIOR' | 'MIDDLE' | 'SENIOR'>;
  kind: 'QUIZ' | 'APPROACH';
  options?: string[];
  correctIndex?: number;
  explanation?: string;
  state: TaskState;
  publishedDaysAgo: number;
}

export const TASKS: TaskDef[] = [
  {
    key: 'fintech-idempotency',
    company: 'fintech',
    title: 'Повтор платёжного запроса',
    prompt: 'Клиент повторил POST /payments после таймаута. Как сделать так, чтобы деньги не списались дважды?',
    specialization: 'BACKEND',
    allowedGrades: ['MIDDLE', 'SENIOR'],
    kind: 'QUIZ',
    options: ['Игнорировать повторные запросы по IP', 'Ключ идемпотентности и уникальный индекс в базе', 'Увеличить таймаут клиента до минуты'],
    correctIndex: 1,
    explanation: 'Ключ идемпотентности делает повтор безопасным: второй запрос получает результат первого, а уникальный индекс защищает от гонки.',
    state: 'ACTIVE',
    publishedDaysAgo: 20,
  },
  {
    key: 'fintech-slow-report',
    company: 'fintech',
    title: 'Отчёт открывается 12 секунд',
    prompt: 'Страница отчёта по платежам загружается около 12 секунд. Опишите, как вы будете искать причину и что проверите в первую очередь.',
    specialization: 'BACKEND',
    allowedGrades: [],
    kind: 'APPROACH',
    state: 'ACTIVE',
    publishedDaysAgo: 15,
  },
  {
    key: 'fintech-react-key',
    company: 'fintech',
    title: 'Ключи в списке React',
    prompt: 'В таблице платежей строки могут вставляться в середину списка. Что использовать в качестве key?',
    specialization: 'FRONTEND',
    allowedGrades: [],
    kind: 'QUIZ',
    options: ['Индекс элемента в массиве', 'Стабильный идентификатор платежа', 'Случайное число при каждом рендере'],
    correctIndex: 1,
    explanation: 'Стабильный идентификатор позволяет React сопоставлять элементы между рендерами; индекс или случайное значение ломают это сопоставление.',
    state: 'ACTIVE',
    publishedDaysAgo: 12,
  },
  {
    key: 'retail-a11y',
    company: 'retail',
    title: 'Доступность кнопки без текста',
    prompt: 'Кнопка корзины в шапке — только иконка. Что нужно, чтобы её понимали пользователи скринридеров?',
    specialization: 'FRONTEND',
    allowedGrades: ['JUNIOR', 'MIDDLE'],
    kind: 'QUIZ',
    options: ['Ничего: иконка очевидна', 'Доступное имя через aria-label или скрытый текст', 'Заменить кнопку на div с обработчиком клика'],
    correctIndex: 1,
    explanation: 'Элементу нужно доступное имя; нативная кнопка с aria-label сохраняет и роль, и работу с клавиатуры.',
    state: 'ACTIVE',
    publishedDaysAgo: 9,
  },
  {
    key: 'retail-boundaries',
    company: 'retail',
    title: 'Граничные значения скидки',
    prompt: 'Промокод даёт скидку от 1 до 50 % и не суммируется с акциями. Какой набор значений процента лучше всего проверяет границы?',
    specialization: 'MANUAL_QA',
    allowedGrades: [],
    kind: 'QUIZ',
    options: ['25', '0, 1, 50, 51', '10, 20, 30, 40'],
    correctIndex: 1,
    explanation: 'Граничные значения проверяют по обе стороны каждой границы: 0 и 1 для нижней, 50 и 51 для верхней.',
    state: 'ACTIVE',
    publishedDaysAgo: 8,
  },
  {
    key: 'industry-leakage',
    company: 'industry',
    title: 'Утечка данных при валидации',
    prompt: 'Модель отказов оборудования обучена на временных рядах датчиков. Как разбить данные на обучение и проверку, чтобы не получить утечку?',
    specialization: 'ML_ENGINEER',
    allowedGrades: ['MIDDLE', 'SENIOR'],
    kind: 'QUIZ',
    options: ['Случайно перемешать все точки и взять 20 % на проверку', 'Разбить по времени: проверка — строго более поздний период', 'Обучать и проверять на одних и тех же данных'],
    correctIndex: 1,
    explanation: 'Для временных рядов проверка должна быть позже обучения по времени; случайное перемешивание «подсматривает в будущее».',
    state: 'ACTIVE',
    publishedDaysAgo: 10,
  },
  {
    key: 'edu-closed',
    company: 'edu',
    title: 'Приоритизация проверок (завершено)',
    prompt: 'Релиз через день, времени на полную регрессию нет. По какому принципу вы выберете проверки?',
    specialization: 'MANUAL_QA',
    allowedGrades: [],
    kind: 'APPROACH',
    state: 'CLOSED',
    publishedDaysAgo: 30,
  },
  {
    key: 'fintech-draft',
    company: 'fintech',
    title: 'Транзакции и уровни изоляции (черновик)',
    prompt: 'Два платежа одновременно списывают с одного счёта. Какой уровень изоляции и какие средства вы выберете?',
    specialization: 'BACKEND',
    allowedGrades: ['SENIOR'],
    kind: 'APPROACH',
    state: 'DRAFT',
    publishedDaysAgo: 0,
  },
];

/** Ответы кандидатов на задания (для демонстрации кабинета автора и истории кандидата). */
export interface TaskResponseDef {
  candidate: string;
  task: string;
  daysAgo: number;
  answer: { selectedIndex?: number; answerText?: string };
  review?: { verdict: 'STRONG' | 'ACCEPTABLE' | 'WEAK'; comment?: string };
  note: string;
}

export const TASK_RESPONSES: TaskResponseDef[] = [
  { candidate: 'be-middle-1', task: 'fintech-idempotency', daysAgo: 9, answer: { selectedIndex: 1 }, note: 'верный ответ на тест' },
  { candidate: 'be-middle-2', task: 'fintech-idempotency', daysAgo: 8, answer: { selectedIndex: 0 }, note: 'неверный ответ на тест' },
  {
    candidate: 'be-middle-1',
    task: 'fintech-slow-report',
    daysAgo: 1,
    answer: {
      answerText:
        'Сначала включу логирование времени запросов и посмотрю, где тратится время: база, сеть или обработка. Затем разберу EXPLAIN ANALYZE самого тяжёлого запроса, проверю индексы и N+1. После — кэш или предагрегация, если отчёт строится по неизменным данным.',
    },
    note: 'разбор без оценки — работодатель увидит счётчик «ждут оценки»',
  },
  {
    candidate: 'be-middle-2',
    task: 'fintech-slow-report',
    daysAgo: 6,
    answer: { answerText: 'Замерю, где тратится время, посмотрю план запроса и индексы, проверю объём выгрузки и необходимость пагинации.' },
    review: { verdict: 'ACCEPTABLE', comment: 'Верное направление; добавьте, как проверите, что узкое место действительно найдено.' },
    note: 'разбор с оценкой и комментарием — кандидат видит обратную связь',
  },
  { candidate: 'fe-middle-3', task: 'fintech-react-key', daysAgo: 5, answer: { selectedIndex: 1 }, note: 'верный ответ, Frontend' },
  { candidate: 'hero-igor', task: 'retail-a11y', daysAgo: 4, answer: { selectedIndex: 1 }, note: 'верный ответ, Frontend Middle' },
  { candidate: 'hero-maria', task: 'industry-leakage', daysAgo: 3, answer: { selectedIndex: 1 }, note: 'верный ответ, ML Middle' },
  {
    candidate: 'qa-middle-1',
    task: 'edu-closed',
    daysAgo: 22,
    answer: { answerText: 'Опираюсь на риски: сначала сквозные сценарии оплаты и входа, затем изменённые модули и места, где недавно были дефекты.' },
    review: { verdict: 'STRONG', comment: 'Чёткий принцип отбора, по рискам.' },
    note: 'ответ на закрытое задание сохраняется',
  },
];
