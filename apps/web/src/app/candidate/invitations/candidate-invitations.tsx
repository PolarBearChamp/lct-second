'use client';

import { WORK_FORMAT_LABELS, type InvitationBase, type Paginated } from '@fsp/contracts';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import Link from 'next/link';
import { useState } from 'react';
import { InvitationStatusBadge } from '@/components/invitations/invitation-status';
import { PageHeader } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { api } from '@/lib/api/client';
import { formatDate, formatSalaryRange } from '@/lib/format';

export function CandidateInvitations() {
  const [tab, setTab] = useState<'ACTIVE' | 'ALL'>('ACTIVE');
  const list = useQuery({
    queryKey: ['candidate', 'invitations', tab],
    queryFn: () => api.get<Paginated<InvitationBase>>(`/candidate/invitations?pageSize=50${tab === 'ACTIVE' ? '&status=ACTIVE' : ''}`),
    refetchInterval: 30_000,
  });
  return (
    <>
      <PageHeader
        title="Приглашения"
        description="Работодатели сами выходят на вас с предложением и зарплатой. Контакты раскрываются только компании, чьё приглашение вы примете."
      />
      <div role="tablist" aria-label="Фильтр приглашений" className="mb-4 inline-flex rounded-xl border border-line bg-surface p-1">
        {(['ACTIVE', 'ALL'] as const).map((value) => (
          <button
            key={value}
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={clsx('rounded-lg px-4 py-1.5 text-sm font-medium', tab === value ? 'bg-brand-500 text-white' : 'text-ink-soft hover:bg-canvas')}
          >
            {value === 'ACTIVE' ? 'Ожидают ответа' : 'Все'}
          </button>
        ))}
      </div>
      {list.isPending ? (
        <LoadingBlock />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <EmptyState
          title={tab === 'ACTIVE' ? 'Нет приглашений, ожидающих ответа' : 'Приглашений пока нет'}
          description="Работодатели видят обезличенную карточку с подтверждённым грейдом. Чтобы попасть в подборки, держите профиль опубликованным и актуальным."
        />
      ) : (
        <ul className="space-y-3">
          {list.data.items.map((inv) => (
            <li key={inv.id}>
              <Link href={`/candidate/invitations/${inv.id}`} className="card flex flex-wrap items-center justify-between gap-4 p-5 transition-colors hover:border-brand-300">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-lg font-bold">{inv.title}</span>
                    <InvitationStatusBadge status={inv.status} />
                  </div>
                  <div className="mt-1 text-muted">
                    {inv.companyName}
                    {inv.companyIndustry ? ` · ${inv.companyIndustry}` : ''} · {WORK_FORMAT_LABELS[inv.workFormat]}
                  </div>
                  <div className="mt-1 text-sm text-muted">
                    Получено {formatDate(inv.createdAt)} · действует до {formatDate(inv.expiresAt)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-brand text-xl font-bold text-brand-700">{formatSalaryRange(inv.salaryFrom, inv.salaryTo, false)}</div>
                  <div className="text-xs text-muted">в месяц до вычета налогов</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
