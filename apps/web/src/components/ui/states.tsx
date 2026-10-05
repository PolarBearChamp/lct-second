'use client';

import type { ReactNode } from 'react';
import { ApiError, errorMessage } from '@/lib/api/client';
import { Button, LinkButton } from './button';

export function Spinner({ label = 'Загрузка…' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-muted" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-500 border-r-transparent" aria-hidden />
      <span>{label}</span>
    </span>
  );
}

export function LoadingBlock({ label = 'Загружаем данные…', lines = 3 }: { label?: string; lines?: number }) {
  return (
    <div className="card p-6" aria-busy="true">
      <Spinner label={label} />
      <div className="mt-4 space-y-3" aria-hidden>
        {Array.from({ length: lines }, (_, i) => (
          <div key={i} className="h-4 animate-pulse rounded bg-canvas" style={{ width: `${90 - i * 15}%` }} />
        ))}
      </div>
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-10 text-center">
      <div className="brand-line mb-2 h-10 w-24" aria-hidden />
      <h3 className="text-lg font-bold">{title}</h3>
      {description ? <p className="max-w-lg text-muted">{description}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ error, onRetry, title = 'Не удалось загрузить данные' }: { error: unknown; onRetry?: () => void; title?: string }) {
  if (error instanceof ApiError && error.status === 403) return <ForbiddenState message={error.message} />;
  if (error instanceof ApiError && error.status === 404) {
    return <EmptyState title="Не найдено" description={error.message} action={<LinkButton href="/" variant="outline">На главную</LinkButton>} />;
  }
  return (
    <div className="card border-[#fecdca] p-6" role="alert">
      <h3 className="font-bold text-danger-700">{title}</h3>
      <p className="mt-1 text-sm text-ink-soft">{errorMessage(error)}</p>
      {error instanceof ApiError && error.requestId ? <p className="mt-1 text-xs text-muted">Код запроса: {error.requestId}</p> : null}
      {onRetry ? (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          Повторить
        </Button>
      ) : null}
    </div>
  );
}

export function ForbiddenState({ message = 'У вас нет доступа к этому разделу.' }: { message?: string }) {
  return (
    <div className="card p-6" role="alert">
      <h3 className="text-lg font-bold">Доступ запрещён</h3>
      <p className="mt-1 text-muted">{message}</p>
      <LinkButton href="/" variant="outline" size="sm" className="mt-4">
        На главную
      </LinkButton>
    </div>
  );
}
