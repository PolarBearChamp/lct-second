'use client';

import { GRADE_LABELS, type SelectionRefinements, type SelectionRunView } from '@fsp/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CandidateSummaryCard } from '@/components/employer/candidate-summary-card';
import { ExplanationPanel } from '@/components/employer/explanation-panel';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, LinkButton } from '@/components/ui/button';
import { Card, CardHeader, PageHeader } from '@/components/ui/card';
import { Checkbox, Field, Input } from '@/components/ui/field';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api/client';
import { formatDateTime, formatSalaryRange } from '@/lib/format';
import { employerKeys, useSelection } from '@/lib/employer-queries';
import { useSkills } from '@/lib/queries';

export function SelectionView({ id, page }: { id: string; page: number }) {
  const selection = useSelection(id, page);
  if (selection.isPending) return <LoadingBlock label="Загружаем подборку…" lines={6} />;
  if (selection.isError) return <ErrorState error={selection.error} onRetry={() => selection.refetch()} />;
  return <Run run={selection.data} />;
}

function describeFilters(f: SelectionRefinements): string[] {
  const out: string[] = [];
  if (f.onlyWithFsp) out.push('только с достижениями ФСП');
  if (f.minOverallScore !== undefined) out.push(`балл теста ≥ ${f.minOverallScore}`);
  if (f.extraRequiredSkills?.length) out.push(`доп. подтверждённые навыки: ${f.extraRequiredSkills.join(', ')}`);
  if (f.cities?.length) out.push(`города: ${f.cities.join(', ')}`);
  return out;
}

