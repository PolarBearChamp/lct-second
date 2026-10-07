'use client';

import { APPLICATION_STATUS_LABELS, CONTACT_CHANNEL_LABELS, WORK_FORMAT_LABELS, type CandidateApplicationDetail } from '@fsp/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, LinkButton } from '@/components/ui/button';
import { Card, CardHeader, DefinitionList, PageHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/field';
import { ErrorState, LoadingBlock } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { ApplicationStatusBadge } from '@/components/vacancies/status-badges';
import { api, errorMessage } from '@/lib/api/client';
import { formatDateTime, formatSalaryRange } from '@/lib/format';
import { useMyApplication, vacancyKeys } from '@/lib/vacancy-queries';

export function CandidateApplicationView({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const application = useMyApplication(id);
  const [open, setOpen] = useState(false);
  const [revoke, setRevoke] = useState(true);

  const withdraw = useMutation({
    mutationFn: () => api.post<CandidateApplicationDetail>(`/candidate/applications/${id}/withdraw`, { revokeContactAccess: revoke }),
    onSuccess: (data) => {
      queryClient.setQueryData(vacancyKeys.myApplication(id), data);
      void queryClient.invalidateQueries({ queryKey: ['candidate', 'applications'] });
      void queryClient.invalidateQueries({ queryKey: ['candidate', 'vacancies'] });
      void queryClient.invalidateQueries({ queryKey: ['candidate', 'contact-access'] });
      setOpen(false);
      notify(revoke ? 'Отклик отозван, доступ к контактам закрыт' : 'Отклик отозван', 'info');
    },
    onError: (error) => notify(errorMessage(error), 'danger'),
  });

  if (application.isPending) return <LoadingBlock lines={5} />;
  if (application.isError) return <ErrorState error={application.error} onRetry={() => application.refetch()} />;
  const a = application.data;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/candidate/applications" className="hover:underline">
            ← Мои отклики
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {a.vacancyTitle}
            <ApplicationStatusBadge status={a.status} />
          </span>
        }
        actions={a.canWithdraw ? <Button variant="outline" size="sm" onClick={() => setOpen(true)}>Отозвать отклик</Button> : null}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="text-sm text-muted">Условия на момент отклика</div>
                <div className="font-brand text-3xl font-bold text-brand-700">{formatSalaryRange(a.salaryFrom, a.salaryTo, false)}</div>
                <div className="text-sm text-muted">в месяц до вычета налогов (GROSS)</div>
              </div>
              <Badge tone="brand">{WORK_FORMAT_LABELS[a.workFormat]}</Badge>
            </div>
            <p className="mt-5 whitespace-pre-line text-[15px] leading-relaxed">{a.description}</p>
            {a.vacancyStatus === 'PUBLISHED' ? (
              <LinkButton href={`/candidate/vacancies/${a.vacancyId}`} variant="outline" size="sm" className="mt-4">
                Открыть вакансию
              </LinkButton>
            ) : (
              <p className="mt-4 text-sm text-muted">Вакансия закрыта работодателем.</p>
            )}
          </Card>
          {a.coverNote ? (
            <Card>
              <CardHeader as="h3" title="Ваше сообщение" />
              <p className="whitespace-pre-line text-[15px]">{a.coverNote}</p>
            </Card>
          ) : null}
          <Card>
            <CardHeader as="h3" title="Компания" />
            <DefinitionList
              items={[
                { term: 'Название', value: a.company.name },
                { term: 'Отрасль', value: a.company.industryTitle ?? '—' },
                { term: 'Связь с работодателем', value: a.companyContact ? `${CONTACT_CHANNEL_LABELS[a.companyContact.type as keyof typeof CONTACT_CHANNEL_LABELS] ?? a.companyContact.type}: ${a.companyContact.value}` : '—' },
              ]}
            />
          </Card>
        </div>
        <aside className="space-y-6">
          {a.status === 'SHORTLISTED' ? <Alert tone="success" title="Вас взяли в шорт-лист">Работодатель может связаться с вами по раскрытым каналам.</Alert> : null}
          {a.status === 'REJECTED' ? <Alert tone="neutral" title="Работодатель отклонил отклик" /> : null}
          {a.status === 'WITHDRAWN' ? <Alert tone="neutral" title="Вы отозвали отклик" /> : null}
          <Alert
            tone={a.contactAccess?.active ? 'success' : 'neutral'}
            title={a.contactAccess?.active ? 'Контакты раскрыты этой компании' : 'Доступ к контактам закрыт'}
            actions={<LinkButton href="/candidate/settings#contact-access" variant="outline" size="sm">Управлять доступом</LinkButton>}
          >
            {a.contactAccess?.active
              ? `Каналы: ${a.contactAccess.channels.map((c) => CONTACT_CHANNEL_LABELS[c]).join(', ')}. Доступ действует, пока вы его не отзовёте — даже если отклик отозван или отклонён.`
              : a.contactAccess
                ? `Доступ отозван ${formatDateTime(a.contactAccess.revokedAt)}. Повторное раскрытие — только новым откликом или приглашением.`
                : 'Доступ не выдавался.'}
          </Alert>
          <Card>
            <CardHeader as="h3" title="История" />
            <ol className="space-y-2 text-sm">
              {a.events.map((e, index) => (
                <li key={index} className="flex justify-between gap-3">
                  <span>{APPLICATION_STATUS_LABELS[e.toStatus]}</span>
                  <span className="text-muted">{formatDateTime(e.occurredAt)}</span>
                </li>
              ))}
            </ol>
          </Card>
        </aside>
      </div>

      <ConfirmDialog open={open} title="Отозвать отклик?" confirmLabel="Отозвать" tone="danger" loading={withdraw.isPending} onClose={() => setOpen(false)} onConfirm={() => withdraw.mutate()}>
        <p>Компания увидит статус «Отозван». Позже можно откликнуться снова.</p>
        {a.contactAccess?.active ? (
          <Checkbox checked={revoke} onChange={(e) => setRevoke(e.target.checked)} label="Также закрыть этой компании доступ к моим контактам" description="Без этой отметки доступ сохранится до отзыва в «Приватность и ФСП»." />
        ) : null}
      </ConfirmDialog>
    </>
  );
}
