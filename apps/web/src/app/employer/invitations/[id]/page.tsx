'use client';

import { CONTACT_CHANNEL_LABELS, INVITATION_STATUS_LABELS, WORK_FORMAT_LABELS, type EmployerInvitationDetail } from '@fsp/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { InvitationStatusBadge } from '@/components/invitations/invitation-status';
import { Alert } from '@/components/ui/alert';
import { Button, LinkButton } from '@/components/ui/button';
import { Card, CardHeader, DefinitionList, PageHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { ErrorState, LoadingBlock } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api/client';
import { formatDateTime, formatSalaryRange } from '@/lib/format';
import { employerKeys, useEmployerInvitation } from '@/lib/employer-queries';

export default function EmployerInvitationPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const invitation = useEmployerInvitation(id);
  const [confirm, setConfirm] = useState(false);
  const withdraw = useMutation({
    mutationFn: () => api.post<EmployerInvitationDetail>(`/employer/invitations/${id}/withdraw`),
    onSuccess: (data) => {
      queryClient.setQueryData(employerKeys.invitation(id), data);
      void queryClient.invalidateQueries({ queryKey: ['employer'] });
      setConfirm(false);
      notify('Приглашение отозвано', 'info');
    },
    onError: (error) => {
      setConfirm(false);
      notify(errorMessage(error), 'danger');
      void invitation.refetch();
    },
  });
  if (invitation.isPending) return <LoadingBlock />;
  if (invitation.isError) return <ErrorState error={invitation.error} onRetry={() => invitation.refetch()} />;
  const inv = invitation.data;
  const active = inv.status === 'SENT' || inv.status === 'VIEWED';
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/employer/invitations" className="hover:underline">
            ← Приглашения
          </Link>
        }
        title={inv.title}
        actions={<InvitationStatusBadge status={inv.status} />}
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <Card>
          <DefinitionList
            items={[
              { term: 'Кандидат', value: <Link className="font-medium text-brand-600 hover:underline" href={`/employer/candidates/${inv.candidateId}`}>Кандидат {inv.candidateAlias}</Link> },
              { term: 'Потребность', value: inv.needTitle ?? 'без привязки' },
              { term: 'Зарплата', value: formatSalaryRange(inv.salaryFrom, inv.salaryTo) },
              { term: 'Формат', value: WORK_FORMAT_LABELS[inv.workFormat] },
              { term: 'Связь с вами', value: `${CONTACT_CHANNEL_LABELS[inv.employerContactType]}: ${inv.employerContact}` },
              { term: 'Действует до', value: formatDateTime(inv.expiresAt) },
            ]}
          />
          <p className="mt-5 whitespace-pre-line text-[15px] text-ink-soft">{inv.description}</p>
          {active ? (
            <Button variant="outline" className="mt-5" onClick={() => setConfirm(true)}>
              Отозвать приглашение
            </Button>
          ) : null}
        </Card>
        <aside className="space-y-6">
          {inv.status === 'ACCEPTED' ? (
            inv.contactAccess?.active ? (
              <Alert tone="success" title="Кандидат принял приглашение" actions={<LinkButton href={`/employer/candidates/${inv.candidateId}`} size="sm">Открыть контакты</LinkButton>}>
                Доступ к контактам выдан {formatDateTime(inv.contactAccess.grantedAt)} только вашей компании.
              </Alert>
            ) : (
              <Alert tone="neutral" title="Кандидат принял приглашение, но отозвал доступ к контактам">
                Доступ отозван {formatDateTime(inv.contactAccess?.revokedAt)}.
              </Alert>
            )
          ) : null}
          <Card>
            <CardHeader as="h3" title="История статусов" />
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
      <ConfirmDialog open={confirm} title="Отозвать приглашение?" tone="danger" confirmLabel="Отозвать" loading={withdraw.isPending} onClose={() => setConfirm(false)} onConfirm={() => withdraw.mutate()}>
        <p>Кандидат больше не сможет принять это предложение. Если кандидат успел принять его, отзыв не выполнится.</p>
      </ConfirmDialog>
    </>
  );
}
