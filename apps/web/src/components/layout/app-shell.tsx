'use client';

import type { MeResponse } from '@fsp/contracts';
import clsx from 'clsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Logo } from './logo';
import { LogoutButton } from './logout-button';
import { MeProvider, useMe } from './me-context';

export interface NavItem {
  href: string;
  label: string;
  /** Совпадение по префиксу пути. */
  match?: string | string[];
  badge?: (me: MeResponse) => number | null;
}

function Nav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const me = useMe();
  return (
    <nav aria-label="Разделы кабинета" className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
      <ul className="flex gap-1 lg:flex-col">
        {items.map((item) => {
          const active = item.match ? [item.match].flat().some((prefix) => pathname.startsWith(prefix)) : pathname === item.href;
          const count = item.badge?.(me) ?? null;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={clsx(
                  'flex items-center justify-between gap-3 whitespace-nowrap rounded-lg px-3 py-2 text-[15px] transition-colors',
                  active ? 'bg-brand-50 font-semibold text-brand-700' : 'text-ink-soft hover:bg-surface',
                )}
              >
                {item.label}
                {count ? (
                  <span className="rounded-full bg-brand-500 px-2 text-xs font-bold leading-5 text-white" aria-label={`новых: ${count}`}>
                    {count}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function Header({ roleLabel }: { roleLabel: string }) {
  const me = useMe();
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-2 px-4 sm:gap-4 sm:px-6">
        <Logo href={me.user.role === 'CANDIDATE' ? '/candidate' : '/employer'} />
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          {me.user.isDemo ? (
            <Badge tone="warning" className="max-sm:hidden">
              Демоаккаунт
            </Badge>
          ) : null}
          <Badge tone="brand">{roleLabel}</Badge>
          <span className="hidden max-w-[220px] truncate text-sm text-muted md:inline" title={me.user.email}>
            {me.user.email}
          </span>
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}

const CANDIDATE_NAV: NavItem[] = [
  { href: '/candidate', label: 'Обзор' },
  { href: '/candidate/profile', label: 'Профиль', match: '/candidate/profile' },
  { href: '/candidate/survey', label: 'Опрос и специализация', match: '/candidate/survey' },
  { href: '/candidate/assessments', label: 'Тестирование', match: '/candidate/assessments' },
  { href: '/candidate/vacancies', label: 'Вакансии', match: '/candidate/vacancies' },
  { href: '/candidate/applications', label: 'Мои отклики', match: '/candidate/applications' },
  { href: '/candidate/tasks', label: 'Короткие задания', match: '/candidate/tasks' },
  {
    href: '/candidate/invitations',
    label: 'Приглашения',
    match: '/candidate/invitations',
    badge: (me) => me.candidate?.newInvitations ?? null,
  },
  { href: '/candidate/settings', label: 'Приватность и ФСП', match: '/candidate/settings' },
];

const EMPLOYER_NAV: NavItem[] = [
  { href: '/employer', label: 'Обзор' },
  { href: '/employer/company', label: 'Компания', match: '/employer/company' },
  { href: '/employer/needs', label: 'Потребности и подборки', match: '/employer/needs' },
  { href: '/employer/candidates', label: 'Банк кандидатов', match: '/employer/candidates' },
  { href: '/employer/bookmarks', label: 'Закладки', match: '/employer/bookmarks' },
  {
    href: '/employer/vacancies',
    label: 'Вакансии и отклики',
    match: ['/employer/vacancies', '/employer/applications'],
    badge: (me) => me.employer?.newApplications ?? null,
  },
  {
    href: '/employer/tasks',
    label: 'Короткие задания',
    match: '/employer/tasks',
    badge: (me) => me.employer?.pendingTaskReviews ?? null,
  },
  { href: '/employer/invitations', label: 'Приглашения', match: '/employer/invitations' },
];

export function AppShell({ me, area, children }: { me: MeResponse; area: 'candidate' | 'employer'; children: ReactNode }) {
  const nav = area === 'candidate' ? CANDIDATE_NAV : EMPLOYER_NAV;
  const roleLabel = area === 'candidate' ? 'Кандидат' : 'Работодатель';
  return (
    <MeProvider initial={me}>
      <Header roleLabel={roleLabel} />
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row lg:gap-8">
        <aside className="lg:w-56 lg:shrink-0">
          <div className="lg:sticky lg:top-24">
            <Nav items={nav} />
          </div>
        </aside>
        <main id="main" className="min-w-0 flex-1 pb-16">
          {children}
        </main>
      </div>
    </MeProvider>
  );
}
