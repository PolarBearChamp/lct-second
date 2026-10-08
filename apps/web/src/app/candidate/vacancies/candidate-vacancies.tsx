'use client';

import { GRADE_LABELS, GRADES, SPECIALIZATION_LABELS, SPECIALIZATIONS, WORK_FORMAT_LABELS, WORK_FORMATS } from '@fsp/contracts';
import Link from 'next/link';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button, LinkButton } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/card';
import { Checkbox, Field, Input, Select } from '@/components/ui/field';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { ApplicationStatusBadge } from '@/components/vacancies/status-badges';
import { formatDate, formatSalaryRange } from '@/lib/format';
import { useCandidateVacancies } from '@/lib/vacancy-queries';

interface Filters {
  specialization: string;
  workFormat: string;
  grade: string;
  city: string;
  q: string;
  onlyMine: boolean;
}

const EMPTY: Filters = { specialization: '', workFormat: '', grade: '', city: '', q: '', onlyMine: false };

function toQuery(filters: Filters, page: number): string {
  const params = new URLSearchParams({ page: String(page), pageSize: '20' });
  for (const [key, value] of Object.entries(filters)) {
    if (value === '' || value === false) continue;
    params.set(key, String(value));
  }
  return params.toString();
}

export function CandidateVacancies() {
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(1);
  const list = useCandidateVacancies(toQuery(applied, page));
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => setDraft((current) => ({ ...current, [key]: value }));

  return (
    <>
      <PageHeader
        title="Вакансии"
        description="Опубликованные вакансии компаний. Зарплата видна до отклика. Откликнуться можно после подтверждения грейда тестом — контакты раскрываются только этой компании и только выбранными каналами."
      />
      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <form
          className="card h-fit space-y-4 p-4"
          aria-label="Фильтры вакансий"
          onSubmit={(event) => {
            event.preventDefault();
            setApplied(draft);
            setPage(1);
          }}
        >
          <Field label="Поиск">{(props) => <Input {...props} value={draft.q} onChange={(e) => set('q', e.target.value)} placeholder="Название или описание" />}</Field>
          <Field label="Специализация">
            {(props) => (
              <Select {...props} value={draft.specialization} onChange={(e) => set('specialization', e.target.value)}>
                <option value="">Любая</option>
                {SPECIALIZATIONS.map((s) => (
                  <option key={s} value={s}>
                    {SPECIALIZATION_LABELS[s]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Грейд в вакансии">
            {(props) => (
              <Select {...props} value={draft.grade} onChange={(e) => set('grade', e.target.value)}>
                <option value="">Любой</option>
                {GRADES.map((g) => (
                  <option key={g} value={g}>
                    {GRADE_LABELS[g]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Формат работы">
            {(props) => (
              <Select {...props} value={draft.workFormat} onChange={(e) => set('workFormat', e.target.value)}>
                <option value="">Любой</option>
                {WORK_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {WORK_FORMAT_LABELS[f]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Город" hint="Удалённые вакансии подходят любому городу">
            {(props) => <Input {...props} value={draft.city} onChange={(e) => set('city', e.target.value)} />}
          </Field>
          <Checkbox checked={draft.onlyMine} onChange={(e) => set('onlyMine', e.target.checked)} label="Только по моей специализации" />
          <div className="flex gap-2">
            <Button type="submit" size="sm">
              Применить
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setDraft(EMPTY);
                setApplied(EMPTY);
                setPage(1);
              }}
            >
              Сбросить
            </Button>
          </div>
        </form>

        <section aria-label="Список вакансий">
          {list.isPending ? (
            <LoadingBlock />
          ) : list.isError ? (
            <ErrorState error={list.error} onRetry={() => list.refetch()} />
          ) : list.data.items.length === 0 ? (
            <EmptyState title="Вакансий по этим условиям нет" description="Измените фильтры или загляните позже. Работодатели также сами выходят на кандидатов — приглашения приходят в раздел «Приглашения»." />
          ) : (
            <>
              <p className="mb-3 text-sm text-muted">Найдено: {list.data.total}</p>
              <ul className="space-y-3">
                {list.data.items.map((vacancy) => (
                  <li key={vacancy.id}>
                    <Link href={`/candidate/vacancies/${vacancy.id}`} className="card block p-5 transition-colors hover:border-brand-300">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-lg font-bold">{vacancy.title}</span>
                            {vacancy.myApplication ? <ApplicationStatusBadge status={vacancy.myApplication.status} /> : null}
                          </div>
                          <div className="mt-1 text-muted">
                            {vacancy.companyName}
                            {vacancy.companyVerified ? ' · ✓ компания проверена' : ''}
                            {vacancy.companyIndustry ? ` · ${vacancy.companyIndustry}` : ''} · {WORK_FORMAT_LABELS[vacancy.workFormat]}
                            {vacancy.city ? `, ${vacancy.city}` : ''}
                          </div>
                          <div className="mt-1 text-sm text-muted">
                            {vacancy.specializationTitle} · {vacancy.allowedGrades.map((g) => GRADE_LABELS[g]).join(', ')} · опубликована {formatDate(vacancy.publishedAt)}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {vacancy.requiredSkills.map((s) => (
                              <Badge key={s.code} tone="success">
                                обяз.: {s.title}
                              </Badge>
                            ))}
                            {vacancy.fit ? (
                              vacancy.fit.passes ? (
                                <Badge tone="brand">вы подходите по требованиям</Badge>
                              ) : (
                                <Badge tone="warning" title={vacancy.fit.violations.join('; ')}>
                                  не все условия подтверждены
                                </Badge>
                              )
                            ) : null}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-brand text-xl font-bold text-brand-700">{formatSalaryRange(vacancy.salaryFrom, vacancy.salaryTo, false)}</div>
                          <div className="text-xs text-muted">в месяц до вычета налогов</div>
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
              {list.data.total > list.data.pageSize ? (
                <div className="mt-4 flex items-center justify-between">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                    ← Назад
                  </Button>
                  <span className="text-sm text-muted">
                    Страница {page} из {Math.ceil(list.data.total / list.data.pageSize)}
                  </span>
                  <Button variant="outline" size="sm" disabled={page * list.data.pageSize >= list.data.total} onClick={() => setPage(page + 1)}>
                    Далее →
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>
      <p className="mt-6 text-sm text-muted">
        Нужен подтверждённый грейд? <LinkButton href="/candidate/assessments" variant="outline" size="sm">Пройти тестирование</LinkButton>
      </p>
    </>
  );
}
