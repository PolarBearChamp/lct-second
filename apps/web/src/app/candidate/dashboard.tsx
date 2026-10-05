'use client';

import { GRADE_LABELS, SPECIALIZATION_LABELS } from '@fsp/contracts';
import Link from 'next/link';
import { OnboardingSteps, STEP_LINKS } from '@/components/candidate/onboarding-steps';
import { useMe } from '@/components/layout/me-context';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { LinkButton } from '@/components/ui/button';
import { Card, CardHeader, PageHeader } from '@/components/ui/card';
import { ErrorState, Spinner } from '@/components/ui/states';
import { formatDateTime } from '@/lib/format';
import { useEligibility } from '@/lib/queries';

const ISSUE_LINKS: Record<string, string> = {
  PROFILE_INCOMPLETE: '/candidate/profile',
  NO_CONTACT_CHANNEL: '/candidate/settings',
  NO_PUBLICATION_CONSENT: '/candidate/settings',
  NOT_DISCOVERABLE: '/candidate/settings',
  PAUSED: '/candidate/settings',
  NO_CONFIRMED_QUALIFICATION: '/candidate/assessments',
};

export function CandidateDashboard() {
  const me = useMe();
  const candidate = me.candidate!;
  const eligibility = useEligibility(candidate.activeSpecialization);

  return (
    <>
      <PageHeader
        eyebrow={`Кандидат ${candidate.alias}`}
        title="Обзор"
        description="Прогресс онбординга, подтверждённая категория и статус видимости профиля для работодателей."
      />

      <section aria-labelledby="onboarding-title" className="mb-6">
        <h2 id="onboarding-title" className="sr-only">
          Онбординг
        </h2>
        <OnboardingSteps candidate={candidate} />
        {candidate.nextStep ? (
          <div className="mt-4">
            <LinkButton href={STEP_LINKS[candidate.nextStep].href}>{STEP_LINKS[candidate.nextStep].action}</LinkButton>
          </div>
        ) : null}
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Категория" description="Работодатели видят только грейд, подтверждённый тестированием." />
          {candidate.activeSpecialization ? (
            <div className="space-y-3">
              <div className="text-lg font-semibold">{SPECIALIZATION_LABELS[candidate.activeSpecialization]}</div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted">Грейд по результатам тестирования:</span>
                {candidate.confirmedGrade ? (
                  <Badge tone="success">{GRADE_LABELS[candidate.confirmedGrade]}</Badge>
                ) : (
                  <Badge tone="warning">ещё не подтверждён</Badge>
                )}
              </div>
              {candidate.declaredGrade ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-muted">Заявлено вами:</span>
                  <Badge>{GRADE_LABELS[candidate.declaredGrade]}</Badge>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-muted">
              Специализация не выбрана. <Link className="font-medium text-brand-600 hover:underline" href="/candidate/survey">Пройдите опрос</Link>, чтобы выбрать направление.
            </p>
          )}
        </Card>

        <Card>
          <CardHeader title="Видимость для работодателей" />
          {candidate.discoverable ? (
            <Alert tone="success" title="Профиль виден работодателям">
              Компании видят обезличенную карточку. Контакты раскрываются только той компании, чьё приглашение вы примете.
            </Alert>
          ) : (
            <>
              <p className="mb-3 text-sm text-muted">Профиль попадёт в поиск, когда выполнены все условия:</p>
              <ul className="space-y-2">
                {candidate.discoverabilityIssues.map((issue) => (
                  <li key={issue.code} className="flex items-start justify-between gap-3 rounded-lg border border-line px-3 py-2">
                    <span className="text-[15px]">{issue.message}</span>
                    {ISSUE_LINKS[issue.code] ? (
                      <Link className="shrink-0 text-sm font-medium text-brand-600 hover:underline" href={ISSUE_LINKS[issue.code]}>
                        Исправить
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Тестирование"
            actions={
              <LinkButton href="/candidate/assessments" variant="outline" size="sm">
                Подробнее
              </LinkButton>
            }
          />
          {!candidate.activeSpecialization ? (
            <p className="text-muted">Сначала выберите специализацию.</p>
          ) : eligibility.isPending ? (
            <Spinner />
          ) : eligibility.isError ? (
            <ErrorState error={eligibility.error} onRetry={() => eligibility.refetch()} />
          ) : eligibility.data.activeAttempt ? (
            <Alert
              tone="brand"
              title="Есть незавершённая попытка"
              actions={<LinkButton href={`/candidate/assessments/${eligibility.data.activeAttempt.id}`}>Продолжить тест</LinkButton>}
            >
              Таймер идёт на сервере: попытка завершится {formatDateTime(eligibility.data.activeAttempt.expiresAt)}.
            </Alert>
          ) : (
            <ul className="space-y-2">
              {eligibility.data.grades.map((grade) => (
                <li key={grade.grade} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
                  <span className="font-medium">{GRADE_LABELS[grade.grade]}</span>
                  {grade.allowed ? (
                    <Badge tone="success">можно начать</Badge>
                  ) : (
                    <span className="text-sm text-muted">{grade.availableAt ? `доступно ${formatDateTime(grade.availableAt)}` : grade.message}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Приглашения" />
          {candidate.newInvitations > 0 ? (
            <Alert
              tone="brand"
              title={`Новых предложений: ${candidate.newInvitations}`}
              actions={<LinkButton href="/candidate/invitations">Открыть</LinkButton>}
            >
              Зарплата и условия видны до принятия. Контакты раскрываются только после вашего согласия.
            </Alert>
          ) : (
            <p className="text-muted">
              Новых приглашений нет. Работодатели находят кандидатов по подтверждённой категории — держите профиль актуальным.
            </p>
          )}
        </Card>
      </div>
    </>
  );
}
