/** Синтетические данные для демонстрации. Все имена вымышлены; совпадения с реальными людьми случайны. */

export const MALE_NAMES = ['Алексей', 'Борис', 'Виктор', 'Георгий', 'Дмитрий', 'Егор', 'Захар', 'Илья', 'Кирилл', 'Леонид', 'Максим', 'Никита', 'Олег', 'Павел', 'Роман', 'Сергей', 'Тимур', 'Фёдор', 'Артём', 'Владислав'];
export const FEMALE_NAMES = ['Анна', 'Вера', 'Дарья', 'Елена', 'Жанна', 'Ирина', 'Ксения', 'Лариса', 'Мария', 'Наталья', 'Ольга', 'Полина', 'Светлана', 'Татьяна', 'Юлия', 'Алиса', 'Варвара', 'Диана', 'Евгения', 'Софья'];
/** [мужская форма, женская форма] */
export const SURNAMES: Array<[string, string]> = [
  ['Ветров', 'Ветрова'], ['Громов', 'Громова'], ['Дубов', 'Дубова'], ['Ершов', 'Ершова'], ['Жуков', 'Жукова'], ['Зайцев', 'Зайцева'], ['Ильин', 'Ильина'], ['Калинин', 'Калинина'],
  ['Лебедев', 'Лебедева'], ['Мельников', 'Мельникова'], ['Назаров', 'Назарова'], ['Орлов', 'Орлова'], ['Павлов', 'Павлова'], ['Рябов', 'Рябова'], ['Соколов', 'Соколова'], ['Тихонов', 'Тихонова'],
  ['Уваров', 'Уварова'], ['Фролов', 'Фролова'], ['Хохлов', 'Хохлова'], ['Цветков', 'Цветкова'], ['Чернов', 'Чернова'], ['Шилов', 'Шилова'], ['Щербаков', 'Щербакова'], ['Яковлев', 'Яковлева'],
  ['Белов', 'Белова'], ['Воронин', 'Воронина'], ['Гусев', 'Гусева'], ['Денисов', 'Денисова'], ['Елисеев', 'Елисеева'], ['Журавлёв', 'Журавлёва'], ['Исаев', 'Исаева'], ['Князев', 'Князева'],
  ['Логинов', 'Логинова'], ['Морозов', 'Морозова'], ['Никитин', 'Никитина'], ['Осипов', 'Осипова'], ['Потапов', 'Потапова'], ['Русаков', 'Русакова'], ['Субботин', 'Субботина'], ['Титов', 'Титова'],
];

export const CITIES: Array<{ city: string; tz: string }> = [
  { city: 'Москва', tz: 'Europe/Moscow' },
  { city: 'Санкт-Петербург', tz: 'Europe/Moscow' },
  { city: 'Казань', tz: 'Europe/Moscow' },
  { city: 'Нижний Новгород', tz: 'Europe/Moscow' },
  { city: 'Самара', tz: 'Europe/Samara' },
  { city: 'Екатеринбург', tz: 'Asia/Yekaterinburg' },
  { city: 'Новосибирск', tz: 'Asia/Novosibirsk' },
  { city: 'Томск', tz: 'Asia/Novosibirsk' },
  { city: 'Краснодар', tz: 'Europe/Moscow' },
  { city: 'Пермь', tz: 'Asia/Yekaterinburg' },
];

export function personName(index: number, used: Set<string>, allowDuplicates = false): { full: string; female: boolean } {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const female = (index + attempt) % 2 === 1;
    const first = (female ? FEMALE_NAMES : MALE_NAMES)[(index * 7 + attempt * 3) % MALE_NAMES.length];
    const surname = SURNAMES[(index * 11 + Math.floor(index / 5) + attempt * 5) % SURNAMES.length][female ? 1 : 0];
    const full = `${first} ${surname}`;
    if (!used.has(full)) {
      used.add(full);
      return { full, female };
    }
  }
  if (allowDuplicates) {
    const female = index % 2 === 1;
    return { full: `${(female ? FEMALE_NAMES : MALE_NAMES)[index % MALE_NAMES.length]} ${SURNAMES[index % SURNAMES.length][female ? 1 : 0]}`, female };
  }
  throw new Error('Не удалось подобрать уникальное имя');
}

