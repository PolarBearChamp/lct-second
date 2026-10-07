import { parseResume } from './parse';

const NOW = new Date('2026-10-07T12:00:00Z');

const BACKEND = `
Иванов Пётр Сергеевич
Backend-разработчик (Middle)
Контакты
Email: petr.ivanov@example.com
Телефон: +7 (912) 345-67-89
Telegram: @petr_ivanov
GitHub: https://github.com/petrivanov
Город: Казань

Опыт работы
Июнь 2020 – настоящее время  ООО «Платёжные решения»
Разработчик API платежей, участвовал в наставничестве джуниоров. Финтех, банковские интеграции.
Март 2018 – май 2020  АО «Магазин»
Разработка REST API на Java и Spring

Образование
Казанский федеральный университет, 2013 – 2018

Навыки
Java — 6 лет, Spring Boot, PostgreSQL (4 года), SQL, Docker, Kafka, Git, Linux
Командная работа, ответственность
`;

describe('автораспознавание резюме', () => {
  it('контакты: email, телефон (нормализуется), мессенджер, ссылки, город и часовой пояс', () => {
    const r = parseResume(BACKEND, NOW);
    expect(r.contactEmail).toBe('petr.ivanov@example.com');
    expect(r.phone).toBe('+7 912 345-67-89');
    expect(r.messenger).toBe('@petr_ivanov');
    expect(r.externalLinks).toEqual(['https://github.com/petrivanov']);
    expect(r.city).toBe('Казань');
    expect(r.timezone).toBe('Europe/Moscow');
  });

  it('ФИО берётся из верхней части, а не из названия должности', () => {
    expect(parseResume(BACKEND, NOW).fullName).toBe('Иванов Пётр Сергеевич');
    expect(parseResume('Резюме\nFrontend Developer\nАнна Смирнова\nМосква', NOW).fullName).toBe('Анна Смирнова');
    expect(parseResume('ФИО: Орлова Мария\nСтек: React', NOW)).toMatchObject({ fullName: 'Орлова Мария' });
    expect(parseResume('ПЕТРОВ АЛЕКСЕЙ\nBackend Developer', NOW).fullName).toBe('Петров Алексей');
    expect(parseResume('Backend Developer\nSenior Engineer', NOW).fullName).toBeNull();
  });

  it('стаж по периодам работы: объединяет пересечения и не считает учёбу', () => {
    const r = parseResume(BACKEND, NOW);
    // Март 2018 – май 2020 = 27 мес., июнь 2020 – октябрь 2026 = 77 мес.: подряд, итого 104.
    expect(r.experienceMonths).toBe(104);
    expect(r.confidence.experienceMonths).toBe('MEDIUM');
    const overlapping = parseResume('Опыт работы\n01.2020 – 12.2022 Компания А\n06.2021 – 06.2023 Компания Б', NOW);
    expect(overlapping.experienceMonths).toBe(42); // 01.2020–06.2023, без удвоения параллельных мест
  });

  it('явная фраза о стаже приоритетнее периодов', () => {
    expect(parseResume('Иванов Иван\nОпыт работы: 3 года 4 месяца', NOW)).toMatchObject({ experienceMonths: 40, confidence: expect.objectContaining({ experienceMonths: 'HIGH' }) });
    expect(parseResume('Иванов Иван\nОбщий стаж — 5 лет', NOW).experienceMonths).toBe(60);
    expect(parseResume('Ivan Petrov\nExperience: 7+ years in backend', NOW).experienceMonths).toBe(84);
  });

  it('периоды без месяцев помечаются как приблизительные', () => {
    const r = parseResume('Опыт работы\n2019 – 2022 Компания', NOW);
    expect(r.experienceMonths).toBe(42);
    expect(r.confidence.experienceMonths).toBe('LOW');
    expect(r.warnings.join(' ')).toMatch(/Стаж рассчитан/);
  });

  it('навыки сопоставляются со справочником, длительность — из той же строки; короткие алиасы — только в разделе навыков', () => {
    const r = parseResume(BACKEND, NOW);
    const byCode = Object.fromEntries(r.skills.map((s) => [s.code, s]));
    expect(byCode.java).toMatchObject({ title: 'Java', months: 72 });
    expect(byCode.postgresql.months).toBe(48);
    for (const code of ['spring', 'sql', 'docker', 'kafka', 'git', 'linux', 'rest-api']) expect(byCode[code]).toBeDefined();
    // «Java» не должна давать JavaScript.
    expect(byCode.javascript).toBeUndefined();
    const short = parseResume('Навыки\nJS, TS, Go', NOW);
    expect(short.skills.map((s) => s.code).sort()).toEqual(['go', 'javascript', 'typescript']);
    const prose = parseResume('Иванов Иван\nЯ люблю go-карты и ts-файлы, но в js не пишу', NOW);
    expect(prose.skills).toEqual([]);
  });

  it('специальные написания: C#, Node.js, Next.js, REST', () => {
    const r = parseResume('Навыки\nC#, .NET, Node.js, Next.js, REST API, scikit-learn', NOW);
    const codes = r.skills.map((s) => s.code);
    expect(codes).toEqual(expect.arrayContaining(['csharp', 'nodejs', 'nextjs', 'rest-api', 'scikit-learn']));
  });

  it('роли, soft skills и отрасли определяются по словарям справочников', () => {
    const r = parseResume(BACKEND, NOW);
    expect(r.teamRoles).toEqual(expect.arrayContaining(['DEVELOPER', 'MENTOR']));
    expect(r.softSkills).toEqual(expect.arrayContaining(['TEAMWORK', 'OWNERSHIP', 'MENTORING']));
    expect(r.industries).toContain('FINTECH');
  });

  it('специализация и грейд: по заголовку; без явного уровня грейд оценивается по стажу как предположение', () => {
    const r = parseResume(BACKEND, NOW);
    expect(r.activeSpecialization).toBe('BACKEND');
    expect(r.declaredGrade).toBe('MIDDLE');
    expect(r.confidence.declaredGrade).toBe('MEDIUM');
    const guess = parseResume('Сидоров Олег\nQA-инженер\nОпыт работы: 1 год\nТест-дизайн, баг-репорты, Postman, Jira', NOW);
    expect(guess.activeSpecialization).toBe('MANUAL_QA');
    expect(guess.declaredGrade).toBe('JUNIOR');
    expect(guess.confidence.declaredGrade).toBe('LOW');
    expect(guess.warnings.join(' ')).toMatch(/предположение/);
    expect(parseResume('Петров Пётр\nSenior Frontend Developer\nReact, TypeScript, Redux, Next.js', NOW)).toMatchObject({ activeSpecialization: 'FRONTEND', declaredGrade: 'SENIOR' });
  });

  it('пустой, мусорный и нетекстовый ввод даёт пустые предложения и предупреждение, а не ошибку', () => {
    for (const input of ['', '   \n\n  ', '!!! ??? ###', '12345 67890']) {
      const r = parseResume(input, NOW);
      expect(r.fullName).toBeNull();
      expect(r.skills).toEqual([]);
      expect(r.contactEmail).toBeNull();
      expect(r.warnings.length).toBeGreaterThan(0);
    }
  });

  it('значения подходят под ограничения профиля (телефон, список ссылок, число навыков)', () => {
    const r = parseResume(`${BACKEND}\nhttps://a.example/1 https://b.example/2 https://c.example/3 https://d.example/4 https://e.example/5 https://f.example/6`, NOW);
    expect(r.externalLinks.length).toBeLessThanOrEqual(5);
    expect(r.phone).toMatch(/^\+?[0-9()\-\s]{7,20}$/);
    expect(r.skills.length).toBeLessThanOrEqual(40);
    expect(r.experienceDescription?.length ?? 0).toBeLessThanOrEqual(3000);
  });

  it('email не принимается за мессенджер, t.me — не ссылка', () => {
    const r = parseResume('Иванов Иван\nid@example.com\nhttps://t.me/ivanov_dev', NOW);
    expect(r.contactEmail).toBe('id@example.com');
    expect(r.messenger).toBe('@ivanov_dev');
    expect(r.externalLinks).toEqual([]);
  });
});
