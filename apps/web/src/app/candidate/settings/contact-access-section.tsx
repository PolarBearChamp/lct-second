'use client';

import { CONTACT_CHANNEL_LABELS, type ContactAccessItem } from '@fsp/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { ErrorState, Spinner } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api/client';
import { formatDateTime } from '@/lib/format';

export function ContactAccessSection() {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const [target, setTarget] = useState<ContactAccessItem | null>(null);
  const grants = useQuery({ queryKey: ['candidate', 'contact-access'], queryFn: () => api.get<ContactAccessItem[]>('/candidate/contact-access') });
  const revoke = useMutation({
    mutationFn: (companyId: string) => api.delete<ContactAccessItem[]>(`/candidate/contact-access/${companyId}`),
    onSuccess: (data) => {
      queryClient.setQueryData(['candidate', 'contact-access'], data);
      void queryClient.invalidateQueries({ queryKey: ['candidate', 'invitations'] });
      notify('Доступ отозван');
      setTarget(null);
    },
    onError: (error) => notify(errorMessage(error), 'danger'),
  });

  return (
    <Card id="contact-access">
      <CardHeader
        title="Компании с доступом к контактам"
        description="Доступ появляется только после того, как вы приняли приглашение компании. Его можно отозвать: новые ответы API и PDF перестанут содержать контакты."
      />
      {grants.isPending ? (
        <Spinner />
      ) : grants.isError ? (
        <ErrorState error={grants.error} onRetry={() => grants.refetch()} />
      ) : grants.data.length === 0 ? (
        <p className="text-muted">Вы ещё никому не раскрывали контакты.</p>
      ) : (
        <ul className="space-y-2">
          {grants.data.map((grant) => (
            <li key={grant.companyId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line px-4 py-3">
              <div className="min-w-0">
                <div className="font-semibold">{grant.companyName}</div>
                <div className="text-sm text-muted">
                  Выдан {formatDateTime(grant.grantedAt)} · каналы: {grant.channels.map((c) => CONTACT_CHANNEL_LABELS[c]).join(', ')}
                </div>
              </div>
              {grant.active ? (
                <Button variant="outline" size="sm" onClick={() => setTarget(grant)}>
                  Отозвать доступ
                </Button>
              ) : (
                <Badge>Отозван {formatDateTime(grant.revokedAt)}</Badge>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={Boolean(target)}
        title={`Отозвать доступ компании «${target?.companyName ?? ''}»?`}
        tone="danger"
        confirmLabel="Отозвать"
        loading={revoke.isPending}
        onClose={() => setTarget(null)}
        onConfirm={() => target && revoke.mutate(target.companyId)}
      >
        <p>Компания больше не увидит ваши контакты в карточке и PDF. Статус принятого приглашения в истории сохранится.</p>
        <p>Уже полученную компанией копию данных (например, записанный email) технически отозвать невозможно.</p>
        <p>Чтобы снова раскрыть контакты этой компании, потребуется принять её новое приглашение.</p>
      </ConfirmDialog>
    </Card>
  );
}
