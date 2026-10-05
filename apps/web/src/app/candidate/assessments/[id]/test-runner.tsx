'use client';

import { GRADE_LABELS, type AttemptResult, type AttemptView, type ItemAnswer, type PartAnswer, type SavedAnswer } from '@fsp/contracts';
import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ContentBlocks } from '@/components/assessment/content-blocks';
import { isPartAnswered, PartInput } from '@/components/assessment/part-input';
import { Alert } from '@/components/ui/alert';
import { Button, LinkButton } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { ErrorState, LoadingBlock } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { api, ApiError, errorMessage } from '@/lib/api/client';
import { formatCountdown } from '@/lib/format';
import { queryKeys, useAttempt } from '@/lib/queries';

const AUTOSAVE_DELAY_MS = 800;

export function TestRunner({ attemptId }: { attemptId: string }) {
  const attempt = useAttempt(attemptId);
  const router = useRouter();
  useEffect(() => {
    if (attempt.data && attempt.data.status !== 'IN_PROGRESS') router.replace(`/candidate/assessments/${attemptId}/result`);
  }, [attempt.data, attemptId, router]);
  if (attempt.isPending) return <LoadingBlock label="Загружаем задания…" lines={8} />;
  if (attempt.isError) return <ErrorState error={attempt.error} onRetry={() => attempt.refetch()} />;
  if (attempt.data.status !== 'IN_PROGRESS') return <LoadingBlock label="Попытка завершена, открываем результат…" />;
  return <Runner initial={attempt.data} />;
}

type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

