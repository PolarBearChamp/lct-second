'use client';

import { GRADE_LABELS, TASK_VERDICT_LABELS, TASK_VERDICTS, type EmployerTaskView, type TaskSubmissionItem, type TaskVerdict } from '@fsp/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import Link from 'next/link';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, LinkButton } from '@/components/ui/button';
import { Card, CardHeader, DefinitionList, PageHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { ChoiceGroup, Field, Textarea } from '@/components/ui/field';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { TaskStatusBadge, VerdictBadge } from '@/components/tasks/task-badges';
import { api, errorMessage } from '@/lib/api/client';
import { formatDate, formatDateTime } from '@/lib/format';
import { taskKeys, useEmployerTask, useTaskSubmissions } from '@/lib/task-queries';

export function TaskDetail({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const task = useEmployerTask(id);
  const [pendingOnly, setPendingOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [closeOpen, setCloseOpen] = useState(false);
  const [reviewing, setReviewing] = useState<TaskSubmissionItem | null>(null);
  const hasAnswers = (task.data?.submittedCount ?? 0) > 0;
  const submissions = useTaskSubmissions(id, pendingOnly, page, hasAnswers);

  const onChanged = (data: EmployerTaskView) => {
    queryClient.setQueryData(taskKeys.employerOne(id), data);
    void queryClient.invalidateQueries({ queryKey: taskKeys.employerAll });
  };
  const publish = useMutation({
    mutationFn: () => api.post<EmployerTaskView>(`/employer/tasks/${id}/publish`),
    onSuccess: (data) => {
      onChanged(data);
      notify('Задание опубликовано: оно будет предлагаться подходящим кандидатам');
    },
    onError: (error) => notify(errorMessage(error), 'danger'),
  });
  const close = useMutation({
    mutationFn: () => api.post<EmployerTaskView>(`/employer/tasks/${id}/close`),
    onSuccess: (data) => {
      onChanged(data);
      setCloseOpen(false);
      notify('Задание закрыто: новые предложения не создаются', 'info');
    },
    onError: (error) => notify(errorMessage(error), 'danger'),
  });

  if (task.isPending) return <LoadingBlock lines={5} />;
  if (task.isError) return <ErrorState error={task.error} onRetry={() => task.refetch()} />;
  const t = task.data;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/employer/tasks" className="hover:underline">
            ← Все задания
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {t.title}
            <TaskStatusBadge status={t.status} />
          </span>
        }
        actions={
          t.status === 'DRAFT' ? (
            <>
              <LinkButton href={`/employer/tasks/${id}/edit`} variant="outline" size="sm">
                Редактировать
              </LinkButton>
              <Button size="sm" loading={publish.isPending} onClick={() => publish.mutate()}>
                Опубликовать
              </Button>
            </>
          ) : t.status === 'ACTIVE' ? (
            <Button size="sm" variant="outline" onClick={() => setCloseOpen(true)}>
              Закрыть задание
            </Button>
          ) : null
        }
      />
      {t.status === 'DRAFT' ? <Alert tone="warning" title="Это черновик: кандидаты задание не получают">Опубликуйте его, чтобы оно начало предлагаться.</Alert> : null}
      {t.status === 'CLOSED' ? <Alert tone="neutral" title="Задание закрыто">Новые предложения не создаются; отправленные ответы остаются здесь.</Alert> : null}

      <div className="mt-4 grid gap-6 xl:grid-cols-[1fr_380px]">
        <section aria-label="Ответы" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold">Ответы кандидатов</h2>
            {t.kind === 'APPROACH' && hasAnswers ? (
              <div role="tablist" aria-label="Фильтр ответов" className="inline-flex rounded-xl border border-line bg-surface p-1">
                {([false, true] as const).map((value) => (
                  <button
                    key={String(value)}
                    role="tab"
                    aria-selected={pendingOnly === value}
                    onClick={() => {
                      setPendingOnly(value);
                      setPage(1);
                    }}
                    className={clsx('rounded-lg px-3 py-1 text-sm font-medium', pendingOnly === value ? 'bg-brand-500 text-white' : 'text-ink-soft hover:bg-canvas')}
                  >
                    {value ? `Ждут оценки${t.pendingReviewCount ? ` (${t.pendingReviewCount})` : ''}` : 'Все'}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {!hasAnswers ? (
            <EmptyState
              title="Ответов пока нет"
              description={t.status === 'ACTIVE' ? 'Задание предлагается кандидатам с подходящей квалификацией не чаще раза в неделю каждому — первые ответы появятся не сразу.' : 'Ответы появятся после публикации задания.'}
            />
          ) : submissions.isPending ? (
            <LoadingBlock />
          ) : submissions.isError ? (
            <ErrorState error={submissions.error} onRetry={() => submissions.refetch()} />
          ) : (
            <>
              {submissions.data.quiz ? (
                <p className="text-sm text-muted">
                  Верно ответили {submissions.data.quiz.correct} из {submissions.data.quiz.answered}.
                </p>
              ) : null}
              {submissions.data.items.length === 0 ? (
                <EmptyState title="Ответов без оценки нет" />
              ) : (
                <ol className="space-y-3">
                  {submissions.data.items.map((item) => (
                    <li key={item.id} className="card p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-bold">Кандидат {item.candidateAlias}</span>
                            {item.confirmedGradeTitle ? <Badge tone="info">грейд по тесту: {item.confirmedGradeTitle}</Badge> : <Badge tone="warning">грейд не подтверждён</Badge>}
                            {item.source === 'DIRECT' ? <Badge>отправлено лично</Badge> : null}
                            {t.kind === 'QUIZ' ? (
                              <Badge tone={item.isCorrect ? 'success' : 'warning'}>{item.isCorrect ? 'верно' : 'неверно'}</Badge>
                            ) : item.verdict ? (
                              <VerdictBadge verdict={item.verdict} />
                            ) : (
                              <Badge tone="brand">ждёт оценки</Badge>
                            )}
                          </div>
                          <div className="mt-1 text-sm text-muted">ответ отправлен {formatDateTime(item.submittedAt)}</div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {t.kind === 'APPROACH' ? (
                            <Button size="sm" variant={item.verdict ? 'outline' : 'primary'} onClick={() => setReviewing(item)}>
                              {item.verdict ? 'Изменить оценку' : 'Оценить'}
                            </Button>
                          ) : null}
                          <LinkButton href={`/employer/candidates/${item.candidateId}`} size="sm" variant="outline">
                            Карточка кандидата
                          </LinkButton>
                        </div>
                      </div>
                      {t.kind === 'QUIZ' && item.selectedIndex !== null ? (
                        <p className="mt-3 text-[15px]">
                          Выбран вариант: <span className="font-medium">{t.options[item.selectedIndex]}</span>
                        </p>
                      ) : null}
                      {item.answerText ? <p className="mt-3 whitespace-pre-line break-words rounded-lg bg-canvas p-3 text-[15px]">{item.answerText}</p> : null}
                      {item.reviewComment ? <p className="mt-2 text-sm text-muted">Ваш комментарий: {item.reviewComment}</p> : null}
                    </li>
                  ))}
                </ol>
              )}
              {submissions.data.total > submissions.data.pageSize ? (
                <div className="flex items-center justify-between">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                    ← Назад
                  </Button>
                  <span className="text-sm text-muted">
                    Страница {page} из {Math.ceil(submissions.data.total / submissions.data.pageSize)}
                  </span>
                  <Button variant="outline" size="sm" disabled={page * submissions.data.pageSize >= submissions.data.total} onClick={() => setPage(page + 1)}>
                    Далее →
                  </Button>
                </div>
              ) : null}
              <p className="text-xs text-muted">
                Ответы показаны под псевдонимом: ФИО и контакты скрыты. Чтобы связаться с кандидатом, отправьте приглашение из карточки — контакты раскроются только после его согласия.
              </p>
            </>
          )}
        </section>

        <aside className="space-y-6">
          <Card>
            <CardHeader as="h3" title="Условие" description={`${t.kindTitle} · изменено ${formatDate(t.updatedAt)}`} />
            <p className="whitespace-pre-line break-words text-[15px] text-ink-soft">{t.prompt}</p>
            {t.kind === 'QUIZ' ? (
              <ol className="mt-4 space-y-1.5 text-[15px]">
                {t.options.map((option, index) => (
                  <li key={index} className={clsx('rounded-lg border px-3 py-1.5', index === t.correctIndex ? 'border-success-600 bg-success-50' : 'border-line')}>
                    {option}
                    {index === t.correctIndex ? <span className="ml-2 text-xs font-semibold text-success-700">верный</span> : null}
                  </li>
                ))}
              </ol>
            ) : null}
            {t.explanation ? <p className="mt-3 text-sm text-muted">Пояснение для кандидата: {t.explanation}</p> : null}
          </Card>
          <Card>
            <CardHeader as="h3" title="Кому предлагается" />
            <DefinitionList
              items={[
                { term: 'Специализация', value: t.specializationTitle },
                { term: 'Грейды', value: t.allowedGrades.length ? t.allowedGrades.map((g) => GRADE_LABELS[g]).join(', ') : 'любой подтверждённый' },
                { term: 'Срок', value: t.deadlineAt ? formatDate(t.deadlineAt) : 'не ограничен' },
                { term: 'Опубликовано', value: t.publishedAt ? formatDate(t.publishedAt) : '—' },
                { term: 'Предложено', value: t.offeredCount },
                { term: 'Ответов', value: t.submittedCount },
              ]}
            />
            <p className="mt-3 text-xs text-muted">
              Задание получают кандидаты, которых видят работодатели: с согласием на публикацию и подтверждённой тестом квалификацией. Не чаще одного задания в неделю на кандидата.
            </p>
          </Card>
        </aside>
      </div>

      <ConfirmDialog open={closeOpen} title="Закрыть задание?" confirmLabel="Закрыть" tone="danger" loading={close.isPending} onClose={() => setCloseOpen(false)} onConfirm={() => close.mutate()}>
        <p>Задание перестанет предлагаться кандидатам, а неотвеченные предложения истекут. Уже отправленные ответы останутся. Снова открыть закрытое задание нельзя — создайте новое.</p>
      </ConfirmDialog>
      {reviewing ? (
        <ReviewDialog
          key={reviewing.id}
          item={reviewing}
          onClose={() => setReviewing(null)}
          onDone={() => {
            setReviewing(null);
            void queryClient.invalidateQueries({ queryKey: taskKeys.submissionsAll });
            void queryClient.invalidateQueries({ queryKey: taskKeys.employerAll });
            void queryClient.invalidateQueries({ queryKey: taskKeys.employerOne(id) });
            void queryClient.invalidateQueries({ queryKey: ['me'] });
            notify('Оценка сохранена: кандидат увидит её и комментарий');
          }}
        />
      ) : null}
    </>
  );
}

function ReviewDialog({ item, onClose, onDone }: { item: TaskSubmissionItem; onClose: () => void; onDone: () => void }) {
  const [verdict, setVerdict] = useState<TaskVerdict | null>(item.verdict);
  const [comment, setComment] = useState(item.reviewComment ?? '');
  const review = useMutation({
    mutationFn: () => api.post<TaskSubmissionItem>(`/employer/task-submissions/${item.id}/review`, { verdict, comment: comment.trim() || null }),
    onSuccess: onDone,
  });
  return (
    <ConfirmDialog open title={`Оценка ответа кандидата ${item.candidateAlias}`} confirmLabel="Сохранить оценку" loading={review.isPending} confirmDisabled={!verdict} onClose={onClose} onConfirm={() => review.mutate()}>
      <p className="whitespace-pre-line break-words rounded-lg bg-canvas p-3 text-[15px] text-ink">{item.answerText}</p>
      <ChoiceGroup
        legend="Оценка"
        name="verdict"
        columns={3}
        options={TASK_VERDICTS.map((v) => ({ value: v, label: TASK_VERDICT_LABELS[v] }))}
        value={verdict ? [verdict] : []}
        onChange={(next) => setVerdict(next[0] ?? null)}
      />
      <Field label="Комментарий кандидату" hint="Необязательно. Кандидат увидит оценку и комментарий.">
        {(props) => <Textarea {...props} value={comment} maxLength={500} rows={3} onChange={(e) => setComment(e.target.value)} />}
      </Field>
      {review.isError ? <Alert tone="danger">{errorMessage(review.error)}</Alert> : null}
    </ConfirmDialog>
  );
}
