import clsx from 'clsx';

/** Горизонтальная шкала балла 0..100 с отметкой порога. */
export function ScoreBar({ label, score, threshold, compact }: { label: string; score: number; threshold?: number; compact?: boolean }) {
  const tone = threshold === undefined ? 'bg-brand-500' : score >= threshold ? 'bg-brand-500' : 'bg-warning-600';
  return (
    <div className={clsx(compact ? 'space-y-1' : 'space-y-1.5')}>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 text-ink-soft">{label}</span>
        <span className="font-brand font-bold">{score}</span>
      </div>
      <div
        className="relative h-2 overflow-hidden rounded-full bg-canvas"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={score}
      >
        <div className={clsx('h-full rounded-full', tone)} style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
        {threshold !== undefined ? (
          <div className="absolute top-0 h-full w-0.5 bg-ink/60" style={{ left: `${threshold}%` }} title={`Порог ${threshold}`} aria-hidden />
        ) : null}
      </div>
    </div>
  );
}

export function BigScore({ score, caption }: { score: number | null; caption: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="font-brand text-5xl font-bold text-brand-600">{score ?? '—'}</span>
      <span className="text-muted">{caption}</span>
    </div>
  );
}