function Runner({ initial }: { initial: AttemptView }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const items = initial.items;

  // Ответы и номера ревизий. localRevision растёт при каждой правке; savedRevision — последняя принятая сервером.
  const [answers, setAnswers] = useState<Record<string, ItemAnswer>>(() =>
    Object.fromEntries(items.map((item) => [item.id, item.answer ?? { parts: {} }])),
  );
  // Актуальные ответы для отправки из таймеров автосохранения (обновляются синхронно при правке).
  const answersRef = useRef(answers);
  const localRevision = useRef<Record<string, number>>(Object.fromEntries(items.map((item) => [item.id, item.revision])));
  const savedRevision = useRef<Record<string, number>>(Object.fromEntries(items.map((item) => [item.id, item.revision])));
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const inFlight = useRef<Record<string, boolean>>({});
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({});
  const [current, setCurrent] = useState(0);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [conflictNotice, setConflictNotice] = useState<string | null>(null);

  // Серверный таймер: сдвиг между часами сервера и клиента фиксируется при загрузке.
  const [clockOffset] = useState(() => new Date(initial.serverNow).getTime() - Date.now());
  const expiresAt = new Date(initial.expiresAt).getTime();
  const [remaining, setRemaining] = useState(() => expiresAt - (Date.now() + clockOffset));
  useEffect(() => {
    const tick = setInterval(() => setRemaining(expiresAt - (Date.now() + clockOffset)), 1000);
    return () => clearInterval(tick);
  }, [expiresAt, clockOffset]);
  const expired = remaining <= 0;

  const goToResult = useCallback(
    (result?: AttemptResult) => {
      if (result) queryClient.setQueryData(queryKeys.result(initial.id), result);
      void queryClient.invalidateQueries({ queryKey: ['candidate'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      router.replace(`/candidate/assessments/${initial.id}/result`);
    },
    [initial.id, queryClient, router],
  );

  const flushItem = useCallback(
    async (itemId: string): Promise<void> => {
      if (inFlight.current[itemId]) return; // повторная отправка произойдёт после завершения текущей
      const revision = localRevision.current[itemId];
      if (revision <= savedRevision.current[itemId]) return;
      inFlight.current[itemId] = true;
      setSaveState((s) => ({ ...s, [itemId]: 'saving' }));
      try {
        const saved = await api.put<SavedAnswer>(`/candidate/assessments/${initial.id}/answers/${itemId}`, {
          answer: answersRef.current[itemId],
          revision,
        });
        savedRevision.current[itemId] = Math.max(savedRevision.current[itemId], saved.revision);
        setSaveState((s) => ({ ...s, [itemId]: 'saved' }));
      } catch (error) {
        if (error instanceof ApiError && error.code === 'STALE_REVISION') {
          const serverCurrent = error.details?.current as { revision: number; answer: ItemAnswer } | null;
          if (serverCurrent && serverCurrent.revision > localRevision.current[itemId]) {
            // На сервере более новая версия (например, из другой вкладки) — показываем принятый сервером вариант.
            localRevision.current[itemId] = serverCurrent.revision;
            savedRevision.current[itemId] = serverCurrent.revision;
            answersRef.current = { ...answersRef.current, [itemId]: serverCurrent.answer };
            setAnswers(answersRef.current);
            setConflictNotice('Ответ обновлён до более новой версии с сервера — возможно, тест открыт в другой вкладке.');
          } else if (serverCurrent) {
            savedRevision.current[itemId] = Math.max(savedRevision.current[itemId], serverCurrent.revision);
          }
          setSaveState((s) => ({ ...s, [itemId]: 'saved' }));
        } else if (error instanceof ApiError && (error.code === 'ATTEMPT_EXPIRED' || error.code === 'ATTEMPT_NOT_ACTIVE')) {
          goToResult();
        } else {
          setSaveState((s) => ({ ...s, [itemId]: 'error' }));
        }
      } finally {
        inFlight.current[itemId] = false;
        if (localRevision.current[itemId] > savedRevision.current[itemId] && !timers.current[itemId]) {
          timers.current[itemId] = setTimeout(() => {
            delete timers.current[itemId];
            void flushItem(itemId);
          }, AUTOSAVE_DELAY_MS);
        }
      }
    },
    [goToResult, initial.id],
  );

  const updatePart = (itemId: string, partId: string, partAnswer: PartAnswer | null) => {
    if (expired) return;
    const prev = answersRef.current;
    const nextParts = { ...prev[itemId].parts };
    if (partAnswer) nextParts[partId] = partAnswer;
    else delete nextParts[partId];
    const next = { ...prev, [itemId]: { parts: nextParts } };
    answersRef.current = next;
    setAnswers(next);
    localRevision.current[itemId] += 1;
    setSaveState((s) => ({ ...s, [itemId]: 'pending' }));
    clearTimeout(timers.current[itemId]);
    timers.current[itemId] = setTimeout(() => {
      delete timers.current[itemId];
      void flushItem(itemId);
    }, AUTOSAVE_DELAY_MS);
  };

  useEffect(() => {
    const pending = timers.current;
    return () => Object.values(pending).forEach(clearTimeout);
  }, []);

  // Предупреждение при закрытии вкладки с несохранёнными ответами.
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (items.some((item) => localRevision.current[item.id] > savedRevision.current[item.id])) event.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [items]);

  const totalParts = items.reduce((sum, item) => sum + item.task.parts.length, 0);
  const answeredParts = items.reduce(
    (sum, item) => sum + item.task.parts.filter((part) => isPartAnswered(part, answers[item.id]?.parts[part.id])).length,
    0,
  );

  const submit = async () => {
    setFinishing(true);
    Object.values(timers.current).forEach(clearTimeout);
    timers.current = {};
    // Синхронно передаём все ещё не принятые сервером ответы вместе с завершением — последняя правка не теряется.
    const finalAnswers = items
      .filter((item) => localRevision.current[item.id] > savedRevision.current[item.id])
      .map((item) => ({ itemId: item.id, answer: answersRef.current[item.id], revision: localRevision.current[item.id] }));
    try {
      const result = await api.post<AttemptResult>(`/candidate/assessments/${initial.id}/submit`, { answers: finalAnswers });
      goToResult(result);
    } catch (error) {
      setFinishing(false);
      setConfirmSubmit(false);
      notify(errorMessage(error), 'danger');
    }
  };

  const abandon = async () => {
    setFinishing(true);
    try {
      await api.post(`/candidate/assessments/${initial.id}/abandon`);
      goToResult();
    } catch (error) {
      setFinishing(false);
      notify(errorMessage(error), 'danger');
    }
  };

  const item = items[current];
  const lowTime = remaining > 0 && remaining < 5 * 60_000;
  const unsavedCount = items.filter((it) => saveState[it.id] === 'pending' || saveState[it.id] === 'saving').length;
  const errorCount = items.filter((it) => saveState[it.id] === 'error').length;

  return (
    <div className="space-y-4">
      <div className="sticky top-16 z-20 -mx-1 rounded-xl border border-line bg-surface/95 px-4 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm text-muted">
              {initial.specializationTitle} · уровень {GRADE_LABELS[initial.grade]}
            </div>
            <div className="text-sm">
              Отвечено частей: <strong className="font-brand">{answeredParts}</strong> из {totalParts}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div
              className={clsx('rounded-lg px-3 py-1.5 font-brand text-lg font-bold', expired ? 'bg-danger-50 text-danger-700' : lowTime ? 'bg-warning-50 text-warning-700' : 'bg-brand-50 text-brand-700')}
              role="timer"
              aria-label="Оставшееся время"
            >
              {expired ? '00:00' : formatCountdown(remaining)}
            </div>
            <span className="hidden text-sm text-muted sm:inline" aria-live="polite">
              {errorCount ? 'Ошибка сохранения — повторим автоматически' : unsavedCount ? 'Сохраняем…' : 'Ответы сохранены'}
            </span>
          </div>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-canvas" aria-hidden>
          <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${(answeredParts / totalParts) * 100}%` }} />
        </div>
        {lowTime ? (
          <p className="mt-2 text-sm font-medium text-warning-700" role="status">
            Осталось меньше 5 минут.
          </p>
        ) : null}
      </div>

      {expired ? (
        <Alert tone="danger" title="Время истекло" actions={<Button onClick={() => goToResult()}>Посмотреть результат</Button>}>
          Попытка будет зафиксирована как «Время истекло». Баллы по сохранённым ответам покажем для обратной связи; квалификация не выдаётся.
        </Alert>
      ) : null}
      {conflictNotice ? (
        <Alert tone="warning" actions={<Button size="sm" variant="outline" onClick={() => setConflictNotice(null)}>Понятно</Button>}>
          {conflictNotice}
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <nav aria-label="Кейсы теста" className="card h-fit p-3">
          <ol className="space-y-1">
            {items.map((it, index) => {
              const answered = it.task.parts.filter((part) => isPartAnswered(part, answers[it.id]?.parts[part.id])).length;
              return (
                <li key={it.id}>
                  <button
                    type="button"
                    onClick={() => setCurrent(index)}
                    aria-current={index === current ? 'step' : undefined}
                    className={clsx('w-full rounded-lg px-3 py-2 text-left transition-colors', index === current ? 'bg-brand-50' : 'hover:bg-canvas')}
                  >
                    <span className="flex items-center justify-between gap-2 text-sm">
                      <span className="font-brand font-bold text-brand-600">Кейс {index + 1}</span>
                      <span className={clsx('text-xs', answered === it.task.parts.length ? 'text-success-700' : 'text-muted')}>
                        {answered}/{it.task.parts.length}
                      </span>
                    </span>
                    <span className="block truncate text-[13px] text-muted">{it.groupTitle}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <article className="card p-5 sm:p-6" aria-labelledby="case-title">
          <div className="mb-1 text-sm text-muted">
            Кейс {current + 1} из {items.length} · {item.groupTitle}
          </div>
          <h1 id="case-title" className="mb-4 text-xl font-bold">
            {item.task.title}
          </h1>
          <ContentBlocks blocks={item.task.context} />
          <div className="mt-6 space-y-4">
            {item.task.parts.map((part, index) => (
              <PartInput
                key={part.id}
                part={part}
                index={index}
                answer={answers[item.id]?.parts[part.id]}
                disabled={expired || finishing}
                onChange={(partAnswer) => updatePart(item.id, part.id, partAnswer)}
              />
            ))}
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setCurrent(Math.max(0, current - 1))} disabled={current === 0}>
                ← Предыдущий
              </Button>
              <Button variant="outline" onClick={() => setCurrent(Math.min(items.length - 1, current + 1))} disabled={current === items.length - 1}>
                Следующий →
              </Button>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setConfirmAbandon(true)} disabled={finishing || expired}>
                Прервать
              </Button>
              <Button onClick={() => setConfirmSubmit(true)} disabled={finishing || expired}>
                Завершить тест
              </Button>
            </div>
          </div>
        </article>
      </div>

      <ConfirmDialog
        open={confirmSubmit}
        title="Завершить тест?"
        confirmLabel="Завершить и получить результат"
        loading={finishing}
        onClose={() => setConfirmSubmit(false)}
        onConfirm={submit}
      >
        <p>
          Отвечено частей: <strong>{answeredParts}</strong> из {totalParts}. После завершения изменить ответы нельзя.
        </p>
        {answeredParts < totalParts ? <Alert tone="warning">Неотвеченные части оцениваются в 0 баллов.</Alert> : null}
      </ConfirmDialog>
      <ConfirmDialog
        open={confirmAbandon}
        title="Прервать попытку?"
        tone="danger"
        confirmLabel="Прервать без результата"
        loading={finishing}
        onClose={() => setConfirmAbandon(false)}
        onConfirm={abandon}
      >
        <p>Попытка получит статус «Прерван», квалификация не выдаётся. Повторить этот уровень можно будет только через 24 часа — как после неуспешной попытки.</p>
        <p>Если нужно сделать паузу — просто закройте страницу: таймер продолжит идти, вернуться можно до его окончания.</p>
      </ConfirmDialog>
      <p className="text-center text-xs text-muted">
        <LinkButton href="/candidate/assessments" variant="ghost" size="sm">
          Вернуться к обзору тестирования (таймер продолжит идти)
        </LinkButton>
      </p>
    </div>
  );
}
