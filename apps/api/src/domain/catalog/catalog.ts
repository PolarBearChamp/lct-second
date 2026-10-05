/**
 * Справочники платформы (версия catalog-v1). Источник истины — этот файл;
 * при старте API справочники синхронизируются в таблицы Specialization / CompetencyGroup / Skill.
 *
 * Самоописанный стек выбирается из этого же справочника, поэтому требования работодателя
 * сопоставляются с навыками кандидата по стабильным кодам, без разбора свободного текста.
 */

export const CATALOG_VERSION = 'catalog-v1';

export type SpecializationCode = 'FRONTEND' | 'BACKEND' | 'ML_ENGINEER' | 'MANUAL_QA';
export type GradeCode = 'JUNIOR' | 'MIDDLE' | 'SENIOR';

export const SPECIALIZATION_CODES: SpecializationCode[] = ['FRONTEND', 'BACKEND', 'ML_ENGINEER', 'MANUAL_QA'];
export const GRADE_CODES: GradeCode[] = ['JUNIOR', 'MIDDLE', 'SENIOR'];
export const GRADE_ORDER: Record<GradeCode, number> = { JUNIOR: 1, MIDDLE: 2, SENIOR: 3 };

export interface SpecializationDef {
  code: SpecializationCode;
  title: string;
  description: string;
  sortOrder: number;
}

export interface CompetencyGroupDef {
  code: string;
  specialization: SpecializationCode;
  title: string;
  sortOrder: number;
}

export type SkillCategory = 'LANGUAGE' | 'FRAMEWORK' | 'LIBRARY' | 'DATABASE' | 'CONCEPT' | 'PRACTICE' | 'TOOL';

export interface SkillDef {
  code: string;
  title: string;
  category: SkillCategory;
  specializations: SpecializationCode[];
}

export const SPECIALIZATIONS: SpecializationDef[] = [
  {
    code: 'FRONTEND',
    title: 'Frontend-разработчик',
    description: 'Клиентские веб-приложения: JavaScript/TypeScript, состояние интерфейса, работа с API.',
    sortOrder: 1,
  },
  {
    code: 'BACKEND',
    title: 'Backend-разработчик',
    description: 'Серверная логика, HTTP API, SQL и моделирование данных, транзакции и надёжность.',
    sortOrder: 2,
  },
  {
    code: 'ML_ENGINEER',
    title: 'ML-инженер',
    description: 'Подготовка данных, метрики и валидация моделей, эксплуатация ML-решений.',
    sortOrder: 3,
  },
  {
    code: 'MANUAL_QA',
    title: 'Инженер по ручному тестированию (Manual QA)',
    description: 'Анализ требований, тест-дизайн, тест-кейсы и работа с дефектами.',
    sortOrder: 4,
  },
];

export const COMPETENCY_GROUPS: CompetencyGroupDef[] = [
  { code: 'FE_JS_ASYNC', specialization: 'FRONTEND', title: 'JavaScript/TypeScript и асинхронность', sortOrder: 1 },
  { code: 'FE_UI_STATE', specialization: 'FRONTEND', title: 'Состояние и поведение интерфейса', sortOrder: 2 },
  { code: 'FE_HTTP_ERRORS', specialization: 'FRONTEND', title: 'HTTP/API и обработка ошибок клиента', sortOrder: 3 },
  { code: 'BE_API', specialization: 'BACKEND', title: 'API и обработка запросов', sortOrder: 1 },
  { code: 'BE_SQL', specialization: 'BACKEND', title: 'SQL и моделирование данных', sortOrder: 2 },
  { code: 'BE_RELIABILITY', specialization: 'BACKEND', title: 'Транзакции, конкурентность и надёжность', sortOrder: 3 },
  { code: 'ML_DATA', specialization: 'ML_ENGINEER', title: 'Подготовка данных и утечки', sortOrder: 1 },
  { code: 'ML_METRICS', specialization: 'ML_ENGINEER', title: 'Метрики и оценка моделей', sortOrder: 2 },
  {
    code: 'ML_VALIDATION',
    specialization: 'ML_ENGINEER',
    title: 'Валидация, выбор модели и эксплуатационные сценарии',
    sortOrder: 3,
  },
  { code: 'QA_REQUIREMENTS', specialization: 'MANUAL_QA', title: 'Анализ требований', sortOrder: 1 },
  { code: 'QA_TEST_DESIGN', specialization: 'MANUAL_QA', title: 'Границы и классы эквивалентности', sortOrder: 2 },
  { code: 'QA_DEFECTS', specialization: 'MANUAL_QA', title: 'Тест-кейсы, дефекты и приоритизация', sortOrder: 3 },
];

