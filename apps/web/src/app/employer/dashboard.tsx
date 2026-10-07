'use client';

import { GRADE_LABELS, NEED_STATUS_LABELS } from '@fsp/contracts';
import Link from 'next/link';
import { InvitationStatusBadge } from '@/components/invitations/invitation-status';
import { useMe } from '@/components/layout/me-context';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { LinkButton } from '@/components/ui/button';
import { Card, CardHeader, PageHeader } from '@/components/ui/card';
import { ErrorState, Spinner } from '@/components/ui/states';
import { formatDate, formatSalaryRange } from '@/lib/format';
import { useEmployerInvitations, useNeeds } from '@/lib/employer-queries';

export function EmployerDashboard() {
  const me = useMe();
  const employer = me.employer!;
  const needs = useNeeds(Boolean(employer.companyId));
  const invitations = useEmployerInvitations('ALL', 1);

  if (!employer.companyId) {
    return (
      <>
        <PageHeader title="Добро пожаловать" description="Начните с профиля компании — он нужен для потребностей, подборок и приглашений." />
        <Alert tone="brand" title="Заполните профиль компании" actions={<LinkButton href="/employer/company">Заполнить</LinkButton>}>
          Название и способ связи увидит кандидат в приглашении. Компании в MVP не верифицируются.
        </Alert>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={employer.companyName}
        title="Обзор"
        description="Опишите потребность — система подберёт кандидатов с подтверждённым тестом грейдом и объяснит соответствие."
        actions={
          <>
            <LinkButton href="/employer/needs/new">Новая потребность</LinkButton>
            <LinkButton href="/employer/candidates" variant="outline">
              Банк кандидатов
            </LinkButton>
            <LinkButton href="/employer/vacancies" variant="outline">
              Вакансии{employer.newApplications > 0 ? ` (новых откликов: ${employer.newApplications})` : ''}
            </LinkButton>
            <LinkButton href="/employer/tasks" variant="outline">
              Короткие задания{employer.pendingTaskReviews > 0 ? ` (ждут оценки: ${employer.pendingTaskReviews})` : ''}
            </LinkButton>
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Потребности"
            actions={
              <LinkButton href="/employer/needs" variant="outline" size="sm">
                Все
              </LinkButton>
            }
          />
          {needs.isPending ? (
            <Spinner />
          ) : needs.isError ? (
            <ErrorState error={needs.error} onRetry={() => needs.refetch()} />
          ) : needs.data.length === 0 ? (
            <p className="text-muted">Пока нет потребностей. Создайте первую — это внутреннее описание, публиковать вакансию не нужно.</p>
          ) : (
            <ul className="space-y-2">
              {needs.data.slice(0, 5).map((need) => (
                <li key={need.id}>
                  <Link href={`/employer/needs/${need.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 hover:border-brand-300">
                    <span className="min-w-0">
                      <span className="block font-medium">{need.title}</span>
                      <span className="text-sm text-muted">
                        {need.specializationTitle} · {need.allowedGrades.map((g) => GRADE_LABELS[g]).join(', ')} · {formatSalaryRange(need.salaryFrom, need.salaryTo, false)}
                      </span>
                    </span>
                    <Badge tone={need.status === 'ACTIVE' ? 'success' : 'neutral'}>{NEED_STATUS_LABELS[need.status]}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader
            title="Последние приглашения"
            actions={
              <LinkButton href="/employer/invitations" variant="outline" size="sm">
                Все
              </LinkButton>
            }
          />
          {invitations.isPending ? (
            <Spinner />
          ) : invitations.isError ? (
            <ErrorState error={invitations.error} onRetry={() => invitations.refetch()} />
          ) : invitations.data.items.length === 0 ? (
            <p className="text-muted">Вы ещё не отправляли приглашений.</p>
          ) : (
            <ul className="space-y-2">
              {invitations.data.items.slice(0, 6).map((inv) => (
                <li key={inv.id}>
                  <Link href={`/employer/invitations/${inv.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 hover:border-brand-300">
                    <span className="min-w-0">
                      <span className="block font-medium">Кандидат {inv.candidateAlias}</span>
                      <span className="text-sm text-muted">
                        {inv.title} · {formatDate(inv.createdAt)}
                      </span>
                    </span>
                    <InvitationStatusBadge status={inv.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