export const SELF_SKILLS: Record<string, string[]> = {
  FRONTEND: ['javascript', 'typescript', 'react', 'nextjs', 'vue', 'angular', 'redux', 'html-css', 'webpack-vite', 'web-accessibility', 'graphql', 'http', 'rest-api', 'git', 'docker', 'nodejs', 'state-management', 'async-js'],
  BACKEND: ['nodejs', 'nestjs', 'java', 'spring', 'go', 'csharp', 'kotlin', 'django', 'python', 'postgresql', 'sql', 'redis', 'mongodb', 'kafka', 'docker', 'kubernetes', 'linux', 'git', 'rest-api', 'http', 'transactions', 'concurrency', 'graphql'],
  ML_ENGINEER: ['python', 'pandas', 'numpy', 'scikit-learn', 'pytorch', 'tensorflow', 'gradient-boosting', 'mlflow', 'airflow', 'spark', 'nlp', 'computer-vision', 'docker', 'git', 'linux', 'data-preparation', 'ml-metrics', 'classification', 'model-validation'],
  MANUAL_QA: ['api-testing', 'mobile-testing', 'web-testing', 'test-management', 'jira', 'traffic-sniffing', 'sql', 'linux', 'git', 'test-design', 'boundary-testing', 'bug-reporting', 'requirements-analysis', 'test-prioritization', 'http'],
};

export const FOCUS_BY_SPEC: Record<string, string> = { FRONTEND: 'UI', BACKEND: 'SERVER', ML_ENGINEER: 'DATA', MANUAL_QA: 'QUALITY' };
export const TASKS_BY_SPEC: Record<string, string[]> = {
  FRONTEND: ['SPA', 'API'],
  BACKEND: ['API', 'DB'],
  ML_ENGINEER: ['ML_MODEL', 'DATA_PREP'],
  MANUAL_QA: ['TEST_CASES', 'BUG_REPORTS'],
};

export const INDUSTRY_CODES = ['FINTECH', 'ECOMMERCE', 'GOVTECH', 'EDTECH', 'HEALTHTECH', 'TELECOM', 'GAMEDEV', 'INDUSTRIAL', 'LOGISTICS', 'MEDIA', 'CYBERSECURITY', 'ANY'];
export const TEAM_ROLE_CODES = ['DEVELOPER', 'TESTER', 'DATA_SCIENTIST', 'TEAM_LEAD', 'TECH_LEAD', 'ARCHITECT', 'MENTOR', 'TEAM_CAPTAIN'];
export const SOFT_SKILL_CODES = ['COMMUNICATION', 'TEAMWORK', 'OWNERSHIP', 'MENTORING', 'TIME_MANAGEMENT', 'CRITICAL_THINKING', 'SELF_LEARNING', 'PUBLIC_SPEAKING', 'CONFLICT_RESOLUTION', 'STRESS_RESISTANCE'];

export const SALARY_BASE: Record<string, Record<string, number>> = {
  FRONTEND: { JUNIOR: 90_000, MIDDLE: 190_000, SENIOR: 320_000 },
  BACKEND: { JUNIOR: 100_000, MIDDLE: 210_000, SENIOR: 350_000 },
  ML_ENGINEER: { JUNIOR: 110_000, MIDDLE: 230_000, SENIOR: 380_000 },
  MANUAL_QA: { JUNIOR: 70_000, MIDDLE: 140_000, SENIOR: 230_000 },
};
export const EXPERIENCE_RANGE: Record<string, [number, number]> = { JUNIOR: [0, 22], MIDDLE: [24, 60], SENIOR: [66, 150] };

export const DESCRIPTIONS: Record<string, string[]> = {
  FRONTEND: ['Разрабатывал(а) интерфейсы личного кабинета и административной панели, оптимизировал загрузку страниц.', 'Строил(а) дизайн-систему и библиотеку компонентов, писал(а) тесты интерфейса.', 'Участвовал(а) в миграции клиентского приложения на TypeScript.'],
  BACKEND: ['Проектировал(а) HTTP API и схемы PostgreSQL для сервисов оплаты и заказов.', 'Занимался(ась) надёжностью очередей и идемпотентностью операций.', 'Поддерживал(а) сервисы авторизации, оптимизировал медленные SQL-запросы.'],
  ML_ENGINEER: ['Обучал(а) модели классификации и ранжирования, строил(а) пайплайны подготовки данных.', 'Настраивал(а) валидацию моделей и мониторинг качества в эксплуатации.', 'Готовил(а) признаки и проводил(а) эксперименты с градиентным бустингом.'],
  MANUAL_QA: ['Писал(а) тест-кейсы по требованиям, проводил(а) регрессионное тестирование веб-приложений.', 'Вёл(а) отчёты о дефектах, участвовал(а) в приёмке релизов.', 'Проверял(а) API через Postman и документировал(а) найденные ошибки.'],
};