export const SKILLS: SkillDef[] = [
  // ── Проверяемые тестами (покрыты семействами банка) ──
  { code: 'javascript', title: 'JavaScript', category: 'LANGUAGE', specializations: ['FRONTEND', 'BACKEND'] },
  { code: 'async-js', title: 'Асинхронность JS (event loop, Promise)', category: 'CONCEPT', specializations: ['FRONTEND', 'BACKEND'] },
  { code: 'typescript', title: 'TypeScript', category: 'LANGUAGE', specializations: ['FRONTEND', 'BACKEND'] },
  { code: 'react', title: 'React', category: 'FRAMEWORK', specializations: ['FRONTEND'] },
  { code: 'state-management', title: 'Управление состоянием UI', category: 'CONCEPT', specializations: ['FRONTEND'] },
  { code: 'http', title: 'HTTP', category: 'CONCEPT', specializations: ['FRONTEND', 'BACKEND', 'MANUAL_QA'] },
  { code: 'error-handling', title: 'Обработка ошибок на клиенте', category: 'CONCEPT', specializations: ['FRONTEND'] },
  { code: 'rest-api', title: 'REST API', category: 'CONCEPT', specializations: ['BACKEND', 'FRONTEND'] },
  { code: 'sql', title: 'SQL', category: 'LANGUAGE', specializations: ['BACKEND', 'ML_ENGINEER', 'MANUAL_QA'] },
  { code: 'postgresql', title: 'PostgreSQL', category: 'DATABASE', specializations: ['BACKEND'] },
  { code: 'transactions', title: 'Транзакции и уровни изоляции', category: 'CONCEPT', specializations: ['BACKEND'] },
  { code: 'concurrency', title: 'Конкурентность и надёжность', category: 'CONCEPT', specializations: ['BACKEND'] },
  { code: 'python', title: 'Python', category: 'LANGUAGE', specializations: ['ML_ENGINEER', 'BACKEND'] },
  { code: 'pandas', title: 'pandas', category: 'LIBRARY', specializations: ['ML_ENGINEER'] },
  { code: 'scikit-learn', title: 'scikit-learn', category: 'LIBRARY', specializations: ['ML_ENGINEER'] },
  { code: 'data-preparation', title: 'Подготовка данных', category: 'CONCEPT', specializations: ['ML_ENGINEER'] },
  { code: 'ml-metrics', title: 'Метрики качества моделей', category: 'CONCEPT', specializations: ['ML_ENGINEER'] },
  { code: 'classification', title: 'Задачи классификации', category: 'CONCEPT', specializations: ['ML_ENGINEER'] },
  { code: 'model-validation', title: 'Валидация моделей', category: 'CONCEPT', specializations: ['ML_ENGINEER'] },
  { code: 'requirements-analysis', title: 'Анализ требований', category: 'PRACTICE', specializations: ['MANUAL_QA'] },
  { code: 'test-design', title: 'Тест-дизайн', category: 'PRACTICE', specializations: ['MANUAL_QA'] },
  {
    code: 'boundary-testing',
    title: 'Граничные значения и классы эквивалентности',
    category: 'PRACTICE',
    specializations: ['MANUAL_QA'],
  },
  { code: 'bug-reporting', title: 'Баг-репорты, severity и priority', category: 'PRACTICE', specializations: ['MANUAL_QA'] },
  { code: 'test-prioritization', title: 'Приоритизация проверок', category: 'PRACTICE', specializations: ['MANUAL_QA'] },

  // ── Только самоописание (в MVP нет проверяющих заданий) ──
  { code: 'html-css', title: 'HTML/CSS', category: 'LANGUAGE', specializations: ['FRONTEND'] },
  { code: 'vue', title: 'Vue.js', category: 'FRAMEWORK', specializations: ['FRONTEND'] },
  { code: 'angular', title: 'Angular', category: 'FRAMEWORK', specializations: ['FRONTEND'] },
  { code: 'nextjs', title: 'Next.js', category: 'FRAMEWORK', specializations: ['FRONTEND'] },
  { code: 'redux', title: 'Redux / Redux Toolkit', category: 'LIBRARY', specializations: ['FRONTEND'] },
  { code: 'webpack-vite', title: 'Webpack / Vite', category: 'TOOL', specializations: ['FRONTEND'] },
  { code: 'web-accessibility', title: 'Доступность веб-интерфейсов', category: 'PRACTICE', specializations: ['FRONTEND'] },
  { code: 'graphql', title: 'GraphQL', category: 'CONCEPT', specializations: ['FRONTEND', 'BACKEND'] },
  { code: 'nodejs', title: 'Node.js', category: 'FRAMEWORK', specializations: ['BACKEND', 'FRONTEND'] },
  { code: 'nestjs', title: 'NestJS', category: 'FRAMEWORK', specializations: ['BACKEND'] },
  { code: 'java', title: 'Java', category: 'LANGUAGE', specializations: ['BACKEND'] },
  { code: 'spring', title: 'Spring', category: 'FRAMEWORK', specializations: ['BACKEND'] },
  { code: 'go', title: 'Go', category: 'LANGUAGE', specializations: ['BACKEND'] },
  { code: 'csharp', title: 'C#/.NET', category: 'LANGUAGE', specializations: ['BACKEND'] },
  { code: 'kotlin', title: 'Kotlin', category: 'LANGUAGE', specializations: ['BACKEND'] },
  { code: 'django', title: 'Django / FastAPI', category: 'FRAMEWORK', specializations: ['BACKEND'] },
  { code: 'redis', title: 'Redis', category: 'DATABASE', specializations: ['BACKEND'] },
  { code: 'mongodb', title: 'MongoDB', category: 'DATABASE', specializations: ['BACKEND'] },
  { code: 'kafka', title: 'Apache Kafka', category: 'TOOL', specializations: ['BACKEND'] },
  { code: 'docker', title: 'Docker', category: 'TOOL', specializations: ['BACKEND', 'ML_ENGINEER', 'FRONTEND'] },
  { code: 'kubernetes', title: 'Kubernetes', category: 'TOOL', specializations: ['BACKEND', 'ML_ENGINEER'] },
  { code: 'linux', title: 'Linux', category: 'TOOL', specializations: ['BACKEND', 'ML_ENGINEER', 'MANUAL_QA'] },
  { code: 'git', title: 'Git', category: 'TOOL', specializations: ['FRONTEND', 'BACKEND', 'ML_ENGINEER', 'MANUAL_QA'] },
  { code: 'numpy', title: 'NumPy', category: 'LIBRARY', specializations: ['ML_ENGINEER'] },
  { code: 'pytorch', title: 'PyTorch', category: 'LIBRARY', specializations: ['ML_ENGINEER'] },
  { code: 'tensorflow', title: 'TensorFlow', category: 'LIBRARY', specializations: ['ML_ENGINEER'] },
  { code: 'gradient-boosting', title: 'Градиентный бустинг (CatBoost, XGBoost, LightGBM)', category: 'LIBRARY', specializations: ['ML_ENGINEER'] },
  { code: 'mlflow', title: 'MLflow', category: 'TOOL', specializations: ['ML_ENGINEER'] },
  { code: 'airflow', title: 'Apache Airflow', category: 'TOOL', specializations: ['ML_ENGINEER', 'BACKEND'] },
  { code: 'spark', title: 'Apache Spark', category: 'TOOL', specializations: ['ML_ENGINEER'] },
  { code: 'nlp', title: 'Обработка естественного языка', category: 'CONCEPT', specializations: ['ML_ENGINEER'] },
  { code: 'computer-vision', title: 'Компьютерное зрение', category: 'CONCEPT', specializations: ['ML_ENGINEER'] },
  { code: 'api-testing', title: 'Тестирование API (Postman и аналоги)', category: 'PRACTICE', specializations: ['MANUAL_QA'] },
  { code: 'mobile-testing', title: 'Тестирование мобильных приложений', category: 'PRACTICE', specializations: ['MANUAL_QA'] },
  { code: 'web-testing', title: 'Тестирование веб-приложений, DevTools', category: 'PRACTICE', specializations: ['MANUAL_QA'] },
  { code: 'test-management', title: 'TMS (TestIT, TestRail, Allure TestOps)', category: 'TOOL', specializations: ['MANUAL_QA'] },
  { code: 'jira', title: 'Jira / YouTrack', category: 'TOOL', specializations: ['MANUAL_QA', 'FRONTEND', 'BACKEND'] },
  { code: 'traffic-sniffing', title: 'Charles / Fiddler', category: 'TOOL', specializations: ['MANUAL_QA'] },
];

