'use client';

import { useId, useState } from 'react';
import clsx from 'clsx';

const journeys = {
  candidate: {
    label: 'Кандидату',
    title: 'От профиля к предложению',
    steps: [
      { title: 'Профиль и специализация', text: 'Расскажите об опыте, выберите направление и уровень, который хотите подтвердить.' },
      { title: 'Проверка навыков', text: 'Пройдите тест на выбранный грейд. В подборку попадёт подтверждённый результат, а не самооценка.' },
      { title: 'Приглашение от компании', text: 'Получите условия и зарплатную вилку. Примите предложение, когда будете готовы к разговору.' },
    ],
    note: 'Контакты скрыты до принятия приглашения или вашего отклика. Публикацией профиля вы управляете в настройках.',
  },
  employer: {
    label: 'Работодателю',
    title: 'От потребности к кандидату',
    steps: [
      { title: 'Профиль компании и потребность', text: 'Опишите команду, специализацию и грейды. Укажите зарплату, обязательные навыки и желательные требования.' },
      { title: 'Подборка с объяснениями', text: 'Сравните подтверждённые навыки, результаты тестов и достижения ФСП. Посмотрите, какие требования совпали.' },
      { title: 'Приглашение с условиями', text: 'Направьте предложение выбранному кандидату. Публиковать вакансию для этого не обязательно.' },
    ],
    note: 'Контакты кандидата открываются после принятия приглашения. Статусы предложений доступны в вашем кабинете.',
  },
} as const;

export function RoleJourney() {
  const [role, setRole] = useState<keyof typeof journeys>('candidate');
  const id = useId();
  const journey = journeys[role];
  return (
    <div className="grid gap-8 md:grid-cols-[1fr_2fr] md:gap-12">
      <div>
        <p className="mb-4 font-brand text-xs text-muted">Как устроен подбор</p>
        <div className="inline-flex gap-1 rounded-lg border border-line bg-surface p-1" role="group" aria-label="Путь пользователя">
          {(Object.keys(journeys) as Array<keyof typeof journeys>).map((key) => (
            <button key={key} type="button" aria-pressed={role === key} aria-controls={id} onClick={() => setRole(key)} className={clsx('min-h-11 rounded-md px-3 text-sm font-medium transition-colors', role === key ? 'bg-ink text-white' : 'text-muted hover:bg-brand-50 hover:text-brand-700')}>
              {journeys[key].label}
            </button>
          ))}
        </div>
        <h2 className="mt-6 max-w-xs text-2xl font-medium leading-tight">{journey.title}</h2>
      </div>
      <div id={id}>
        <ol className="divide-y divide-line">
          {journey.steps.map((step, index) => (
            <li key={step.title} className="grid grid-cols-[28px_1fr] gap-4 py-5 first:pt-0 last:pb-0 sm:grid-cols-[48px_1fr]">
              <span className="pt-1 font-brand text-xs text-brand-500">0{index + 1}</span>
              <div>
                <h3 className="text-lg font-semibold">{step.title}</h3>
                <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-muted">{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-6 border-l-2 border-brand-500 pl-4 text-sm leading-relaxed text-muted">{journey.note}</p>
      </div>
    </div>
  );
}
