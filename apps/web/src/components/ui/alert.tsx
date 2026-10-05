import clsx from 'clsx';
import type { ReactNode } from 'react';
import type { Tone } from './badge';

const tones: Record<Exclude<Tone, 'neutral' | 'brand'> | 'brand' | 'neutral', string> = {
  neutral: 'border-line bg-surface',
  brand: 'border-brand-200 bg-brand-50',
  success: 'border-[#abefc6] bg-success-50',
  warning: 'border-[#fedf89] bg-warning-50',
  danger: 'border-[#fecdca] bg-danger-50',
  info: 'border-[#b2ddff] bg-info-50',
};

export function Alert({
  tone = 'info',
  title,
  children,
  actions,
  className,
  role,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
  role?: 'alert' | 'status';
}) {
  return (
    <div role={role ?? (tone === 'danger' ? 'alert' : 'status')} className={clsx('rounded-xl border px-4 py-3', tones[tone], className)}>
      {title ? <div className="font-semibold">{title}</div> : null}
      {children ? <div className={clsx('text-sm text-ink-soft', title && 'mt-1')}>{children}</div> : null}
      {actions ? <div className="mt-3 flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
