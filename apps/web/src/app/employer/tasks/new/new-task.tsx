'use client';

import type { CreateTaskRequest, EmployerTaskView } from '@fsp/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { TaskForm } from '@/components/tasks/task-form';
import { PageHeader } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api/client';
import { taskKeys } from '@/lib/task-queries';

export function NewTask() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const create = useMutation({
    mutationFn: ({ input, publish }: { input: CreateTaskRequest; publish: boolean }) => api.post<EmployerTaskView>('/employer/tasks', { ...input, publish }),
    onSuccess: (task) => {
      void queryClient.invalidateQueries({ queryKey: taskKeys.employerAll });
      notify(task.status === 'ACTIVE' ? 'Задание опубликовано' : 'Черновик задания сохранён');
      router.push(`/employer/tasks/${task.id}`);
    },
  });
  return (
    <>
      <PageHeader title="Новое задание" description="Короткое задание на 5–10 минут. Его получат кандидаты с подтверждённой тестом квалификацией в выбранной специализации." />
      <TaskForm loading={create.isPending} serverError={create.error} saveLabel="Сохранить черновик" onSubmit={(input, publish) => create.mutate({ input, publish })} />
    </>
  );
}