export interface CodeTitle {
  code: string;
  title: string;
}

export const INDUSTRIES: CodeTitle[] = [
  { code: 'FINTECH', title: 'Финтех и банки' },
  { code: 'ECOMMERCE', title: 'E-commerce и ритейл' },
  { code: 'GOVTECH', title: 'Госсектор' },
  { code: 'EDTECH', title: 'Образование' },
  { code: 'HEALTHTECH', title: 'Медицина' },
  { code: 'TELECOM', title: 'Телеком' },
  { code: 'GAMEDEV', title: 'Игры' },
  { code: 'INDUSTRIAL', title: 'Промышленность и энергетика' },
  { code: 'LOGISTICS', title: 'Логистика и транспорт' },
  { code: 'MEDIA', title: 'Медиа и развлечения' },
  { code: 'CYBERSECURITY', title: 'Информационная безопасность' },
  { code: 'ANY', title: 'Отрасль не важна' },
];

export const TEAM_ROLES: CodeTitle[] = [
  { code: 'DEVELOPER', title: 'Разработчик' },
  { code: 'TESTER', title: 'Тестировщик' },
  { code: 'DATA_SCIENTIST', title: 'Исследователь данных' },
  { code: 'TEAM_LEAD', title: 'Тимлид' },
  { code: 'TECH_LEAD', title: 'Техлид' },
  { code: 'ARCHITECT', title: 'Архитектор' },
  { code: 'MENTOR', title: 'Наставник' },
  { code: 'TEAM_CAPTAIN', title: 'Капитан команды на соревнованиях' },
];