function Run({ run }: { run: SelectionRunView }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const skills = useSkills();
  const need = run.needSnapshot;
  const [onlyWithFsp, setOnlyWithFsp] = useState(Boolean(run.filters.onlyWithFsp));
  const [minScore, setMinScore] = useState(run.filters.minOverallScore?.toString() ?? '');
  const [extraSkills, setExtraSkills] = useState<string[]>(run.filters.extraRequiredSkills ?? []);
  const [cities, setCities] = useState((run.filters.cities ?? []).join(', '));
  const assessable = (skills.data ?? []).filter((s) => s.assessableIn.includes(need.specialization) && !need.requiredSkills.some((r) => r.code === s.code));

  const refine = useMutation({
    mutationFn: (refinements: SelectionRefinements) =>
      api.post<SelectionRunView>(`/employer/needs/${run.needId}/selections`, { refinements, parentRunId: run.id }),
    onSuccess: (next) => {
      void queryClient.invalidateQueries({ queryKey: employerKeys.selections(run.needId) });
      notify('Создана уточнённая версия подборки');
      router.push(`/employer/selections/${next.id}`);
    },
    onError: (error) => notify(errorMessage(error), 'danger'),
  });
  const rebuild = useMutation({
    mutationFn: () => api.post<SelectionRunView>(`/employer/needs/${run.needId}/selections`, {}),
    onSuccess: (next) => {
      void queryClient.invalidateQueries({ queryKey: employerKeys.selections(run.needId) });
      router.push(`/employer/selections/${next.id}`);
    },
    onError: (error) => notify(errorMessage(error), 'danger'),
  });

  const filters = describeFilters(run.filters);
  const totalPages = Math.max(1, Math.ceil(run.total / run.pageSize));
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/employer/needs/${run.needId}`} className="hover:underline">
            ← {need.title}
          </Link>
        }
        title="Подборка кандидатов"
        description={`Построена ${formatDateTime(run.createdAt)} · версия потребности ${run.needVersion} · формула ${run.formulaVersion} · ${run.durationMs} мс`}
        actions={
          run.currentNeedVersion !== null && run.currentNeedVersion !== run.needVersion ? (
            <Button onClick={() => rebuild.mutate()} loading={rebuild.isPending}>
              Построить по версии {run.currentNeedVersion}
            </Button>
          ) : null
        }
      />
      {run.currentNeedVersion !== null && run.currentNeedVersion !== run.needVersion ? (
        <Alert tone="warning" className="mb-4">
          Потребность изменилась после построения этой подборки. Подборка сохранена для истории в исходной версии.
        </Alert>
      ) : null}
      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <Card className="p-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone="brand">{need.specializationTitle}</Badge>
              <Badge>{need.allowedGrades.map((g) => GRADE_LABELS[g]).join(' / ')}</Badge>
              {need.requiredSkills.map((s) => (
                <Badge key={s.code} tone="success">
                  обяз.: {s.title}
                </Badge>
              ))}
              <span className="text-muted">{formatSalaryRange(need.salaryFrom, need.salaryTo, false)}</span>
              {filters.map((f) => (
                <Badge key={f} tone="warning">
                  уточнение: {f}
                </Badge>
              ))}
            </div>
            <p className="mt-2 text-sm text-muted">
              Подходят {run.totalMatched} из {run.totalConsidered} опубликованных кандидатов специализации. Порядок: оценка соответствия → балл теста → идентификатор.
              {run.totalUnconfirmed > 0
                ? ` Ещё ${run.totalUnconfirmed} — без подтверждённого грейда: подходят по заявленным данным и показаны после всех подтверждённых, без балла.`
                : ''}
            </p>
          </Card>

          {run.totalMatched === 0 && run.totalUnconfirmed === 0 ? (
            <EmptyState
              title="Никто не прошёл обязательные условия"
              description={
                <span className="block text-left">
                  Причины отсева (кандидат может попасть в несколько):
                  <span className="mt-2 block">
                    {run.emptyReasons.map((r) => (
                      <span key={r.reason} className="block">
                        • {r.text}: {r.count}
                      </span>
                    ))}
                    {run.rejectedBySkill.map((r) => (
                      <span key={r.skill} className="block">
                        • не подтверждён навык «{r.title}»: {r.count}
                      </span>
                    ))}
                  </span>
                  <span className="mt-2 block">Условия не ослабляются автоматически — при необходимости измените потребность или уберите уточнения.</span>
                </span>
              }
              action={<LinkButton href={`/employer/needs/${run.needId}/edit`} variant="outline">Изменить потребность</LinkButton>}
            />
          ) : (
            <ol className="space-y-4">
              {run.items.map((item, index) =>
                item.unavailable ? (
                  <li key={item.rank} className="card flex items-center gap-3 p-5 text-muted">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-canvas font-brand font-bold">{item.rank}</span>
                    Кандидат недоступен: профиль скрыт или больше не опубликован. Сохранённые детали не показываются.
                  </li>
                ) : (
                  <li key={item.rank}>
                    {!item.gradeConfirmed && (index === 0 || run.items[index - 1].unavailable || (run.items[index - 1] as { gradeConfirmed?: boolean }).gradeConfirmed !== false) ? (
                      <h2 className="mb-3 mt-2 font-brand text-sm font-bold text-warning-700">
                        Без подтверждённого грейда — подходят по заявленным данным, показаны после всех подтверждённых
                      </h2>
                    ) : null}
                    <CandidateSummaryCard
                      candidate={item.candidate}
                      rank={item.rank}
                      score={item.score}
                      href={`/employer/candidates/${item.candidate.candidateId}?needId=${run.needId}`}
                    >
                      <ExplanationPanel explanation={item.explanation} score={item.score} />
                    </CandidateSummaryCard>
                  </li>
                ),
              )}
            </ol>
          )}
          {totalPages > 1 ? (
            <nav aria-label="Страницы подборки" className="flex items-center justify-center gap-2">
              <LinkButton href={`/employer/selections/${run.id}?page=${run.page - 1}`} variant="outline" size="sm" aria-disabled={run.page <= 1} className={run.page <= 1 ? 'pointer-events-none opacity-50' : ''}>
                ← Назад
              </LinkButton>
              <span className="text-sm text-muted">
                Страница {run.page} из {totalPages}
              </span>
              <LinkButton href={`/employer/selections/${run.id}?page=${run.page + 1}`} variant="outline" size="sm" aria-disabled={run.page >= totalPages} className={run.page >= totalPages ? 'pointer-events-none opacity-50' : ''}>
                Далее →
              </LinkButton>
            </nav>
          ) : null}
        </div>

        <aside>
          <Card className="xl:sticky xl:top-24">
            <CardHeader as="h3" title="Уточнить подборку" description="Создаёт новую версию; эта подборка останется в истории. Уточнения только сужают выдачу." />
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                const refinements: SelectionRefinements = {};
                if (onlyWithFsp) refinements.onlyWithFsp = true;
                if (minScore !== '') refinements.minOverallScore = Math.max(0, Math.min(100, Number(minScore)));
                if (extraSkills.length) refinements.extraRequiredSkills = extraSkills;
                const cityList = cities.split(',').map((c) => c.trim()).filter(Boolean);
                if (cityList.length) refinements.cities = cityList;
                refine.mutate(refinements);
              }}
            >
              <Checkbox checked={onlyWithFsp} onChange={(e) => setOnlyWithFsp(e.target.checked)} label="Только с достижениями ФСП" />
              <Field label="Минимальный балл теста">
                {(props) => <Input inputMode="numeric" {...props} value={minScore} onChange={(e) => setMinScore(e.target.value.replace(/\D/g, ''))} placeholder="например, 85" />}
              </Field>
              <fieldset>
                <legend className="mb-1.5 text-sm font-medium">Дополнительно подтверждённые навыки</legend>
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-line p-2">
                  {assessable.map((s) => (
                    <label key={s.code} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="accent-brand-500"
                        checked={extraSkills.includes(s.code)}
                        onChange={() => setExtraSkills(extraSkills.includes(s.code) ? extraSkills.filter((x) => x !== s.code) : [...extraSkills, s.code])}
                      />
                      {s.title}
                    </label>
                  ))}
                </div>
              </fieldset>
              <Field label="Города" hint="Через запятую">
                {(props) => <Input {...props} value={cities} onChange={(e) => setCities(e.target.value)} />}
              </Field>
              <Button type="submit" className="w-full" loading={refine.isPending}>
                Создать уточнённую версию
              </Button>
              {run.parentRunId ? (
                <LinkButton href={`/employer/selections/${run.parentRunId}`} variant="ghost" size="sm" className="w-full">
                  ← Предыдущая версия
                </LinkButton>
              ) : null}
            </form>
          </Card>
        </aside>
      </div>
    </>
  );
}
