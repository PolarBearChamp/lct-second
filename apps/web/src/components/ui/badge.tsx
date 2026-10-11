import clsx from 'clsx';
import type { ReactNode } from 'react';

export type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

const tones: Record<Tone, string> = {
  neutral: 'bg-canvas text-ink-soft border-line',
  brand: 'bg-brand-50 text-brand-700 border-brand-200',
  success: 'bg-success-50 text-success-700 border-[#abefc6]',
  warning: 'bg-warning-50 text-warning-700 border-[#fedf89]',
  danger: 'bg-danger-50 text-danger-700 border-[#fecdca]',
  info: 'bg-info-50 text-info-700 border-[#b2ddff]',
};

export function Badge({ tone = 'neutral', children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={clsx('inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-0.5 text-[13px] font-medium leading-5 break-words', tones[tone], className)}
    >
      {children}
    </span>
  );
}
