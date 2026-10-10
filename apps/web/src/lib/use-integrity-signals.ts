'use client';

import { useCallback, useEffect, useRef } from 'react';
import { api, ApiError } from '@/lib/api/client';

/** Как часто накопленные счётчики уходят на сервер, пока идёт тест. */
const FLUSH_INTERVAL_MS = 20_000;

interface Counters {
  tabHiddenCount: number;
  tabHiddenMs: number;
  pasteCount: number;
  copyCount: number;
  focusLossCount: number;
}

/** Верхние границы одного пакета — те же, что в DTO сервера (остаток уйдёт со следующим пакетом). */
const BATCH_LIMITS: Counters = {
  tabHiddenCount: 50,
  tabHiddenMs: 1_800_000,
  pasteCount: 50,
  copyCount: 50,
  focusLossCount: 100,
};

const empty = (): Counters => ({
  tabHiddenCount: 0,
  tabHiddenMs: 0,
  pasteCount: 0,
  copyCount: 0,
  focusLossCount: 0,
});
const isEmpty = (c: Counters) => Object.values(c).every((v) => v === 0);

const isTextField = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement || target.isContentEditable);

/**
 * Сигналы честности прохождения теста (ответ организаторов FTT.4): сколько раз скрывалась вкладка, сколько было вставок
 * в поля ответа и копирований текста задания. Передаются только счётчики, без содержимого. Сигналы информационные:
 * на баллы и грейд не влияют, об этом кандидат предупреждён до старта. Ошибки отправки молча игнорируются —
 * тест из-за них прерываться не должен.
 */
export function useIntegritySignals(attemptId: string, enabled: boolean): { flush: () => Promise<void> } {
  const pending = useRef<Counters>(empty());
  const sending = useRef<Promise<void> | null>(null);
  const active = useRef(enabled);

  const flush = useCallback(async (): Promise<void> => {
    if (sending.current) await sending.current;
    if (!active.current || isEmpty(pending.current)) return;
    const batch = { ...empty() };
    for (const key of Object.keys(batch) as Array<keyof Counters>) {
      batch[key] = Math.min(pending.current[key], BATCH_LIMITS[key]);
      pending.current[key] -= batch[key];
    }
    const request = api
      .post<void>(`/candidate/assessments/${attemptId}/signals`, batch)
      .catch((error: unknown) => {
        // Попытка завершена или лимит исчерпан — досылать нечего; при сетевой ошибке возвращаем счётчики в очередь.
        if (error instanceof ApiError && error.status !== 0) {
          if (error.status === 409 || error.status === 429) active.current = false;
          return;
        }
        for (const key of Object.keys(batch) as Array<keyof Counters>) pending.current[key] += batch[key];
      })
      .finally(() => {
        sending.current = null;
      });
    sending.current = request;
    await request;
  }, [attemptId]);

  useEffect(() => {
    active.current = enabled;
    if (!enabled) return;
    let hiddenSince: number | null = document.visibilityState === 'hidden' ? Date.now() : null;

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (hiddenSince === null) {
          hiddenSince = Date.now();
          pending.current.tabHiddenCount += 1;
        }
      } else if (hiddenSince !== null) {
        pending.current.tabHiddenMs += Math.max(0, Date.now() - hiddenSince);
        hiddenSince = null;
        void flush();
      }
    };
    const onBlur = () => {
      pending.current.focusLossCount += 1;
    };
    const onPaste = (event: ClipboardEvent) => {
      if (isTextField(event.target)) pending.current.pasteCount += 1;
    };
    // Копирование текста задания: выделение вне полей ввода (копирование собственного ответа не считаем).
    const onCopy = (event: ClipboardEvent) => {
      if (!isTextField(event.target) && (window.getSelection()?.toString().length ?? 0) > 0) pending.current.copyCount += 1;
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    document.addEventListener('paste', onPaste, true);
    document.addEventListener('copy', onCopy, true);
    const timer = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('paste', onPaste, true);
      document.removeEventListener('copy', onCopy, true);
      void flush();
    };
  }, [enabled, flush]);

  return { flush };
}
