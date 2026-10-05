import Image from 'next/image';
import { redirect } from 'next/navigation';
import { PublicFooter, PublicHeader } from '@/components/layout/public-header';
import { LinkButton } from '@/components/ui/button';
import { getMe } from '@/lib/api/server';

const steps = [
  { title: 'Подтверждение навыков', text: 'Кандидат проходит опрос и тест на заявленный грейд. В выдачу попадает только грейд, подтверждённый тестом.' },
  { title: 'Подбор работодателем', text: 'Компания описывает потребность и получает ранжированную подборку с понятным объяснением, почему кандидат подходит.' },
  { title: 'Предложение с зарплатой', text: 'Работодатель первым отправляет предложение с вилкой. Кандидат видит условия до общения и сам решает, раскрывать ли контакты.' },
];

export default async function HomePage() {
  const me = await getMe();
  if (me) redirect(me.user.role === 'CANDIDATE' ? '/candidate' : '/employer');

  return (
    <>
      <PublicHeader />
      <main id="main">
        <section className="relative overflow-hidden bg-surface">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:py-20">
            <div>
              <p className="mb-3 font-brand text-sm font-medium text-brand-600">Федерация спортивного программирования</p>
              <h1 className="text-3xl font-bold leading-tight sm:text-[42px]">
                Работодатель находит вас сам — по подтверждённым навыкам
              </h1>
              <p className="mt-5 max-w-xl text-lg text-ink-soft">
                Обратный подбор ИТ-специалистов: вместо откликов вслепую — проверенный грейд, прозрачная подборка и предложение с
                зарплатой до начала общения.
              </p>
              <div className="mt-8 grid gap-3 sm:grid-cols-2">
                <LinkButton href="/register?role=CANDIDATE" size="lg" className="w-full">
                  Я ищу работу
                </LinkButton>
                <LinkButton href="/register?role=EMPLOYER" size="lg" variant="outline" className="w-full">
                  Я ищу специалиста
                </LinkButton>
              </div>
              <p className="mt-4 text-sm text-muted">
                Уже зарегистрированы? <a className="font-medium text-brand-600 underline-offset-4 hover:underline" href="/login">Войти</a>
              </p>
            </div>
            <div className="brand-line relative hidden p-8 lg:block">
              <Image src="/brand/russia-map.png" alt="Карта России в цветах ФСП" width={466} height={320} className="h-auto w-full" priority />
              <p className="mt-4 text-sm text-muted">Frontend · Backend · ML · Manual QA — Junior, Middle и Senior</p>
            </div>
          </div>
        </section>
        <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <h2 className="text-2xl font-bold">Как это работает</h2>
          <ol className="mt-6 grid gap-4 md:grid-cols-3">
            {steps.map((step, index) => (
              <li key={step.title} className="card p-6">
                <span className="font-brand text-3xl font-bold text-brand-500">0{index + 1}</span>
                <h3 className="mt-3 text-lg font-bold">{step.title}</h3>
                <p className="mt-2 text-ink-soft">{step.text}</p>
              </li>
            ))}
          </ol>
          <div className="card mt-6 grid gap-4 p-6 md:grid-cols-2">
            <div>
              <h3 className="font-bold">Для кандидата</h3>
              <p className="mt-1 text-ink-soft">
                До принятия приглашения работодатель видит только обезличенную карточку: специализацию, подтверждённый грейд, баллы и
                структурированные навыки — без ФИО и контактов.
              </p>
            </div>
            <div>
              <h3 className="font-bold">Для работодателя</h3>
              <p className="mt-1 text-ink-soft">
                Подборка строится по категориям, подтверждённым тестированием. Достижения ФСП дают ограниченный бонус, но не заменяют
                обязательных требований.
              </p>
            </div>
          </div>
        </section>
      </main>
      <PublicFooter />
    </>
  );
}
