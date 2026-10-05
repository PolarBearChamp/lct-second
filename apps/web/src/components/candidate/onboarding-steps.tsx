'use client';

import type { MeResponse, OnboardingStepKey } from '@fsp/contracts';
import clsx from 'clsx';
import Link from 'next/link';

export const STEP_LINKS: Record<OnboardingStepKey, { href: string; action: string }> = {
  EMAIL: { href: '/verify-email', action: 'Подтвердить email' },
  PROFILE: { href: '/candidate/profile', action: 'Заполнить профиль' },
  SURVEY: { href: '/candidate/survey', action: 'Пройти опрос и выбрать специализацию' },
  ASSESSMENT: { href: '/candidate/assessments', action: 'Пройти тестирование' },
  PUBLICATION: { href: '/candidate/settings', action: 'Настроить публикацию профиля' },
};

/** Прогресс онбординга: email → профиль → опрос и специализация → тест → публикация. */
export function OnboardingSteps({ candidate }: { candidate: NonNullable<MeResponse['candidate']> }) {
  return (
    <ol className="grid gap-2 sm:grid-cols-5" aria-label="Шаги онбординга">
      {candidate.onboarding.map((step, index) => {
        const current = step.key === candidate.nextStep;
        return (
          <li key={step.key}>
            <Link
              href={STEP_LINKS[step.key].href}
              aria-current={current ? 'step' : undefined}
              className={clsx(
                'flex h-full flex-col gap-1 rounded-xl border px-3 py-3 transition-colors',
                step.done && 'border-[#abefc6] bg-success-50',
                current && 'border-brand-500 bg-brand-50 ring-2 ring-brand-100',
                !step.done && !current && 'border-line bg-surface hover:border-line-strong',
              )}
            >
              <span className="flex items-center gap-2 text-xs font-medium text-muted">
                <span
                  className={clsx(
                    'flex h-5 w-5 items-center justify-center rounded-full font-brand text-[11px] font-bold',
                    step.done ? 'bg-success-600 text-white' : current ? 'bg-brand-500 text-white' : 'bg-canvas text-ink-soft',
                  )}
                  aria-hidden
                >
                  {step.done ? '✓' : index + 1}
                </span>
                {step.done ? 'Готово' : current ? 'Следующий шаг' : 'Ожидает'}
              </span>
              <span className="text-sm font-semibold leading-snug">{step.title}</span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
