'use client';

import { WORK_FORMAT_LABELS } from '@fsp/contracts';
import clsx from 'clsx';
import Link from 'next/link';
import { useState } from 'react';
import { LinkButton } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { ApplicationStatusBadge } from '@/components/vacancies/status-badges';
import { formatDate, formatSalaryRange } from '@/lib/format';
import { useMyApplications } from '@/lib/vacancy-queries';

export function CandidateApplications() {
  const [tab, setTab] = useState<'ACTIVE' | 'ALL'>('ACTIVE');
  const list = useMyApplications(tab);
  return (
    <>
      <PageHeader
        title="Мои отклики"
        description="Отклики на вакансии и их статусы. Отклик раскрывает выбранные контакты только той компании, которой он адресован."
        actions={<LinkButton href="/candidate/vacancies" variant="outline" size="sm">Смотреть вакансии</LinkButton>}
      />
      <div role="tablist" aria-label="Фильтр откликов" className="mb-4 inline-flex rounded-xl border border-line bg-surface p-1">
        {(['ACTIVE', 'ALL'] as const).map((value) => (
          <button
            key={value}
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={clsx('rounded-lg px-4 py-1.5 text-sm font-medium', tab === value ? 'bg-brand-500 text-white' : 'text-ink-soft hover:bg-canvas')}
          >
            {value === 'ACTIVE' ? 'В работе' : 'Все'}
          </button>
        ))}
      </div>
      {list.isPending ? (
        <LoadingBlock />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <EmptyState
          title={tab === 'ACTIVE' ? 'Нет откликов в работе' : 'Вы ещё не откликались на вакансии'}
          description="Выберите вакансию в общем списке: зарплата и условия видны до отклика."
          action={<LinkButton href="/candidate/vacancies">К вакансиям</LinkButton>}
        />
      ) : (
        <ul className="space-y-3">
          {list.data.items.map((application) => (
            <li key={application.id}>
              <Link href={`/candidate/applications/${application.id}`} className="card flex flex-wrap items-center justify-between gap-4 p-5 transition-colors hover:border-brand-300">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-lg font-bold">{application.vacancyTitle}</span>
                    <ApplicationStatusBadge status={application.status} />
                  </div>
                  <div className="mt-1 text-muted">
                    {application.companyName} · {application.specializationTitle} · {WORK_FORMAT_LABELS[application.workFormat]}
                  </div>
                  <div className="mt-1 text-sm text-muted">Отклик отправлен {formatDate(application.createdAt)}</div>
                </div>
                <div className="text-right">
                  <div className="font-brand text-xl font-bold text-brand-700">{formatSalaryRange(application.salaryFrom, application.salaryTo, false)}</div>
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