export const SOFT_SKILLS: CodeTitle[] = [
  { code: 'COMMUNICATION', title: 'Коммуникация' },
  { code: 'TEAMWORK', title: 'Командная работа' },
  { code: 'OWNERSHIP', title: 'Ответственность за результат' },
  { code: 'MENTORING', title: 'Наставничество' },
  { code: 'TIME_MANAGEMENT', title: 'Планирование времени' },
  { code: 'CRITICAL_THINKING', title: 'Критическое мышление' },
  { code: 'SELF_LEARNING', title: 'Самостоятельное обучение' },
  { code: 'PUBLIC_SPEAKING', title: 'Публичные выступления' },
  { code: 'CONFLICT_RESOLUTION', title: 'Разрешение конфликтов' },
  { code: 'STRESS_RESISTANCE', title: 'Работа в сжатые сроки' },
];

export const TIMEZONES: CodeTitle[] = [
  { code: 'Europe/Kaliningrad', title: 'Калининград (UTC+2)' },
  { code: 'Europe/Moscow', title: 'Москва (UTC+3)' },
  { code: 'Europe/Samara', title: 'Самара (UTC+4)' },
  { code: 'Asia/Yekaterinburg', title: 'Екатеринбург (UTC+5)' },
  { code: 'Asia/Omsk', title: 'Омск (UTC+6)' },
  { code: 'Asia/Novosibirsk', title: 'Новосибирск (UTC+7)' },
  { code: 'Asia/Krasnoyarsk', title: 'Красноярск (UTC+7)' },
  { code: 'Asia/Irkutsk', title: 'Иркутск (UTC+8)' },
  { code: 'Asia/Yakutsk', title: 'Якутск (UTC+9)' },
  { code: 'Asia/Vladivostok', title: 'Владивосток (UTC+10)' },
  { code: 'Asia/Magadan', title: 'Магадан (UTC+11)' },
  { code: 'Asia/Kamchatka', title: 'Камчатка (UTC+12)' },
];

const skillIndex = new Map(SKILLS.map((skill) => [skill.code, skill]));
const groupIndex = new Map(COMPETENCY_GROUPS.map((group) => [group.code, group]));
const specializationIndex = new Map(SPECIALIZATIONS.map((spec) => [spec.code, spec]));

export const getSkill = (code: string) => skillIndex.get(code);
export const isKnownSkill = (code: string) => skillIndex.has(code);
export const getGroup = (code: string) => groupIndex.get(code);
export const getSpecialization = (code: string) => specializationIndex.get(code as SpecializationCode);
export const isSpecializationCode = (code: unknown): code is SpecializationCode =>
  typeof code === 'string' && specializationIndex.has(code as SpecializationCode);
export const isGradeCode = (code: unknown): code is GradeCode =>
  typeof code === 'string' && (GRADE_CODES as string[]).includes(code);
export const groupsOf = (specialization: SpecializationCode) =>
  COMPETENCY_GROUPS.filter((group) => group.specialization === specialization).sort((a, b) => a.sortOrder - b.sortOrder);
export const skillTitle = (code: string) => skillIndex.get(code)?.title ?? code;
export const isKnownCode = (list: CodeTitle[], code: string) => list.some((item) => item.code === code);
export const titleOf = (list: CodeTitle[], code: string) => list.find((item) => item.code === code)?.title ?? code;

export const GRADE_TITLES: Record<GradeCode, string> = { JUNIOR: 'Junior', MIDDLE: 'Middle', SENIOR: 'Senior' };
