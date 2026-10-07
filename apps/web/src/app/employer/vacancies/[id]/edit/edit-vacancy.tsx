'use client';

import type { EmployerVacancyView, HiringNeedInput } from '@fsp/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { NeedForm } from '@/components/employer/need-form';
import { Alert } from '@/components/ui/alert';
import { PageHeader } from '@/components/ui/card';
import { ErrorState, LoadingBlock } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api/client';
import { useEmployerVacancy, vacancyKeys } from '@/lib/vacancy-queries';

export function EditVacancy({ id }: { id: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const vacancy = useEmployerVacancy(id);
  const update = useMutation({
    mutationFn: (input: HiringNeedInput) => {
      const { status: _status, ...requirements } = input;
      return api.patch<EmployerVacancyView>(`/employer/vacancies/${id}`, requirements);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(vacancyKeys.employerOne(id), updated);
      void queryClient.invalidateQueries({ queryKey: vacancyKeys.employerAll });
      notify(`Сохранено, версия ${updated.version}`);
      router.push(`/employer/vacancies/${id}`);
    },
  });
  if (vacancy.isPending) return <LoadingBlock />;
  if (vacancy.isError) return <ErrorState error={vacancy.error} />;
  return (
    <>
      <PageHeader title="Редактирование вакансии" description="Сохранение создаёт новую версию. Уже поданные отклики сохраняют условия вакансии на момент отклика." />
      {vacancy.data.applicationsCount > 0 ? (
        <Alert tone="warning" title="На вакансию уже есть отклики">
          Кандидаты откликались на прежние условия — они видят их в своих откликах. Изменение зарплаты и требований действует для новых откликов.
        </Alert>
      ) : null}
      <NeedForm variant="vacancy" hideStatus initial={vacancy.data} submitLabel="Сохранить изменения" loading={update.isPending} serverError={update.error} onSubmit={(input) => update.mutate(input)} />
    </>
  );
}
