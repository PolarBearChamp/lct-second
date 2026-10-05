'use client';

import { GRADE_LABELS, NEED_STATUS_LABELS, WORK_FORMAT_LABELS } from '@fsp/contracts';
import Link from 'next/link';
import { useMe } from '@/components/layout/me-context';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { LinkButton } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { formatDate, formatSalaryRange } from '@/lib/format';
import { useNeeds } from '@/lib/employer-queries';

export function NeedsList() {
  const me = useMe();
  const hasCompany = Boolean(me.employer?.companyId);
  const needs = useNeeds(hasCompany);
  return (
    <>
      <PageHeader
        title="Потребности и подборки"
        description="Потребность — внутреннее описание специалиста. По ней строится подборка кандидатов с объяснением соответствия."
        actions={hasCompany ? <LinkButton href="/employer/needs/new">Новая потребность</LinkButton> : null}
      />
      {!hasCompany ? (
        <Alert tone="brand" title="Сначала заполните профиль компании" actions={<LinkButton href="/employer/company">Заполнить</LinkButton>} />
      ) : needs.isPending ? (
        <LoadingBlock />
      ) : needs.isError ? (
        <ErrorState error={needs.error} onRetry={() => needs.refetch()} />
      ) : needs.data.length === 0 ? (
        <EmptyState title="Потребностей пока нет" description="Создайте потребность: специализация, допустимые грейды, обязательные и желательные навыки, формат и зарплатная вилка." action={<LinkButton href="/employer/needs/new">Создать</LinkButton>} />
      ) : (
        <ul className="space-y-3">
          {needs.data.map((need) => (
            <li key={need.id}>
              <Link href={`/employer/needs/${need.id}`} className="card flex flex-wrap items-start justify-between gap-4 p-5 hover:border-brand-300">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-lg font-bold">{need.title}</span>
                    <Badge tone={need.status === 'ACTIVE' ? 'success' : 'neutral'}>{NEED_STATUS_LABELS[need.status]}</Badge>
                  </div>
                  <div className="mt-1 text-muted">
                    {need.specializationTitle} · {need.allowedGrades.map((g) => GRADE_LABELS[g]).join(', ')} · {WORK_FORMAT_LABELS[need.workFormat]}
                    {need.city ? `, ${need.city}` : ''}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {need.requiredSkills.map((s) => (
                      <Badge key={s.code} tone="success">
                        обяз.: {s.title}
                      </Badge>
                    ))}
                    {need.preferredSkills.map((s) => (
                      <Badge key={s.code}>{s.title}</Badge>
                    ))}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-brand font-bold text-brand-700">{formatSalaryRange(need.salaryFrom, need.salaryTo, false)}</div>
                  <div className="text-xs text-muted">
                    версия {need.version} · подборок {need.selectionsCount} · {formatDate(need.updatedAt)}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
