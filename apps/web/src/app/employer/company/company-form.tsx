'use client';

import type { CompanyView } from '@fsp/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { CompanyVerificationCard } from '@/components/employer/company-verification';
import { Button } from '@/components/ui/button';
import { Card, PageHeader } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { ErrorState, LoadingBlock } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api/client';
import { employerKeys, useCompany } from '@/lib/employer-queries';
import { useReference } from '@/lib/queries';

const schema = z.object({
  name: z.string().trim().min(2, 'Укажите название').max(120),
  description: z.string().max(3000),
  industry: z.string(),
  website: z.string().trim().refine((v) => v === '' || /^https?:\/\/\S+$/.test(v), 'Адрес должен начинаться с https://'),
  contactPersonName: z.string().max(120),
  contactChannelType: z.enum(['EMAIL', 'PHONE', 'MESSENGER']),
  contactValue: z.string().trim().min(3, 'Укажите контакт для связи').max(200),
});
type FormValues = z.infer<typeof schema>;

const toForm = (c: CompanyView | null): FormValues => ({
  name: c?.name ?? '',
  description: c?.description ?? '',
  industry: c?.industry ?? '',
  website: c?.website ?? '',
  contactPersonName: c?.contactPersonName ?? '',
  contactChannelType: c?.contactChannelType ?? 'EMAIL',
  contactValue: c?.contactValue ?? '',
});

export function CompanyForm() {
  const company = useCompany();
  const reference = useReference();
  if (company.isPending || reference.isPending) return <LoadingBlock />;
  if (company.isError) return <ErrorState error={company.error} onRetry={() => company.refetch()} />;
  return <Form initial={company.data.company} />;
}

function Form({ initial }: { initial: CompanyView | null }) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const industries = useReference().data?.industries ?? [];
  const { register, handleSubmit, reset, setError, formState: { errors, isDirty } } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: toForm(initial) });
  useEffect(() => reset(toForm(initial)), [initial, reset]);
  const save = useMutation({
    mutationFn: (values: FormValues) =>
      api.put<{ company: CompanyView }>('/employer/company', {
        ...values,
        description: values.description || null,
        industry: values.industry || null,
        website: values.website || null,
        contactPersonName: values.contactPersonName || null,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(employerKeys.company, data);
      void queryClient.invalidateQueries({ queryKey: ['me'] });
      notify('Профиль компании сохранён');
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        for (const [field, messages] of Object.entries(error.fieldErrors)) setError(field as keyof FormValues, { message: messages[0] });
      }
      notify(error instanceof ApiError ? error.message : 'Не удалось сохранить', 'danger');
    },
  });
  return (
    <>
      <PageHeader title="Профиль компании" description="Эти данные кандидат увидит в приглашении. Способ связи нужен, чтобы кандидат мог ответить после принятия." />
      <Card>
        <form className="grid gap-4" onSubmit={handleSubmit((v) => save.mutate(v))} noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Название" required error={errors.name?.message}>
              {(props) => <Input {...props} {...register('name')} />}
            </Field>
            <Field label="Отрасль" error={errors.industry?.message}>
              {(props) => (
                <Select {...props} {...register('industry')}>
                  <option value="">Не указана</option>
                  {industries.map((i) => (
                    <option key={i.code} value={i.code}>
                      {i.title}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <Field label="Описание" hint="Чем занимается компания и команда" error={errors.description?.message}>
            {(props) => <Textarea rows={5} {...props} {...register('description')} />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Сайт" error={errors.website?.message}>
              {(props) => <Input type="url" placeholder="https://" {...props} {...register('website')} />}
            </Field>
            <Field label="Контактное лицо" error={errors.contactPersonName?.message}>
              {(props) => <Input {...props} {...register('contactPersonName')} />}
            </Field>
            <Field label="Способ связи" required>
              {(props) => (
                <Select {...props} {...register('contactChannelType')}>
                  <option value="EMAIL">Email</option>
                  <option value="PHONE">Телефон</option>
                  <option value="MESSENGER">Мессенджер</option>
                </Select>
              )}
            </Field>
            <Field label="Контакт" required error={errors.contactValue?.message}>
              {(props) => <Input {...props} {...register('contactValue')} />}
            </Field>
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" loading={save.isPending}>
              Сохранить
            </Button>
            {isDirty ? <span className="text-sm text-warning-700">Есть несохранённые изменения</span> : null}
          </div>
        </form>
      </Card>
      {initial ? <CompanyVerificationCard company={initial} /> : null}
    </>
  );
}
