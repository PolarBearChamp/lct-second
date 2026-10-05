'use client';

import {
  CONTACT_CHANNEL_LABELS,
  WORK_FORMAT_LABELS,
  WORK_FORMATS,
  type ContactChannel,
  type EmployerInvitationDetail,
  type HiringNeedView,
  type SendInvitationRequest,
  type WorkFormat,
} from '@fsp/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { api, ApiError, errorMessage, idempotencyKey } from '@/lib/api/client';
import { formatSalaryRange } from '@/lib/format';
import { useCompany, useNeeds } from '@/lib/employer-queries';

/**
 * Предложение кандидату: обязательная вилка (₽/мес, GROSS), формат, способ связи. Потребность — необязательна.
 * После отправки предложение неизменно: для новых условий нужно отозвать его и отправить новое.
 */
export function InviteForm({ candidateId, candidateLabel, defaultNeedId, onSent }: { candidateId: string; candidateLabel: string; defaultNeedId?: string; onSent: (inv: EmployerInvitationDetail) => void }) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const company = useCompany().data?.company;
  const needs = useNeeds();
  const activeNeeds = (needs.data ?? []).filter((n) => n.status !== 'ARCHIVED');
  const initialNeed = activeNeeds.find((n) => n.id === defaultNeedId);
  const [needId, setNeedId] = useState(initialNeed?.id ?? '');
  const [title, setTitle] = useState(initialNeed?.title ?? '');
  const [description, setDescription] = useState(initialNeed?.description ?? '');
  const [salaryFrom, setSalaryFrom] = useState(initialNeed?.salaryFrom.toString() ?? '');
  const [salaryTo, setSalaryTo] = useState(initialNeed?.salaryTo.toString() ?? '');
  const [workFormat, setWorkFormat] = useState<WorkFormat>(initialNeed?.workFormat ?? 'REMOTE');
  const [contactType, setContactType] = useState<ContactChannel>(company?.contactChannelType ?? 'EMAIL');
  const [contact, setContact] = useState(company?.contactValue ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState(false);
  const [key] = useState(() => idempotencyKey());

  const applyNeed = (need: HiringNeedView | undefined) => {
    setNeedId(need?.id ?? '');
    if (need) {
      setTitle(need.title);
      setDescription(need.description);
      setSalaryFrom(String(need.salaryFrom));
      setSalaryTo(String(need.salaryTo));
      setWorkFormat(need.workFormat);
    }
  };

  const body = (): SendInvitationRequest => ({
    candidateId,
    needId: needId || undefined,
    title: title.trim(),
    description: description.trim(),
    salaryFrom: Number(salaryFrom),
    salaryTo: Number(salaryTo),
    salaryType: 'GROSS',
    workFormat,
    employerContactType: contactType,
    employerContact: contact.trim(),
  });

  const send = useMutation({
    mutationFn: () => api.post<EmployerInvitationDetail>('/employer/invitations', body(), { headers: { 'Idempotency-Key': key } }),
    onSuccess: (inv) => {
      setPreview(false);
      void queryClient.invalidateQueries({ queryKey: ['employer'] });
      notify('Приглашение отправлено');
      onSent(inv);
    },
    onError: (error) => {
      setPreview(false);
      notify(error instanceof ApiError ? error.message : errorMessage(error), 'danger');
    },
  });

  const validate = () => {
    const next: Record<string, string> = {};
    if (title.trim().length < 3) next.title = 'Не менее 3 символов';
    if (description.trim().length < 10) next.description = 'Опишите задачи и условия';
    const from = Number(salaryFrom);
    const to = Number(salaryTo);
    if (!Number.isInteger(from) || from <= 0) next.salaryFrom = 'Укажите сумму';
    if (!Number.isInteger(to) || to <= 0) next.salaryTo = 'Укажите сумму';
    if (!next.salaryFrom && !next.salaryTo && from > to) next.salaryTo = '«До» не меньше «от»';
    if (contact.trim().length < 3) next.contact = 'Укажите контакт';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  return (
    <Card id="invite">
      <CardHeader title="Предложение кандидату" description="Кандидат увидит зарплату и условия до начала общения. Публиковать вакансию не нужно." />
      <form
        className="grid gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (validate()) setPreview(true);
        }}
      >
        <Field label="Потребность (необязательно)" hint="Заполнит поля из потребности">
          {(props) => (
            <Select {...props} value={needId} onChange={(e) => applyNeed(activeNeeds.find((n) => n.id === e.target.value))}>
              <option value="">Без привязки к потребности</option>
              {activeNeeds.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.title}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Заголовок предложения" required error={errors.title}>
          {(props) => <Input {...props} value={title} onChange={(e) => setTitle(e.target.value)} />}
        </Field>
        <Field label="Задачи и условия" required error={errors.description}>
          {(props) => <Textarea rows={4} {...props} value={description} onChange={(e) => setDescription(e.target.value)} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Зарплата от, ₽/мес (GROSS)" required error={errors.salaryFrom}>
            {(props) => <Input inputMode="numeric" {...props} value={salaryFrom} onChange={(e) => setSalaryFrom(e.target.value.replace(/\D/g, ''))} />}
          </Field>
          <Field label="Зарплата до, ₽/мес (GROSS)" required error={errors.salaryTo}>
            {(props) => <Input inputMode="numeric" {...props} value={salaryTo} onChange={(e) => setSalaryTo(e.target.value.replace(/\D/g, ''))} />}
          </Field>
          <Field label="Формат работы" required>
            {(props) => (
              <Select {...props} value={workFormat} onChange={(e) => setWorkFormat(e.target.value as WorkFormat)}>
                {WORK_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {WORK_FORMAT_LABELS[f]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="grid grid-cols-[130px_1fr] gap-2">
            <Field label="Связь">
              {(props) => (
                <Select {...props} value={contactType} onChange={(e) => setContactType(e.target.value as ContactChannel)}>
                  {(['EMAIL', 'PHONE', 'MESSENGER'] as const).map((c) => (
                    <option key={c} value={c}>
                      {CONTACT_CHANNEL_LABELS[c]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Контакт" required error={errors.contact}>
              {(props) => <Input {...props} value={contact} onChange={(e) => setContact(e.target.value)} />}
            </Field>
          </div>
        </div>
        <Button type="submit">Предпросмотр и отправка</Button>
      </form>
      <ConfirmDialog
        open={preview}
        title="Проверьте предложение перед отправкой"
        confirmLabel="Отправить приглашение"
        loading={send.isPending}
        onClose={() => setPreview(false)}
        onConfirm={() => send.mutate()}
      >
        <p>
          Кому: <strong>{candidateLabel}</strong>
        </p>
        <p>
          <strong>{title}</strong> · {WORK_FORMAT_LABELS[workFormat].toLowerCase()} · <strong>{formatSalaryRange(Number(salaryFrom), Number(salaryTo))}</strong>
        </p>
        <p className="whitespace-pre-line">{description}</p>
        <p>
          Связь: {CONTACT_CHANNEL_LABELS[contactType]} — {contact}
        </p>
        <Alert tone="info">После отправки изменить условия нельзя: нужно отозвать приглашение и отправить новое. Срок ответа — 14 дней.</Alert>
      </ConfirmDialog>
    </Card>
  );
}
