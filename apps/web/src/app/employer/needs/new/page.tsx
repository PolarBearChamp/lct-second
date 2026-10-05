'use client';

import type { HiringNeedInput, HiringNeedView } from '@fsp/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { NeedForm } from '@/components/employer/need-form';
import { PageHeader } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api/client';
import { employerKeys } from '@/lib/employer-queries';

export default function NewNeedPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const create = useMutation({
    mutationFn: (input: HiringNeedInput) => api.post<HiringNeedView>('/employer/needs', input),
    onSuccess: (need) => {
      void queryClient.invalidateQueries({ queryKey: employerKeys.needs });
      void queryClient.invalidateQueries({ queryKey: ['me'] });
      notify('Потребность создана');
      router.push(`/employer/needs/${need.id}`);
    },
  });
  return (
    <>
      <PageHeader title="Новая потребность" description="Публиковать вакансию не нужно: потребность видна только вашей компании." />
      <NeedForm submitLabel="Создать потребность" loading={create.isPending} serverError={create.error} onSubmit={(input) => create.mutate(input)} />
    </>
  );
}
