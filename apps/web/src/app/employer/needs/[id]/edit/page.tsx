'use client';

import type { HiringNeedInput, HiringNeedView } from '@fsp/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { NeedForm } from '@/components/employer/need-form';
import { PageHeader } from '@/components/ui/card';
import { ErrorState, LoadingBlock } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api/client';
import { employerKeys, useNeed } from '@/lib/employer-queries';

export default function EditNeedPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const need = useNeed(id);
  const update = useMutation({
    mutationFn: (input: HiringNeedInput) => api.patch<HiringNeedView>(`/employer/needs/${id}`, input),
    onSuccess: (updated) => {
      queryClient.setQueryData(employerKeys.need(id), updated);
      void queryClient.invalidateQueries({ queryKey: employerKeys.needs });
      notify(`Сохранено, версия ${updated.version}`);
      router.push(`/employer/needs/${id}`);
    },
  });
  if (need.isPending) return <LoadingBlock />;
  if (need.isError) return <ErrorState error={need.error} />;
  return (
    <>
      <PageHeader title="Редактирование потребности" description="Сохранение создаст новую версию. Уже построенные подборки останутся привязаны к своей версии." />
      <NeedForm initial={need.data} submitLabel="Сохранить изменения" loading={update.isPending} serverError={update.error} onSubmit={(input) => update.mutate(input)} />
    </>
  );
}
