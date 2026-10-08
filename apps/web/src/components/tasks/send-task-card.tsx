'use client';

import type { TaskAssignmentReceipt } from '@fsp/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button, LinkButton } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Field, Select, Textarea } from '@/components/ui/field';
import { Spinner } from '@/components/ui/states';
import { api, errorMessage } from '@/lib/api/client';
import { formatDate } from '@/lib/format';
import { taskKeys, useEmployerTasks } from '@/lib/task-queries';

/**
 * Адресная отправка короткого задания из карточки кандидата. Задание придёт кандидату отдельно от регулярных (без недельного
 * ограничения); ответ компания увидит под псевдонимом, контакты по-прежнему раскрываются только приглашением или откликом.
 */
export function SendTaskCard({ candidateId, candidateLabel }: { candidateId: string; candidateLabel: string }) {
  const queryClient = useQueryClient();
  const tasks = useEmployerTasks('ACTIVE');
  const [taskId, setTaskId] = useState('');
  const [note, setNote] = useState('');
  const [sent, setSent] = useState<TaskAssignmentReceipt | null>(null);
  const send = useMutation({
    mutationFn: () => api.post<TaskAssignmentReceipt>(`/employer/tasks/${taskId}/assign`, { candidateId, note: note.trim() || undefined }),
    onSuccess: (receipt) => {
      setSent(receipt);
      setNote('');
      void queryClient.invalidateQueries({ queryKey: taskKeys.employerAll });
    },
  });

  return (
    <Card>
      <CardHeader as="h3" title="Короткое задание" description="Отправьте кандидату своё активное задание — например, чтобы проверить навык до приглашения." />
      {tasks.isPending ? (
        <Spinner />
      ) : tasks.isError ? (
        <Alert tone="danger">{errorMessage(tasks.error)}</Alert>
      ) : tasks.data.length === 0 ? (
        <div className="space-y-3 text-sm text-muted">
          <p>Активных заданий нет.</p>
          <LinkButton href="/employer/tasks/new" variant="outline" size="sm">
            Создать задание
          </LinkButton>
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (taskId) send.mutate();
          }}
        >
          <Field label="Задание">
            {(props) => (
              <Select {...props} value={taskId} onChange={(e) => setTaskId(e.target.value)}>
                <option value="">Выберите задание</option>
                {tasks.data.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title} · {t.specializationTitle}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Сообщение кандидату" hint="Необязательно. Видно кандидату вместе с заданием.">
            {(props) => <Textarea {...props} value={note} maxLength={500} rows={2} onChange={(e) => setNote(e.target.value)} />}
          </Field>
          {send.isError ? <Alert tone="danger">{errorMessage(send.error)}</Alert> : null}
          {sent ? (
            <Alert tone="success" title="Задание отправлено">
              {candidateLabel} получит «{sent.taskTitle}» в разделе «Короткие задания»; ответить можно до {formatDate(sent.dueAt)}.{' '}
              <Link href={`/employer/tasks/${sent.taskId}`} className="font-medium text-brand-600 hover:underline">
                К заданию
              </Link>
            </Alert>
          ) : null}
          <Button type="submit" variant="outline" disabled={!taskId} loading={send.isPending}>
            Отправить задание
          </Button>
          <p className="text-xs text-muted">Ответ вы увидите под псевдонимом, без ФИО и контактов. Грейд кандидата задание не меняет.</p>
        </form>
      )}
    </Card>
  );
}
