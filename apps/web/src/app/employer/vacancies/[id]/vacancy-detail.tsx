'use client';

import { GRADE_LABELS, SKILL_MODE_LABELS, WORK_FORMAT_LABELS, type EmployerVacancyView } from '@fsp/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import Link from 'next/link';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, LinkButton } from '@/components/ui/button';
import { Card, CardHeader, DefinitionList, PageHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/field';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { ApplicationStatusBadge, VacancyStatusBadge } from '@/components/vacancies/status-badges';
import { api, errorMessage } from '@/lib/api/client';
import { formatDate, formatSalaryRange } from '@/lib/format';
import { useEmployerVacancy, useVacancyApplications, vacancyKeys } from '@/lib/vacancy-queries';

export function VacancyDetail({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const vacancy = useEmployerVacancy(id);
  const [tab, setTab] = useState<'ACTIVE' | 'ALL'>('ACTIVE');
  const [sort, setSort] = useState<'FIT' | 'DATE'>('FIT');
  const [page, setPage] = useState(1);
  const [closeOpen, setCloseOpen] = useState(false);
  const applications = useVacancyApplications(id, tab, sort, page);

  const onChanged = (data: EmployerVacancyView) => {
    queryClient.setQueryData(vacancyKeys.employerOne(id), data);
    void queryClient.invalidateQueries({ queryKey: vacancyKeys.employerAll });
  };
  const publish = useMutation({
    mutationFn: () => api.post<EmployerVacancyView>(`/employer/vacancies/${id}/publish`),
    onSuccess: (data) => {
      onChanged(data);
      notify('Вакансия опубликована: кандидаты её видят');
    },
    onError: (error) => notify(errorMessage(error), 'danger'),
  });
  const close = useMutation({
    mutationFn: () => api.post<EmployerVacancyView>(`/employer/vacancies/${id}/close`),
    onSuccess: (data) => {
      onChanged(data);
      setCloseOpen(false);
      notify('Вакансия закрыта: новые отклики не принимаются', 'info');
    },
    onError: (error) => notify(errorMessage(error), 'danger'),
  });

  if (vacancy.isPending) return <LoadingBlock lines={5} />;
  if (vacancy.isError) return <ErrorState error={vacancy.error} onRetry={() => vacancy.refetch()} />;
  const v = vacancy.data;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/employer/vacancies" className="hover:underline">
            ← Все вакансии
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {v.title}
            <VacancyStatusBadge status={v.status} />
          </span>
        }
        actions={
          <>
            <LinkButton href={`/employer/vacancies/${id}/edit`} variant="outline" size="sm">
              Редактировать
            </LinkButton>
            {v.status !== 'PUBLISHED' ? (
              <Button size="sm" loading={publish.isPending} onClick={() => publish.mutate()}>
                {v.status === 'CLOSED' ? 'Открыть снова' : 'Опубликовать'}
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setCloseOpen(true)}>
                Закрыть вакансию
              </Button>
            )}
          </>
        }
      />
      {v.status === 'DRAFT' ? <Alert tone="warning" title="Это черновик: кандидаты вакансию не видят">Опубликуйте её, чтобы принимать отклики.</Alert> : null}
      {v.status === 'CLOSED' ? <Alert tone="neutral" title="Вакансия закрыта">Новые отклики не принимаются; поданные остаются в работе.</Alert> : null}

      <div className="mt-4 grid gap-6 xl:grid-cols-[1fr_380px]">
        <section aria-label="Отклики" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold">Отклики</h2>
            <div className="flex flex-wrap items-center gap-3">
              <div role="tablist" aria-label="Фильтр откликов" className="inline-flex rounded-xl border border-line bg-surface p-1">
                {(['ACTIVE', 'ALL'] as const).map((value) => (
                  <button
                    key={value}
                    role="tab"
                    aria-selected={tab === value}
                    onClick={() => {
                      setTab(value);
                      setPage(1);
                    }}
                    className={clsx('rounded-lg px-3 py-1 text-sm font-medium', tab === value ? 'bg-brand-500 text-white' : 'text-ink-soft hover:bg-canvas')}
                  >
                    {value === 'ACTIVE' ? 'В работе' : 'Все'}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-2 text-sm text-muted">
                Сортировка
                <Select
                  value={sort}
                  onChange={(e) => {
                    setSort(e.target.value as 'FIT' | 'DATE');
                    setPage(1);
                  }}
                  className="!h-9 !w-auto"
                >
                  <option value="FIT">По соответствию</option>
                  <option value="DATE">По дате отклика</option>
                </Select>
              </label>
            </div>
          </div>

          {applications.isPending ? (
            <LoadingBlock />
          ) : applications.isError ? (
            <ErrorState error={applications.error} onRetry={() => applications.refetch()} />
          ) : applications.data.items.length === 0 ? (
            <EmptyState
              title={tab === 'ACTIVE' ? 'Откликов в работе нет' : 'Откликов пока нет'}
              description={v.status === 'PUBLISHED' ? 'Кандидаты увидят вакансию в общем списке. Параллельно можно построить подборку по потребности и направить приглашение.' : 'Опубликуйте вакансию, чтобы кандидаты могли откликнуться.'}
            />
          ) : (
            <>
              <p className="text-sm text-muted">{applications.data.sorting}</p>
              <ol className="space-y-3">
                {applications.data.items.map((item) => (
                  <li key={item.id}>
                    <Link href={`/employer/applications/${item.id}`} className="card block p-5 transition-colors hover:border-brand-300">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-lg font-bold">{item.candidateName}</span>
                            <ApplicationStatusBadge status={item.status} />
                            {item.hasContactAccess ? <Badge tone="brand">контакты раскрыты</Badge> : <Badge>доступ к контактам закрыт</Badge>}
                          </div>
                          <div className="mt-1 text-sm text-muted">
                            {item.gradeTitle ? `Грейд по тесту: ${item.gradeTitle} · балл ${item.overallScore}` : 'Квалификация не подтверждена'} · отклик {formatDate(item.createdAt)}
                            {item.hasCoverNote ? ' · есть сообщение' : ''}
                          </div>
                        </div>
                        {item.fit ? (
                          item.fit.passes ? (
                            <div className="text-right">
                              <div className="font-brand text-2xl font-bold text-brand-700">{item.fit.score?.toFixed(1)}</div>
                              <div className="text-xs text-muted">соответствие</div>
                            </div>
                          ) : (
                            <Badge tone="warning">не все обязательные условия</Badge>
                          )
                        ) : null}
                      </div>
                      {item.fit && !item.fit.passes ? (
                        <ul className="mt-3 list-disc pl-5 text-sm text-warning-700">
                          {item.fit.violations.map((violation) => (
                            <li key={violation}>{violation}</li>
                          ))}
                        </ul>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ol>
              {applications.data.total > applications.data.pageSize ? (
                <div className="flex items-center justify-between">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                    ← Назад
                  </Button>
                  <span className="text-sm text-muted">
                    Страница {page} из {Math.ceil(applications.data.total / applications.data.pageSize)}
                  </span>
                  <Button variant="outline" size="sm" disabled={page * applications.data.pageSize >= applications.data.total} onClick={() => setPage(page + 1)}>
                    Далее →
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </section>

        <aside className="space-y-6">
          <Card>
            <CardHeader as="h3" title="Условия" description={`Версия ${v.version} · изменена ${formatDate(v.updatedAt)}`} />
            <div className="font-brand text-2xl font-bold text-brand-700">{formatSalaryRange(v.salaryFrom, v.salaryTo, false)}</div>
            <div className="mb-4 text-sm text-muted">в месяц до вычета налогов (GROSS)</div>
            <DefinitionList
              items={[
                { term: 'Специализация', value: v.specializationTitle },
                { term: 'Допустимые грейды', value: v.allowedGrades.map((g) => GRADE_LABELS[g]).join(', ') },
                { term: 'Формат', value: `${WORK_FORMAT_LABELS[v.workFormat]}${v.city ? `, ${v.city}` : ''}` },
                { term: 'Опубликована', value: v.publishedAt ? formatDate(v.publishedAt) : '—' },
              ]}
            />
            <p className="mt-4 whitespace-pre-line text-[15px] text-ink-soft">{v.description}</p>
          </Card>
          <Card>
            <CardHeader as="h3" title="Требования" />
            <div className="flex flex-wrap gap-1.5">
              {v.requiredSkills.length === 0 ? <span className="text-sm text-muted">Обязательных навыков нет</span> : null}
              {v.requiredSkills.map((s) => (
                <Badge key={s.code} tone="success">
                  обяз.: {s.title}
                </Badge>
              ))}
              {v.preferredSkills.map((s) => (
                <Badge key={s.code} title={SKILL_MODE_LABELS[s.mode]}>
                  {s.title}
                </Badge>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted">
              Соответствие откликнувшихся считается тем же правилом, что и подбор по потребности: обязательные условия — по подтверждённым тестом данным, затем оценка 70·желательные навыки + 25·качество теста + 5·ФСП.
            </p>
            {v.needId ? (
              <Link href={`/employer/needs/${v.needId}`} className="mt-3 inline-block text-sm font-medium text-brand-600 hover:underline">
                Потребность, из которой создана вакансия
              </Link>
            ) : null}
          </Card>
        </aside>
      </div>

      <ConfirmDialog open={closeOpen} title="Закрыть вакансию?" confirmLabel="Закрыть" tone="danger" loading={close.isPending} onClose={() => setCloseOpen(false)} onConfirm={() => close.mutate()}>
        <p>Новые отклики приниматься не будут, вакансия исчезнет из общего списка. Поданные отклики ({v.activeApplicationsCount} в работе) останутся — с ними можно продолжить работу. Вакансию можно открыть снова.</p>
      </ConfirmDialog>
    </>
  );
}
