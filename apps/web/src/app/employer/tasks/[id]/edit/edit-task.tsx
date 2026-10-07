'use client';

import type { CreateTaskRequest, EmployerTaskView } from '@fsp/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { TaskForm } from '@/components/tasks/task-form';
import { Alert } from '@/components/ui/alert';
import { LinkButton } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/card';
import { ErrorState, LoadingBlock } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api/client';
import { taskKeys, useEmployerTask } from '@/lib/task-queries';

export function EditTask({ id }: { id: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const task = useEmployerTask(id);
  const update = useMutation({
    mutationFn: async ({ input, publish }: { input: CreateTaskRequest; publish: boolean }) => {
      const { options, correctIndex, ...rest } = input;
      const saved = await api.patch<EmployerTaskView>(`/employer/tasks/${id}`, { ...rest, options: options ?? [], correctIndex });
      return publish ? api.post<EmployerTaskView>(`/employer/tasks/${id}/publish`) : saved;
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(taskKeys.employerOne(id), saved);
      void queryClient.invalidateQueries({ queryKey: taskKeys.employerAll });
      notify(saved.status === 'ACTIVE' ? 'Задание опубликовано' : 'Черновик сохранён');
      router.push(`/employer/tasks/${id}`);
    },
  });
  if (task.isPending) return <LoadingBlock />;
  if (task.isError) return <ErrorState error={task.error} />;
  if (task.data.status !== 'DRAFT') {
    return (
      <>
        <PageHeader title="Редактирование задания" />
        <Alert tone="warning" title="Опубликованное задание не редактируется" actions={<LinkButton href={`/employer/tasks/${id}`}>К заданию</LinkButton>}>
          Все ответы оцениваются по одному условию. Закройте задание и создайте новое.
        </Alert>
      </>
    );
  }
  return (
    <>
      <PageHeader title="Редактирование черновика" />
      <TaskForm initial={task.data} loading={update.isPending} serverError={update.error} saveLabel="Сохранить черновик" onSubmit={(input, publish) => update.mutate({ input, publish })} />
    </>
  );
}
