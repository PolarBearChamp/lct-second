'use client';

import {
  GRADE_LABELS,
  GRADES,
  SPECIALIZATION_LABELS,
  SPECIALIZATIONS,
  WORK_FORMAT_LABELS,
  WORK_FORMATS,
  type BankResponse,
} from '@fsp/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { CandidateSummaryCard } from '@/components/employer/candidate-summary-card';
import { useMe } from '@/components/layout/me-context';
import { Alert } from '@/components/ui/alert';
import { Button, LinkButton } from '@/components/ui/button';
import { Card, PageHeader } from '@/components/ui/card';
import { Checkbox, Field, Input, Select } from '@/components/ui/field';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { api } from '@/lib/api/client';
import { useSkills } from '@/lib/queries';

/** Общий банк: фильтры хранятся в URL, чтобы подборку можно было открыть заново или переслать коллеге. */
export function CandidateBank() {
  const me = useMe();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const skills = useSkills();
  const query = params.toString();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const bank = useQuery({
    queryKey: ['employer', 'bank', query],
    queryFn: () => api.get<BankResponse>(`/employer/candidates?${query}${query ? '&' : ''}pageSize=20`),
    placeholderData: keepPreviousData,
    enabled: Boolean(me.employer?.companyId),
  });

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };
  const csv = (key: string) => (params.get(key) ?? '').split(',').filter(Boolean);
  const toggleCsv = (key: string, value: string) => {
    const current = csv(key);
    setParam(key, (current.includes(value) ? current.filter((v) => v !== value) : [...current, value]).join(',') || null);
  };
  const spec = params.get('specialization') ?? '';
  const skillOptions = useMemo(
    () => (skills.data ?? []).filter((s) => !spec || s.specializations.includes(spec as never)).sort((a, b) => a.title.localeCompare(b.title, 'ru')),
    [skills.data, spec],
  );

  if (!me.employer?.companyId) {
    return (
      <>
        <PageHeader title="Банк кандидатов" />
        <Alert tone="brand" title="Сначала заполните профиль компании" actions={<LinkButton href="/employer/company">Заполнить</LinkButton>} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Банк кандидатов"
        description="Только опубликованные профили с грейдом, подтверждённым тестом. Сортировка по категории (специализация → грейд), внутри — по качеству теста и бонусу ФСП."
      />
      <div className="grid gap-6 xl:grid-cols-[280px_1fr]">
        <Card className="h-fit p-4">
          <form className="space-y-4" onSubmit={(e) => e.preventDefault()} aria-label="Фильтры банка">
            <Field label="Специализация">
              {(props) => (
                <Select {...props} value={spec} onChange={(e) => setParam('specialization', e.target.value || null)}>
                  <option value="">Все</option>
                  {SPECIALIZATIONS.map((s) => (
                    <option key={s} value={s}>
                      {SPECIALIZATION_LABELS[s]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium">Подтверждённый грейд</legend>
              <div className="flex flex-wrap gap-3">
                {GRADES.map((g) => (
                  <label key={g} className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" className="accent-brand-500" checked={csv('grades').includes(g)} onChange={() => toggleCsv('grades', g)} />
                    {GRADE_LABELS[g]}
                  </label>
                ))}
              </div>
            </fieldset>
            <Field label="Навыки">
              {(props) => (
                <Select {...props} value="" onChange={(e) => e.target.value && toggleCsv('skills', e.target.value)}>
                  <option value="">Добавить навык…</option>
                  {skillOptions.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.title}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {csv('skills').length ? (
              <div className="flex flex-wrap gap-1.5">
                {csv('skills').map((code) => (
                  <button key={code} type="button" onClick={() => toggleCsv('skills', code)} className="rounded-full bg-brand-50 px-2.5 py-0.5 text-sm text-brand-700 hover:bg-brand-100" aria-label={`Убрать фильтр ${code}`}>
                    {skills.data?.find((s) => s.code === code)?.title ?? code} ×
                  </button>
                ))}
              </div>
            ) : null}
            <Field label="Источник навыков">
              {(props) => (
                <Select {...props} value={params.get('skillSource') ?? 'VERIFIED'} onChange={(e) => setParam('skillSource', e.target.value === 'VERIFIED' ? null : e.target.value)}>
                  <option value="VERIFIED">Только подтверждённые тестом</option>
                  <option value="ANY">Подтверждённые или указанные кандидатом</option>
                </Select>
              )}
            </Field>
            <Field label="Формат работы">
              {(props) => (
                <Select {...props} value={params.get('workFormat') ?? ''} onChange={(e) => setParam('workFormat', e.target.value || null)}>
                  <option value="">Любой</option>
                  {WORK_FORMATS.map((f) => (
                    <option key={f} value={f}>
                      {WORK_FORMAT_LABELS[f]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Город">
              {(props) => <Input {...props} defaultValue={params.get('city') ?? ''} onBlur={(e) => setParam('city', e.target.value.trim() || null)} />}
            </Field>
            <Checkbox checked={params.get('hasFsp') === 'true'} onChange={(e) => setParam('hasFsp', e.target.checked ? 'true' : null)} label="Есть достижения ФСП" />
            <Button variant="ghost" size="sm" onClick={() => router.replace(pathname)}>
              Сбросить фильтры
            </Button>
          </form>
        </Card>
        <div>
          {bank.isPending ? (
            <LoadingBlock />
          ) : bank.isError ? (
            <ErrorState error={bank.error} onRetry={() => bank.refetch()} />
          ) : bank.data.items.length === 0 ? (
            <EmptyState title="Никого не найдено" description="Измените фильтры. Фильтры не ослабляются автоматически." />
          ) : (
            <>
              <p className="mb-3 text-sm text-muted" aria-live="polite">
                Найдено: {bank.data.total} · {bank.data.durationMs.toFixed(0)} мс
              </p>
              <ul className="space-y-4">
                {bank.data.items.map((item, index) => {
                  const showCategory = index === 0 || bank.data.items[index - 1].category !== item.category;
                  return (
                    <li key={item.candidateId}>
                      {showCategory ? (
                        <h2 className="mb-2 mt-2 font-brand text-sm font-bold text-brand-700">
                          {SPECIALIZATION_LABELS[item.specialization]} · {GRADE_LABELS[item.grade]}
                        </h2>
                      ) : null}
                      <CandidateSummaryCard candidate={item} href={`/employer/candidates/${item.candidateId}`} />
                    </li>
                  );
                })}
              </ul>
              <nav aria-label="Страницы" className="mt-6 flex items-center justify-center gap-3">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setParam('page', String(page - 1))}>
                  ← Назад
                </Button>
                <span className="text-sm text-muted">
                  Страница {page} из {Math.max(1, Math.ceil(bank.data.total / bank.data.pageSize))}
                </span>
                <Button variant="outline" size="sm" disabled={page * bank.data.pageSize >= bank.data.total} onClick={() => setParam('page', String(page + 1))}>
                  Далее →
                </Button>
              </nav>
            </>
          )}
        </div>
      </div>
    </>
  );
}
