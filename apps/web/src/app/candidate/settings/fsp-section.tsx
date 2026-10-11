'use client';

import { FSP_STATE_LABELS, type FspStateResponse } from '@fsp/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/field';
import { ErrorState, Spinner } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { api, ApiError, errorMessage } from '@/lib/api/client';
import { formatDateTime } from '@/lib/format';

const OUTCOME = { WIN: 'Победа', PRIZE: 'Призёр', PARTICIPATION: 'Участие' } as const;
const KEY = ['candidate', 'fsp'] as const;

export function FspSection() {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const [fspId, setFspId] = useState('');
  const [code, setCode] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const state = useQuery({ queryKey: KEY, queryFn: () => api.get<FspStateResponse>('/candidate/fsp-link') });
  const onState = (data: FspStateResponse, message: string) => {
    queryClient.setQueryData(KEY, data);
    void queryClient.invalidateQueries({ queryKey: ['candidate', 'preview'] });
    notify(message, data.state === 'SYNC_ERROR' ? 'danger' : 'success');
  };
  const link = useMutation({
    mutationFn: () => api.post<FspStateResponse>('/candidate/fsp-link', { fspId: fspId.trim(), code: code.trim() }),
    onSuccess: (data) => {
      setFspId('');
      setCode('');
      setFormError(null);
      onState(data, data.state === 'SYNC_ERROR' ? 'ФСП ID привязан, но синхронизация не удалась' : 'ФСП ID привязан');
    },
    onError: (error) => setFormError(error instanceof ApiError ? error.message : errorMessage(error)),
  });
  const sync = useMutation({
    mutationFn: () => api.post<FspStateResponse>('/candidate/fsp-link/sync'),
    onSuccess: (data) => onState(data, data.state === 'SYNC_ERROR' ? 'Не удалось обновить: показана последняя успешная история' : 'Достижения обновлены'),
    onError: (error) => notify(errorMessage(error), 'danger'),
  });
  const unlink = useMutation({
    mutationFn: () => api.delete<FspStateResponse>('/candidate/fsp-link'),
    onSuccess: (data) => {
      setConfirmUnlink(false);
      onState(data, 'ФСП ID отвязан');
    },
    onError: (error) => notify(errorMessage(error), 'danger'),
  });

  return (
    <Card id="fsp">
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            Достижения ФСП <Badge tone="warning">Демонстрационная интеграция</Badge>
          </span>
        }
        description="Достижения дают ограниченный бонус в подборе по релевантной специализации, но не заменяют подтверждённых навыков. Без привязки вы участвуете в подборе на равных."
      />
      {state.isPending ? (
        <Spinner />
      ) : state.isError ? (
        <ErrorState error={state.error} onRetry={() => state.refetch()} />
      ) : state.data.state === 'NOT_LINKED' ? (
        <form
          className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            link.mutate();
          }}
        >
          <Field label="ФСП ID" hint="Демо: FSP-DEMO-1001">
            {(props) => <Input {...props} value={fspId} onChange={(e) => setFspId(e.target.value)} autoComplete="off" />}
          </Field>
          <Field label="Одноразовый код" hint="Демо: 731905 (из data/fixtures/fsp-mock.json)">
            {(props) => <Input {...props} value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" />}
          </Field>
          <Button type="submit" loading={link.isPending} disabled={!fspId || !code}>
            Привязать
          </Button>
          {formError ? (
            <Alert tone="danger" className="md:col-span-3">
              {formError}
            </Alert>
          ) : null}
        </form>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-4">
            <div>
              <div className="font-semibold">
                {state.data.externalId} · {FSP_STATE_LABELS[state.data.state]}
              </div>
              <div className="text-sm text-muted">
                Привязан {formatDateTime(state.data.linkedAt)} · последнее успешное обновление {formatDateTime(state.data.lastSuccessfulSyncAt)}
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" loading={sync.isPending} onClick={() => sync.mutate()}>
                Обновить
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmUnlink(true)}>
                Отвязать
              </Button>
            </div>
          </div>
          {state.data.state === 'SYNC_ERROR' ? (
            <Alert tone="warning" title="Не удалось получить данные из реестра">
              Показана последняя успешная история{state.data.lastSuccessfulSyncAt ? ` от ${formatDateTime(state.data.lastSuccessfulSyncAt)}` : ' (её нет)'}. Код ошибки:{' '}
              {state.data.lastErrorCode}.
            </Alert>
          ) : null}
          {state.data.notice ? <p className="text-sm text-warning-700">{state.data.notice}</p> : null}
          {state.data.achievements.length ? (
            <ul className="space-y-2">
              {state.data.achievements.map((a, index) => (
                <li key={index} className="grid items-start gap-2 rounded-lg border border-line px-3 py-3 text-[15px] lg:grid-cols-[minmax(0,1fr)_auto]">
                  <span className="min-w-0 leading-6">
                    <strong>{OUTCOME[a.outcome]}</strong>
                    {a.place ? ` (${a.place} место)` : ''} · {a.eventTitle ?? 'Мероприятие'} · {a.year ?? '—'}
                  </span>
                  {a.relevantToSpecialization ? <Badge tone="brand">релевантно вашей специализации</Badge> : <Badge>не влияет на подбор</Badge>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">Достижений нет — это не влияет на доступ к подбору.</p>
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirmUnlink}
        title="Отвязать ФСП ID?"
        tone="danger"
        confirmLabel="Отвязать"
        loading={unlink.isPending}
        onClose={() => setConfirmUnlink(false)}
        onConfirm={() => unlink.mutate()}
      >
        <p>Бонус ФСП в подборе пропадёт, история перестанет показываться работодателям.</p>
      </ConfirmDialog>
    </Card>
  );
}
