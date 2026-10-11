import Image from 'next/image';
import { redirect } from 'next/navigation';
import { PublicFooter, PublicHeader } from '@/components/layout/public-header';
import { RoleActions } from '@/components/landing/role-actions';
import { getMe } from '@/lib/api/server';

const steps = [
  { title: 'Профиль и специализация', text: 'Расскажите об опыте, выберите направление и уровень, который хотите подтвердить.' },
  { title: 'Проверка навыков', text: 'Пройдите тест на выбранный грейд. В подборку попадёт подтверждённый результат, а не самооценка.' },
  { title: 'Приглашение от компании', text: 'Работодатель отправит условия и зарплатную вилку. Примите предложение, когда будете готовы к разговору.' },
];
const questions = [
  { title: 'Когда работодатель увидит мои контакты?', text: 'После принятия приглашения или вашего отклика на вакансию. До этого компания видит обезличенный профиль: специализацию, подтверждённый грейд и навыки. Публикация профиля требует отдельного согласия в настройках.' },
  { title: 'Можно ли зарегистрироваться без истории ФСП?', text: 'Да. Достижения ФСП дополняют профиль, но не заменяют тестирование и не обязательны для участия в подборе.' },
  { title: 'Что будет, если я не пройду тест?', text: 'Ваш текущий грейд не понизится. Можно пройти тест на уровень ниже. Повторное тестирование ограничено по времени; доступные попытки и сроки указаны в кабинете.' },
];

export default async function HomePage() {
  const me = await getMe();
  if (me) redirect(me.user.role === 'CANDIDATE' ? '/candidate' : '/employer');

  return (
    <div className="bg-surface">
      <PublicHeader />
      <main id="main">
        <section className="mx-auto max-w-6xl px-4 pb-10 pt-12 sm:px-6 sm:pb-12 sm:pt-20 lg:pt-24">
          <div className="grid gap-10 lg:grid-cols-[1.45fr_1fr] lg:gap-20">
            <div>
              <p className="mb-6 flex items-center gap-3 font-brand text-xs text-muted">
                <span className="h-2 w-2 bg-brand-500" aria-hidden />
                Платформа подбора ИТ-специалистов
              </p>
              <h1 className="landing-title text-[36px] min-[380px]:text-[44px] font-semibold leading-[1.04] tracking-[-0.045em] sm:text-[64px] lg:text-[76px]">
                Работодатель<br /><span className="text-brand-500">ищет вас.</span>
              </h1>
              <p className="mt-7 max-w-md text-lg leading-relaxed text-ink-soft">
                Подтвердите навыки и получайте приглашения от компаний. Зарплата и условия известны до первого разговора.
              </p>
            </div>
            <div className="lg:pt-4">
              <RoleActions />
            </div>
          </div>
          <div className="mt-12 flex flex-wrap items-center gap-x-8 gap-y-3 border-t border-line pt-5 text-sm sm:mt-16">
            <span className="font-brand text-xs text-muted">Направления</span>
            <span>Frontend</span><span>Backend</span><span>ML</span><span>Manual QA</span>
            <span className="text-muted sm:ml-auto">Junior / Middle / Senior</span>
          </div>
        </section>

        <section id="how-it-works" className="border-y border-line bg-canvas/50">
          <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
            <div className="grid gap-6 md:grid-cols-[1fr_2fr] md:gap-12">
              <h2 className="text-2xl font-medium leading-tight">От профиля<br />к предложению</h2>
              <ol className="divide-y divide-line">
                {steps.map((step, index) => (
                  <li key={step.title} className="grid grid-cols-[28px_1fr] gap-4 py-5 first:pt-0 last:pb-0 sm:grid-cols-[48px_1fr]">
                    <span className="pt-1 font-brand text-xs text-brand-500">0{index + 1}</span>
                    <div>
                      <h3 className="text-lg font-semibold">{step.title}</h3>
                      <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-muted">{step.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 sm:py-16 md:grid-cols-2 md:gap-16">
          <div>
            <p className="mb-4 font-brand text-xs text-brand-700">Федерация спортивного программирования</p>
            <h2 className="max-w-md text-3xl font-medium leading-tight">Достижения ФСП<br />в вашем профиле</h2>
            <p className="mt-5 max-w-md text-base leading-relaxed text-muted">Результаты соревнований — дополнительный сигнал для работодателя. Привяжите ФСП ID в кабинете, чтобы добавить достижения к подтверждённым навыкам.</p>
            <p className="mt-4 max-w-md text-sm text-muted">Участие в соревнованиях не обязательно: начать можно с опроса и теста.</p>
          </div>
          <figure>
            <Image src="/brand/fsp-event.jpeg" alt="Стенд Федерации спортивного программирования на мероприятии" width={1440} height={734} sizes="(max-width: 768px) 100vw, 50vw" className="h-auto w-full" />
            <figcaption className="mt-3 text-xs text-muted">ФСП. Фотография из материалов Федерации.</figcaption>
          </figure>
        </section>

        <section className="mx-auto grid max-w-6xl gap-6 border-t border-line px-4 py-12 sm:px-6 sm:py-16 md:grid-cols-[1fr_2fr] md:gap-12">
          <h2 className="text-2xl font-medium">Перед регистрацией</h2>
          <div className="divide-y divide-line border-y border-line">
            {questions.map((question) => (
              <details key={question.title} className="group py-5">
                <summary className="flex cursor-pointer list-none items-start justify-between gap-4 text-base font-medium [&::-webkit-details-marker]:hidden">
                  {question.title}
                  <span aria-hidden className="font-brand text-brand-500 group-open:hidden">+</span>
                  <span aria-hidden className="hidden font-brand text-brand-500 group-open:inline">−</span>
                </summary>
                <p className="mt-3 max-w-xl pr-5 text-[15px] leading-relaxed text-muted">{question.text}</p>
              </details>
            ))}
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
