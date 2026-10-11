'use client';

import type { MeResponse } from '@fsp/contracts';
import { useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AccountNav, type NavItem } from './account-nav';
import { Logo } from './logo';
import { LogoutButton } from './logout-button';
import { MeProvider, useMe } from './me-context';


function Header({ roleLabel, focusMode, collapsed, onToggle }: { roleLabel: string; focusMode: boolean; collapsed: boolean; onToggle: () => void }) {
  const me = useMe();
  return (
    <header className="sticky top-0 z-30 border-b border-white/20 bg-ink">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-2 px-4 sm:gap-4 sm:px-6">
        <div className="flex items-center gap-3">
          {!focusMode ? <div className="hidden lg:block"><Button variant="ghost" size="sm" className="text-white hover:bg-white/10" aria-expanded={!collapsed} aria-controls="workspace-menu" onClick={onToggle}>{collapsed ? 'Меню' : 'Скрыть меню'}</Button></div> : null}
          <Logo href={me.user.role === 'CANDIDATE' ? '/candidate' : '/employer'} dark />
        </div>
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          {me.user.isDemo ? (
            <Badge tone="warning" className="max-sm:hidden">
              Демоаккаунт
            </Badge>
          ) : null}
          <Badge tone="brand">{focusMode ? 'Тестирование' : roleLabel}</Badge>
          <span className="hidden max-w-[220px] truncate text-sm text-white/70 md:inline" title={me.user.email}>
            {me.user.email}
          </span>
          <LogoutButton className="text-white hover:bg-white/10" />
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
  {
    href: '/candidate/tasks',
    label: 'Короткие задания',
    match: '/candidate/tasks',
    badge: (me) => me.candidate?.pendingDirectTasks ?? null,
  },
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
  const pathname = usePathname();
  const focusMode = area === 'candidate' && /^\/candidate\/assessments\/[^/]+$/.test(pathname);
  const [collapsed, setCollapsed] = useState(false);
  const nav = area === 'candidate' ? CANDIDATE_NAV : EMPLOYER_NAV;
  const roleLabel = area === 'candidate' ? 'Кандидат' : 'Работодатель';
  return (
    <MeProvider initial={me}>
      <Header roleLabel={roleLabel} focusMode={focusMode} collapsed={collapsed} onToggle={() => setCollapsed((value) => !value)} />
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row lg:gap-8">
        <aside id="workspace-menu" className={clsx('lg:w-56 lg:shrink-0', focusMode && 'hidden', !focusMode && collapsed && 'lg:hidden')}>
          <div className="lg:sticky lg:top-24">
            <AccountNav items={nav} />
          </div>
        </aside>
        <main id="main" className="min-w-0 flex-1 pb-16">
          {children}
        </main>
      </div>
    </MeProvider>
  );
}
