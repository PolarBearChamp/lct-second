// Генерирует синтетическое резюме для демонстрации и E2E: `pnpm --filter @fsp/api exec tsx scripts/dev/make-resume-fixture.ts <файл.pdf>`.
// Все данные вымышленные.
import { writeFileSync } from 'node:fs';
import { makeResumePdf } from '../../test/helpers/resume-pdf';

export const DEMO_RESUME_LINES = [
  'Соколова Марина Игоревна',
  'Frontend-разработчик (Middle)',
  '',
  'Контакты',
  'Email: marina.sokolova@demo-resume.example',
  'Телефон: +7 (921) 555-01-23',
  'Telegram: @marina_front',
  'GitHub: https://github.com/marina-sokolova-demo',
  'Город: Санкт-Петербург',
  '',
  'О себе',
  'Пять лет разрабатываю интерфейсы для финтеха и интернет-магазинов, люблю командную работу и ответственность за результат.',
  '',
  'Опыт работы',
  'Сентябрь 2021 – настоящее время  ООО «Цифровой банк»',
  'Личный кабинет клиента на React и TypeScript, тесты интерфейса, наставничество джуниоров.',
  'Июнь 2019 – август 2021  ООО «Магазин у дома»',
  'Витрина интернет-магазина на Vue.js, оптимизация загрузки.',
  '',
  'Образование',
  'Санкт-Петербургский государственный университет, 2014 – 2019',
  '',
  'Навыки',
  'JavaScript — 7 лет, TypeScript (4 года), React, Redux, Next.js, HTML/CSS, Webpack, Git, REST API',
];

const target = process.argv[2];
if (target) {
  makeResumePdf(DEMO_RESUME_LINES).then((pdf) => {
    writeFileSync(target, pdf);
    console.log(`Записано: ${target} (${pdf.length} байт)`);
  });
}
