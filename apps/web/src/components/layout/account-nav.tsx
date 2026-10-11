'use client';

import type { MeResponse } from '@fsp/contracts';
import clsx from 'clsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useId, useState } from 'react';
import { useMe } from './me-context';

function isActive(item: NavItem, pathname: string) {
  return item.match
    ? [item.match].flat().some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
    : pathname === item.href;
}

export interface NavItem {
  href: string;
  label: string;
  /** Совпадение по префиксу пути. */
  match?: string | string[];
  badge?: (me: MeResponse) => number | null;
}

export function AccountNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const me = useMe();
  const current = items.find((item) => isActive(item, pathname));
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  const expanded = expandedPath === pathname;
  const navId = useId();
  return (
    <>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={navId}
        onClick={() => setExpandedPath(expanded ? null : pathname)}
        className="flex min-h-12 w-full items-center justify-between rounded-xl border border-line bg-surface px-4 text-sm lg:hidden"
      >
        <span><span className="text-muted">Раздел: </span><span className="font-semibold">{current?.label ?? 'Кабинет'}</span></span>
        <span className="ml-3 text-brand-700">{expanded ? 'Закрыть' : 'Меню'}</span>
      </button>
      <nav aria-label="Разделы кабинета" id={navId} className={clsx('mt-2 rounded-xl border border-line bg-surface p-2 lg:mt-0 lg:block lg:border-0 lg:bg-transparent lg:p-0', !expanded && 'hidden')}>
        <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-1">
          {items.map((item) => {
            const active = isActive(item, pathname);
            const count = item.badge?.(me) ?? null;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setExpandedPath(null)}
                  aria-current={active ? 'page' : undefined}
                  className={clsx(
                    'flex items-center justify-between gap-3 rounded-lg min-h-11 px-3 py-2 text-[15px] transition-colors',
                    active ? 'bg-brand-50 font-semibold text-brand-700' : 'text-ink-soft hover:bg-surface',
                  )}
                >
                  {item.label}
                  {count ? (
                    <span className="shrink-0 rounded-full bg-brand-500 px-2 text-xs font-bold leading-5 text-white" aria-label={`новых: ${count}`}>
                      {count}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
