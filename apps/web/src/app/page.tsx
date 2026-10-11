import Image from 'next/image';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PublicFooter, PublicHeader } from '@/components/layout/public-header';
import { RoleActions } from '@/components/landing/role-actions';
import { getMe } from '@/lib/api/server';

const steps = [
  { title: 'Подтвердите навыки', text: 'Заполните профиль, выберите специализацию и предполагаемый грейд. Пройдите тест: работодателю виден подтверждённый уровень.' },
  { title: 'Попадите в подборку', text: 'Работодатель описывает потребность и находит специалистов по категории и навыкам. Для каждого совпадения есть объяснение.' },
  { title: 'Получите предложение', text: 'Компания первой отправляет приглашение с зарплатой в рублях. Вы видите условия и решаете, принимать ли предложение и раскрывать контакты.' },
];

export default async function HomePage() {
  const me = await getMe();
  if (me) redirect(me.user.role === 'CANDIDATE' ? '/candidate' : '/employer');

  return (
    <>
      <PublicHeader />
      <main id="main">
        <section className="brand-hero">
          <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
            <div className="brand-hero-frame grid gap-8 p-5 sm:p-8 lg:grid-cols-[1.3fr_0.7fr] lg:p-10">
              <div className="relative z-10">
                <p className="brand-eyebrow mb-6 text-white/70">ФСП / Карьера в ИТ</p>
                <h1 className="max-w-2xl text-[28px] font-medium leading-[1.15] sm:text-[42px] lg:text-[46px]">
                  Ваши навыки.<br />Ваш следующий<br /><span className="text-brand-300">карьерный шаг.</span>
                </h1>
                <p className="mt-6 max-w-xl text-base leading-relaxed text-white/80">
                  Подтвердите свой уровень — и работодатель найдёт вас сам. Предложение с зарплатой до начала общения. Контакты — только с вашего согласия.
                </p>
                <a href="#start" className="mt-7 inline-flex min-h-12 items-center gap-4 rounded-lg bg-brand-500 px-5 font-medium text-white hover:bg-brand-600">
                  Выбрать свой путь <span aria-hidden>↓</span>
                </a>
              </div>
              <div className="relative flex min-h-52 items-center justify-center lg:min-h-96" aria-hidden="true">
                <Image src="/brand/wireframe-face.png" alt="" width={332} height={313} className="relative z-10 w-52 max-w-full sm:w-64 lg:w-full" preload />
                <Image src="/brand/brand-path.png" alt="" width={385} height={313} className="absolute bottom-0 right-0 h-auto w-full opacity-60" />
                <span className="absolute right-0 top-0 font-brand text-xs text-white/50">&lt; skills / verified &gt;</span>
              </div>
            </div>
            <div className="flex flex-wrap justify-between gap-3 pt-6 font-brand text-xs text-white/65 sm:text-sm">
              <span>Frontend / Backend / ML / Manual QA</span>
              <span>Junior → Middle → Senior</span>
            </div>
          </div>
        </section>

        <section id="start" className="mx-auto max-w-6xl scroll-mt-6 px-4 py-12 sm:px-6 sm:py-16">
          <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="brand-eyebrow mb-3 text-brand-700">01 / Начать</p>
              <h2 className="text-2xl font-medium sm:text-3xl">Две роли. Одна точка встречи.</h2>
            </div>
            <p className="text-sm text-muted">Уже с нами? <Link href="/login" className="font-medium text-brand-700 underline underline-offset-4">Войти</Link></p>
          </div>
          <RoleActions />
        </section>

        <section className="border-y border-line bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
            <p className="brand-eyebrow mb-3 text-brand-700">02 / Обратный подбор</p>
            <h2 className="max-w-3xl text-2xl font-medium sm:text-3xl">Работодатель делает первый шаг</h2>
            <ol className="mt-8 grid gap-4 md:grid-cols-3">
              {steps.map((step, index) => (
                <li key={step.title} className="card brand-step p-6">
                  <span className="font-brand text-4xl font-medium text-brand-500">0{index + 1}</span>
                  <h3 className="mt-5 text-lg font-bold">{step.title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-ink-soft">{step.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto grid max-w-6xl items-center gap-8 px-4 py-12 sm:px-6 sm:py-16 md:grid-cols-2">
          <div className="brand-line bg-surface p-6 sm:p-8">
            <Image src="/brand/russia-map.png" alt="Карта России в фирменном синем цвете ФСП" width={471} height={312} className="h-auto w-full" />
          </div>
          <div>
            <p className="brand-eyebrow mb-3 text-brand-700">03 / Профиль и доверие</p>
            <h2 className="text-2xl font-medium sm:text-3xl">Опыт ФСП — часть вашего профиля</h2>
            <p className="mt-5 text-sm leading-relaxed text-ink-soft">Достижения в спортивном программировании дополняют подтверждённые навыки. Истории ФСП пока нет? Вы всё равно можете пройти тест и получать предложения.</p>
            <div className="mt-6 border-l-2 border-brand-500 pl-4">
              <h3 className="text-base font-bold">Вы управляете видимостью</h3>
              <p className="mt-2 text-sm text-muted">До принятия приглашения работодатель видит обезличенный профиль. Публикация профиля — с отдельного согласия в настройках.</p>
            </div>
          </div>
        </section>
      </main>
      <PublicFooter />
    </>
  );
}
