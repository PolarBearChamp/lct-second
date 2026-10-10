'use client';

import type { EmployerCandidateResponse } from '@fsp/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { BookmarkButton } from '@/components/employer/bookmark-button';
import { ExplanationPanel } from '@/components/employer/explanation-panel';
import { InviteForm } from '@/components/employer/invite-form';
import { SendTaskCard } from '@/components/tasks/send-task-card';
import { InvitationStatusBadge } from '@/components/invitations/invitation-status';
import { CandidateCard } from '@/components/profile/candidate-card';
import { Alert } from '@/components/ui/alert';
import { buttonClass } from '@/components/ui/button';
import { Card, CardHeader, PageHeader } from '@/components/ui/card';
import { ErrorState, LoadingBlock } from '@/components/ui/states';
import { api } from '@/lib/api/client';
import { formatDate } from '@/lib/format';
import { useCompany, useNeeds } from '@/lib/employer-queries';

export function EmployerCandidateView({ id, needId, specialization }: { id: string; needId?: string; specialization?: string }) {
  const queryClient = useQueryClient();
  const key = ['employer', 'candidate', id, needId ?? '', specialization ?? ''];
  // Категория из банка: у кандидата может быть несколько подтверждённых; потребность (needId) имеет приоритет на сервере.
  const query = new URLSearchParams({ ...(needId ? { needId } : {}), ...(specialization ? { specialization } : {}) }).toString();
  const data = useQuery({
    queryKey: key,
    queryFn: () => api.get<EmployerCandidateResponse>(`/employer/candidates/${id}${query ? `?${query}` : ''}`),
  });
  const needs = useNeeds();
  const company = useCompany();
  if (data.isPending) return <LoadingBlock lines={6} />;
  if (data.isError) return <ErrorState error={data.error} onRetry={() => data.refetch()} />;
  const { profile, match, invitations, bookmarked } = data.data;
  const activeInvitation = invitations.find((i) => i.status === 'SENT' || i.status === 'VIEWED');

  return (
    <>
      <PageHeader
        eyebrow={
          match ? (
            <Link href={`/employer/needs/${match.needId}`} className="hover:underline">
              ← {match.needTitle}
            </Link>
          ) : (
            <Link href="/employer/candidates" className="hover:underline">
              ← Банк кандидатов
            </Link>
          )
        }
        title={profile.displayName}
        actions={
          <>
            <BookmarkButton candidateId={id} initial={bookmarked} />
            <a href={`/api/v1/employer/candidates/${id}/pdf${specialization ? `?specialization=${specialization}` : ''}`} className={buttonClass('outline', 'sm')} download>
              PDF ({profile.mode === 'EMPLOYER_GRANTED' ? 'с контактами' : 'обезличенный'})
            </a>
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
        <div className="space-y-6">
          {match ? (
            <Card>
              <CardHeader title={`Соответствие потребности «${match.needTitle}»`} />
              {!match.gradeConfirmed ? (
                <Alert tone="warning" title="Грейд не подтверждён тестом" className="mb-4">
                  {match.passes
                    ? 'По заявленным данным кандидат подходит под условия потребности, но в подборке он показывается после всех подтверждённых и без балла.'
                    : `По заявленным данным не подходит: ${match.violations.join('; ')}.`}
                </Alert>
              ) : null}
              {match.passes && match.explanation ? (
                <ExplanationPanel explanation={match.explanation} score={match.score} />
              ) : match.gradeConfirmed ? (
                <Alert tone="warning" title="Не проходит обязательные условия">
                  {match.violations.join('; ')}
                </Alert>
              ) : null}
            </Card>
          ) : null}
          <CandidateCard view={profile} />
        </div>
        <aside className="space-y-6">
          {invitations.length ? (
            <Card>
              <CardHeader as="h3" title="Ваши приглашения" />
              <ul className="space-y-2">
                {invitations.map((inv) => (
                  <li key={inv.id}>
                    <Link href={`/employer/invitations/${inv.id}`} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-sm hover:border-brand-300">
                      <span className="min-w-0 truncate">
                        {inv.title} · {formatDate(inv.createdAt)}
                      </span>
                      <InvitationStatusBadge status={inv.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          {activeInvitation ? (
            <Alert tone="brand" title="Приглашение уже отправлено">
              Не более одного активного приглашения кандидату от компании. Чтобы изменить условия, отзовите текущее и отправьте новое.
            </Alert>
          ) : needs.isPending || company.isPending ? (
            <LoadingBlock lines={2} />
          ) : (
            <InviteForm
              key={needId ?? 'none'}
              candidateId={id}
              candidateLabel={profile.displayName}
              candidateMinor={profile.minor}
              defaultNeedId={needId}
              onSent={() => void queryClient.invalidateQueries({ queryKey: key })}
            />
          )}
          <SendTaskCard candidateId={id} candidateLabel={profile.displayName} />
        </aside>
      </div>
    </>
  );
}
