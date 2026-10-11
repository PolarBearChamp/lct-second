'use client';

import type { MeResponse } from '@fsp/contracts';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { AccountNav, type NavItem } from './account-nav';
import { Logo } from './logo';
import { LogoutButton } from './logout-button';
import { MeProvider, useMe } from './me-context';


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
  const nav = area === 'candidate' ? CANDIDATE_NAV : EMPLOYER_NAV;
  const roleLabel = area === 'candidate' ? 'Кандидат' : 'Работодатель';
  return (
    <MeProvider initial={me}>
      <Header roleLabel={roleLabel} />
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row lg:gap-8">
        <aside className="lg:w-56 lg:shrink-0">
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
