'use client';

import type { CreateVacancyRequest, EmployerVacancyView, HiringNeedInput } from '@fsp/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { NeedForm } from '@/components/employer/need-form';
import { Alert } from '@/components/ui/alert';
import { PageHeader } from '@/components/ui/card';
import { ErrorState, LoadingBlock } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api/client';
import { useNeed } from '@/lib/employer-queries';
import { vacancyKeys } from '@/lib/vacancy-queries';

/** Создание вакансии; при ?needId= поля берутся из потребности (их можно изменить до сохранения). */
export function NewVacancy({ needId }: { needId?: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const need = useNeed(needId ?? '', Boolean(needId));
  const create = useMutation({
    mutationFn: (input: HiringNeedInput) => {
      const { status, ...requirements } = input;
      const body: CreateVacancyRequest = { ...requirements, publish: status === 'ACTIVE', ...(needId ? { needId } : {}) };
      return api.post<EmployerVacancyView>('/employer/vacancies', body);
    },
    onSuccess: (vacancy) => {
      void queryClient.invalidateQueries({ queryKey: vacancyKeys.employerAll });
      notify(vacancy.status === 'PUBLISHED' ? 'Вакансия опубликована' : 'Черновик вакансии сохранён');
      router.push(`/employer/vacancies/${vacancy.id}`);
    },
  });

  if (needId && need.isPending) return <LoadingBlock />;
  const prefill = needId && need.data ? need.data : undefined;
  return (
    <>
      <PageHeader
        title="Новая вакансия"
        description="Вакансию увидят все кандидаты. Зарплатная вилка обязательна и показывается до отклика."
      />
      {needId && need.isError ? <ErrorState error={need.error} title="Не удалось загрузить потребность — заполните вакансию вручную" /> : null}
      {prefill ? <Alert tone="brand" title={`Поля заполнены из потребности «${prefill.title}»`}>Проверьте текст: он станет публичным.</Alert> : null}
      <NeedForm
        variant="vacancy"
        initial={prefill ? { ...prefill, status: 'DRAFT' } : undefined}
        submitLabel="Сохранить вакансию"
        loading={create.isPending}
        serverError={create.error}
        onSubmit={(input) => create.mutate(input)}
      />
    </>
  );
}
