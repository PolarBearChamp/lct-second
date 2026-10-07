'use client';

import type { CandidateTaskView } from '@fsp/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, LinkButton } from '@/components/ui/button';
import { Card, CardHeader, PageHeader } from '@/components/ui/card';
import { Field, Textarea } from '@/components/ui/field';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { AssignmentStatusBadge, VerdictBadge } from '@/components/tasks/task-badges';
import { api, ApiError, errorMessage } from '@/lib/api/client';
import { formatDate, formatDateTime, plural, relativeFromNow } from '@/lib/format';
import { taskKeys, useCandidateTasks } from '@/lib/task-queries';

const MIN_TEXT = 20;
const MAX_TEXT = 2000;

export function CandidateTasks() {
  const tasks = useCandidateTasks();
  const [justSubmitted, setJustSubmitted] = useState<CandidateTaskView | null>(null);
  if (tasks.isPending) return <LoadingBlock lines={4} />;
  if (tasks.isError) return <ErrorState error={tasks.error} onRetry={() => tasks.refetch()} />;
  const { current, history, practice, blocker, blockerMessage, nextOfferAt, intervalDays } = tasks.data;
  return (
    <>
      <PageHeader
        title="Короткие задания"
        description={`Раз в ${intervalDays} ${plural(intervalDays, 'день', 'дня', 'дней')} работодатель может предложить небольшое задание по вашей специализации — на 5–10 минут. Это регулярная практика: подтверждённый грейд и место в подборе от неё не зависят. Ответ увидит только автор задания — под псевдонимом, без ФИО и контактов.`}
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <section aria-label="Текущее задание" className="space-y-6">
          {blocker ? (
            <Alert tone="warning" title="Задания сейчас не предлагаются" actions={<LinkButton href="/candidate/settings" variant="outline">Приватность и ФСП</LinkButton>}>
              {blockerMessage}
            </Alert>
          ) : current ? (
            <TaskCard task={current} onSubmitted={setJustSubmitted} />
          ) : justSubmitted ? null : (
            <EmptyState
              title="Сейчас нет заданий"
              description={
                nextOfferAt
                  ? `Следующее задание можно ожидать ${relativeFromNow(nextOfferAt)} (${formatDate(nextOfferAt)}), если появится подходящее.`
                  : 'Подходящих заданий пока нет. Когда работодатель опубликует задание по вашей специализации, оно появится здесь.'
              }
            />
          )}

          {justSubmitted ? (
            <Alert tone="success" title="Ответ отправлен">
              <HistoryItem task={justSubmitted} open />
            </Alert>
          ) : null}

          <div>
            <h2 className="mb-3 text-lg font-bold">История</h2>
            {history.length === 0 ? (
              <p className="text-muted">Здесь появятся отправленные, пропущенные и истёкшие задания.</p>
            ) : (
              <ul className="space-y-3">
                {history.filter((item) => item.id !== justSubmitted?.id).map((item) => (
                  <li key={item.id}>
                    <HistoryItem task={item} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <aside>
          <Card>
            <CardHeader as="h3" title="Регулярность" />
            <div className="font-brand text-3xl font-bold text-brand-700">{practice.solvedLast90Days}</div>
            <div className="text-sm text-muted">{plural(practice.solvedLast90Days, 'задание решено', 'задания решено', 'заданий решено')} за 90 дней</div>
            <p className="mt-3 text-sm text-muted">
              {practice.lastSubmittedAt ? `Последний ответ: ${formatDate(practice.lastSubmittedAt)}.` : 'Вы ещё не отвечали на задания.'} Подтверждённый тестом грейд по ответам не меняется.
            </p>
          </Card>
        </aside>
      </div>
    </>
  );
}

function TaskCard({ task, onSubmitted }: { task: CandidateTaskView; onSubmitted: (task: CandidateTaskView) => void }) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const [selected, setSelected] = useState<number | null>(null);
  const [text, setText] = useState('');
  const isQuiz = task.task.kind === 'QUIZ';
  const length = text.trim().length;

  const done = (updated: CandidateTaskView) => {
    queryClient.setQueryData(taskKeys.one(updated.id), updated);
    void queryClient.invalidateQueries({ queryKey: taskKeys.overview });
  };
  const submit = useMutation({
    mutationFn: () => api.post<CandidateTaskView>(`/candidate/tasks/${task.id}/submit`, isQuiz ? { selectedIndex: selected } : { answerText: text }),
    onSuccess: (updated) => {
      done(updated);
      onSubmitted(updated);
      notify('Ответ отправлен');
    },
    onError: (error) => {
      // Задание могло истечь или закрыться, пока страница была открыта — перечитываем состояние.
      if (error instanceof ApiError && error.status === 409) void queryClient.invalidateQueries({ queryKey: taskKeys.overview });
    },
  });
  const skip = useMutation({
    mutationFn: () => api.post<CandidateTaskView>(`/candidate/tasks/${task.id}/skip`),
    onSuccess: (updated) => {
      done(updated);
      notify('Задание пропущено', 'info');
    },
    onError: (error) => notify(errorMessage(error), 'danger'),
  });
  const fieldError = submit.error instanceof ApiError ? Object.values(submit.error.fieldErrors)[0]?.[0] : undefined;
  const canSend = isQuiz ? selected !== null : length >= MIN_TEXT && length <= MAX_TEXT;

  return (
    <Card>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Badge tone="brand">{task.task.kindTitle}</Badge>
        <Badge>{task.task.specializationTitle}</Badge>
        <span className="text-sm text-muted">от компании «{task.task.companyName}»</span>
      </div>
      <h2 className="text-xl font-bold">{task.task.title}</h2>
      <p className="mt-2 whitespace-pre-line break-words text-[15px]">{task.task.prompt}</p>
      <p className="mt-2 text-sm text-muted">Ответить можно до {formatDateTime(task.dueAt)}.</p>

      <form
        noValidate
        className="mt-5 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSend) submit.mutate();
        }}
      >
        {isQuiz ? (
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Выберите один вариант</legend>
            <div className="space-y-2">
              {task.task.options.map((option, index) => (
                <label
                  key={index}
                  className={clsx(
                    'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-300',
                    selected === index ? 'border-brand-500 bg-brand-50' : 'border-line hover:border-line-strong',
                  )}
                >
                  <input type="radio" name="option" checked={selected === index} onChange={() => setSelected(index)} className="mt-1 h-4 w-4 shrink-0 accent-brand-500" />
                  <span className="min-w-0 break-words text-[15px]">{option}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : (
          <Field label="Ваш ответ" hint={`От ${MIN_TEXT} до ${MAX_TEXT} символов. Сейчас: ${length}.`} error={fieldError}>
            {(props) => <Textarea {...props} value={text} rows={7} maxLength={MAX_TEXT + 200} onChange={(e) => setText(e.target.value)} />}
          </Field>
        )}
        {submit.isError && !fieldError ? <Alert tone="danger">{errorMessage(submit.error)}</Alert> : null}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" loading={submit.isPending} disabled={!canSend}>
            Отправить ответ
          </Button>
          <Button variant="outline" loading={skip.isPending} onClick={() => skip.mutate()}>
            Пропустить
          </Button>
        </div>
        <p className="text-xs text-muted">Пропуск не влияет на профиль; следующее задание придёт не раньше чем через неделю после этого.</p>
      </form>
    </Card>
  );
}

function HistoryItem({ task, open }: { task: CandidateTaskView; open?: boolean }) {
  const result = task.result;
  return (
    <details className="card group p-4" open={open}>
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2">
        <span className="min-w-0">
          <span className="font-semibold">{task.task.title}</span>
          <span className="ml-2 text-sm text-muted">
            {task.task.companyName} · {formatDate(task.submittedAt ?? task.offeredAt)}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-2">
          {result?.isCorrect === true ? <Badge tone="success">верно</Badge> : null}
          {result?.isCorrect === false ? <Badge tone="warning">неверно</Badge> : null}
          {result?.verdict ? <VerdictBadge verdict={result.verdict} /> : null}
          <AssignmentStatusBadge status={task.status} />
        </span>
      </summary>
      <div className="mt-3 space-y-2 border-t border-line pt-3 text-[15px]">
        <p className="whitespace-pre-line break-words text-ink-soft">{task.task.prompt}</p>
        {result ? (
          <>
            {task.task.kind === 'QUIZ' && result.selectedIndex !== null ? (
              <p>
                Ваш ответ: <span className="font-medium">{task.task.options[result.selectedIndex]}</span>
              </p>
            ) : null}
            {task.task.kind === 'QUIZ' && result.correctIndex !== null && result.isCorrect === false ? (
              <p>
                Верный вариант: <span className="font-medium">{task.task.options[result.correctIndex]}</span>
              </p>
            ) : null}
            {result.answerText ? <p className="whitespace-pre-line break-words rounded-lg bg-canvas p-3">{result.answerText}</p> : null}
            {result.explanation ? <p className="text-sm text-muted">Пояснение: {result.explanation}</p> : null}
            {result.reviewComment ? <p className="text-sm text-muted">Комментарий автора: {result.reviewComment}</p> : null}
            {task.task.kind === 'APPROACH' && !result.verdict ? <p className="text-sm text-muted">Автор задания ещё не оценил ответ.</p> : null}
          </>
        ) : null}
      </div>
    </details>
  );
}
