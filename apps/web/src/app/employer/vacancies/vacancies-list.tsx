'use client';

import { GRADE_LABELS, WORK_FORMAT_LABELS } from '@fsp/contracts';
import clsx from 'clsx';
import Link from 'next/link';
import { useState } from 'react';
import { useMe } from '@/components/layout/me-context';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { LinkButton } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { VacancyStatusBadge } from '@/components/vacancies/status-badges';
import { formatDate, formatSalaryRange } from '@/lib/format';
import { useEmployerVacancies } from '@/lib/vacancy-queries';

const TABS = [
  { value: 'ALL', label: 'Все' },
  { value: 'PUBLISHED', label: 'Опубликованные' },
  { value: 'DRAFT', label: 'Черновики' },
  { value: 'CLOSED', label: 'Закрытые' },
] as const;

export function VacanciesList() {
  const me = useMe();
  const hasCompany = Boolean(me.employer?.companyId);
  const [tab, setTab] = useState<(typeof TABS)[number]['value']>('ALL');
  const vacancies = useEmployerVacancies(tab, hasCompany);
  return (
    <>
      <PageHeader
        title="Вакансии"
        description="Публичная вакансия видна всем кандидатам с зарплатной вилкой. Кандидат может откликнуться сам — и раскрывает контакты только вашей компании. Основной путь через подборку и приглашения от этого не меняется."
        actions={hasCompany ? <LinkButton href="/employer/vacancies/new">Новая вакансия</LinkButton> : null}
      />
      {!hasCompany ? (
        <Alert tone="brand" title="Сначала заполните профиль компании" actions={<LinkButton href="/employer/company">Заполнить</LinkButton>} />
      ) : (
        <>
          <div role="tablist" aria-label="Фильтр вакансий" className="mb-4 inline-flex flex-wrap rounded-xl border border-line bg-surface p-1">
            {TABS.map((item) => (
              <button
                key={item.value}
                role="tab"
                aria-selected={tab === item.value}
                onClick={() => setTab(item.value)}
                className={clsx('rounded-lg px-4 py-1.5 text-sm font-medium', tab === item.value ? 'bg-brand-500 text-white' : 'text-ink-soft hover:bg-canvas')}
              >
                {item.label}
              </button>
            ))}
          </div>
          {vacancies.isPending ? (
            <LoadingBlock />
          ) : vacancies.isError ? (
            <ErrorState error={vacancies.error} onRetry={() => vacancies.refetch()} />
          ) : vacancies.data.length === 0 ? (
            <EmptyState
              title={tab === 'ALL' ? 'Вакансий пока нет' : 'В этой категории вакансий нет'}
              description="Опубликуйте вакансию: кандидаты увидят условия и зарплату и смогут откликнуться сами. Можно начать с готовой потребности."
              action={<LinkButton href="/employer/vacancies/new">Создать вакансию</LinkButton>}
            />
          ) : (
            <ul className="space-y-3">
              {vacancies.data.map((vacancy) => (
                <li key={vacancy.id}>
                  <Link href={`/employer/vacancies/${vacancy.id}`} className="card flex flex-wrap items-start justify-between gap-4 p-5 transition-colors hover:border-brand-300">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-lg font-bold">{vacancy.title}</span>
                        <VacancyStatusBadge status={vacancy.status} />
                        {vacancy.newApplicationsCount > 0 ? <Badge tone="brand">новых откликов: {vacancy.newApplicationsCount}</Badge> : null}
                      </div>
                      <div className="mt-1 text-muted">
                        {vacancy.specializationTitle} · {vacancy.allowedGrades.map((g) => GRADE_LABELS[g]).join(', ')} · {WORK_FORMAT_LABELS[vacancy.workFormat]}
                        {vacancy.city ? `, ${vacancy.city}` : ''}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {vacancy.requiredSkills.map((s) => (
                          <Badge key={s.code} tone="success">
                            обяз.: {s.title}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-brand font-bold text-brand-700">{formatSalaryRange(vacancy.salaryFrom, vacancy.salaryTo, false)}</div>
                      <div className="text-xs text-muted">
                        откликов {vacancy.applicationsCount} · версия {vacancy.version} · {vacancy.publishedAt ? `опубликована ${formatDate(vacancy.publishedAt)}` : `изменена ${formatDate(vacancy.updatedAt)}`}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}
