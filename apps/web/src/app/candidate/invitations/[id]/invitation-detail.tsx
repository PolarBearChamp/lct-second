'use client';

import {
  CONTACT_CHANNEL_LABELS,
  INVITATION_STATUS_LABELS,
  WORK_FORMAT_LABELS,
  type CandidateInvitationDetail,
} from '@fsp/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { InvitationStatusBadge } from '@/components/invitations/invitation-status';
import { CompanyVerifiedBadge } from '@/components/employer/company-verification';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, LinkButton } from '@/components/ui/button';
import { Card, CardHeader, DefinitionList, PageHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Checkbox, Field, Select } from '@/components/ui/field';
import { ErrorState, LoadingBlock } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api/client';
import { formatDateTime, formatSalaryRange } from '@/lib/format';

const DECLINE_REASONS = [
  { value: 'SALARY', label: 'Не подходит зарплата' },
  { value: 'FORMAT', label: 'Не подходит формат работы' },
  { value: 'NOT_INTERESTED', label: 'Неинтересна задача' },
  { value: 'OTHER', label: 'Другая причина' },
];

export function CandidateInvitationDetailView({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const key = ['candidate', 'invitation', id];
  const invitation = useQuery({ queryKey: key, queryFn: () => api.get<CandidateInvitationDetail>(`/candidate/invitations/${id}`) });
  const [acceptOpen, setAcceptOpen] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [reason, setReason] = useState('');
  const viewSent = useRef(false);

  const onUpdated = (data: CandidateInvitationDetail) => {
    queryClient.setQueryData(key, data);
    void queryClient.invalidateQueries({ queryKey: ['candidate', 'invitations'] });
    void queryClient.invalidateQueries({ queryKey: ['me'] });
  };
  const markViewed = useMutation({ mutationFn: () => api.post<CandidateInvitationDetail>(`/candidate/invitations/${id}/view`), onSuccess: onUpdated });
  const accept = useMutation({
    mutationFn: () => api.post<CandidateInvitationDetail>(`/candidate/invitations/${id}/accept`, { confirmDisclosure: true }),
    onSuccess: (data) => {
      onUpdated(data);
      setAcceptOpen(false);
      notify('Приглашение принято — контакты раскрыты только этой компании');
    },
    onError: (error) => notify(errorMessage(error), 'danger'),
  });
  const decline = useMutation({
    mutationFn: () => api.post<CandidateInvitationDetail>(`/candidate/invitations/${id}/decline`, reason ? { reason } : {}),
    onSuccess: (data) => {
      onUpdated(data);
      setDeclineOpen(false);
      notify('Приглашение отклонено', 'info');
    },
    onError: (error) => notify(errorMessage(error), 'danger'),
  });

  // Явное открытие конкретного приглашения фиксирует просмотр; список и предзагрузка статус не меняют.
  const status = invitation.data?.status;
  const { mutate: sendView } = markViewed;
  useEffect(() => {
    if (status === 'SENT' && !viewSent.current) {
      viewSent.current = true;
      sendView();
    }
  }, [status, sendView]);

  if (invitation.isPending) return <LoadingBlock />;
  if (invitation.isError) return <ErrorState error={invitation.error} onRetry={() => invitation.refetch()} />;
  const inv = invitation.data;
  const active = inv.status === 'SENT' || inv.status === 'VIEWED';

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/candidate/invitations" className="hover:underline">
            ← Все приглашения
          </Link>
        }
        title={inv.title}
        actions={<InvitationStatusBadge status={inv.status} />}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="text-sm text-muted">Зарплата</div>
                <div className="font-brand text-3xl font-bold text-brand-700">{formatSalaryRange(inv.salaryFrom, inv.salaryTo, false)}</div>
                <div className="text-sm text-muted">в месяц до вычета налогов (GROSS)</div>
              </div>
              <Badge tone="brand">{WORK_FORMAT_LABELS[inv.workFormat]}</Badge>
            </div>
            <p className="mt-5 whitespace-pre-line text-[15px] leading-relaxed">{inv.description}</p>
          </Card>
          <Card>
            <CardHeader as="h3" title="Компания" />
            <DefinitionList
              items={[
                {
                  term: 'Название',
                  value: (
                    <span className="flex flex-wrap items-center gap-2">
                      {inv.company.name}
                      <CompanyVerifiedBadge verified={inv.companyVerified} />
                    </span>
                  ),
                },
                { term: 'Отрасль', value: inv.company.industryTitle ?? '—' },
                {
                  term: 'Сайт',
                  value: inv.company.website ? (
                    <a href={inv.company.website} target="_blank" rel="noopener noreferrer nofollow" className="text-brand-600 hover:underline">
                      {inv.company.website}
                    </a>
                  ) : (
                    '—'
                  ),
                },
                { term: 'Связь с работодателем', value: `${CONTACT_CHANNEL_LABELS[inv.employerContactType]}: ${inv.employerContact}` },
              ]}
            />
            {inv.company.description ? <p className="mt-4 whitespace-pre-line text-[15px] text-ink-soft">{inv.company.description}</p> : null}
            <p className="mt-4 text-xs text-muted">Компании не проходят верификацию в MVP — проверьте работодателя перед передачей документов.</p>
          </Card>
        </div>
        <aside className="space-y-6">
          {active ? (
            <Card>
              <CardHeader as="h3" title="Ваш ответ" description={`Приглашение действует до ${formatDateTime(inv.expiresAt)}.`} />
              <div className="flex flex-col gap-2">
                <Button onClick={() => setAcceptOpen(true)}>Принять и раскрыть контакты</Button>
                <Button variant="outline" onClick={() => setDeclineOpen(true)}>
                  Отклонить
                </Button>
              </div>
            </Card>
          ) : null}
          {inv.status === 'ACCEPTED' ? (
            <Alert
              tone={inv.contactAccess?.active ? 'success' : 'neutral'}
              title={inv.contactAccess?.active ? 'Контакты раскрыты этой компании' : 'Доступ к контактам отозван'}
              actions={<LinkButton href="/candidate/settings#contact-access" variant="outline" size="sm">Управлять доступом</LinkButton>}
            >
              {inv.contactAccess?.active
                ? `Каналы: ${inv.contactAccess.channels.map((c) => CONTACT_CHANNEL_LABELS[c]).join(', ')}. Свяжитесь с работодателем: ${inv.employerContact}.`
                : `Доступ отозван ${formatDateTime(inv.contactAccess?.revokedAt)}. Повторное раскрытие возможно только через новое приглашение.`}
            </Alert>
          ) : null}
          {inv.status === 'EXPIRED' ? <Alert tone="warning" title="Срок приглашения истёк" /> : null}
          {inv.status === 'WITHDRAWN' ? <Alert tone="neutral" title="Работодатель отозвал приглашение" /> : null}
          <Card>
            <CardHeader as="h3" title="История" />
            <ol className="space-y-2 text-sm">
              {inv.events.map((e, index) => (
                <li key={index} className="flex justify-between gap-3">
                  <span>{INVITATION_STATUS_LABELS[e.toStatus]}</span>
                  <span className="text-muted">{formatDateTime(e.occurredAt)}</span>
                </li>
              ))}
            </ol>
          </Card>
        </aside>
      </div>

      <ConfirmDialog
        open={acceptOpen}
        title="Принять приглашение?"
        confirmLabel="Принять и раскрыть"
        confirmDisabled={!confirmed || inv.disclosure.channels.length === 0}
        loading={accept.isPending}
        onClose={() => setAcceptOpen(false)}
        onConfirm={() => accept.mutate()}
      >
        <p>
          <strong>{inv.company.name}</strong>: {inv.title}, <strong>{formatSalaryRange(inv.salaryFrom, inv.salaryTo)}</strong>, {WORK_FORMAT_LABELS[inv.workFormat].toLowerCase()}.
        </p>
        <div>
          <p className="font-medium text-ink">Только этой компании будет раскрыто:</p>
          <ul className="mt-1 list-disc pl-5">
            <li>ФИО: {inv.disclosure.fullName ?? 'не заполнено'}</li>
            {inv.disclosure.channels.map((c) => (
              <li key={c.channel}>
                {CONTACT_CHANNEL_LABELS[c.channel]}: {c.value}
              </li>
            ))}
            <li>{inv.disclosure.alsoShared.filter((s) => s !== 'ФИО').join(', ')}</li>
          </ul>
        </div>
        {inv.disclosure.channels.length === 0 ? (
          <Alert tone="danger">
            Не выбран ни один заполненный канал связи. <Link className="underline" href="/candidate/settings#channels">Выберите каналы</Link>.
          </Alert>
        ) : null}
        <Checkbox checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} label="Я понимаю, какие данные будут раскрыты, и согласен(на) на это" />
      </ConfirmDialog>
      <ConfirmDialog
        open={declineOpen}
        title="Отклонить приглашение?"
        confirmLabel="Отклонить"
        tone="danger"
        loading={decline.isPending}
        onClose={() => setDeclineOpen(false)}
        onConfirm={() => decline.mutate()}
      >
        <p>Компания увидит статус «Отклонено». Контакты не раскрываются.</p>
        <Field label="Причина (необязательно)">
          {(props) => (
            <Select {...props} value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">Не указывать</option>
              {DECLINE_REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </ConfirmDialog>
    </>
  );
}
