'use client';

import {
  GRADE_LABELS,
  NEED_STATUS_LABELS,
  SKILL_MODE_LABELS,
  WORK_FORMAT_LABELS,
  type HiringNeedView,
  type SelectionRunView,
} from '@fsp/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button, LinkButton } from '@/components/ui/button';
import { Card, CardHeader, DefinitionList, PageHeader } from '@/components/ui/card';
import { ErrorState, LoadingBlock, Spinner } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api/client';
import { formatDateTime, formatSalaryRange } from '@/lib/format';
import { employerKeys, useNeed, useSelections } from '@/lib/employer-queries';

export function NeedDetail({ id }: { id: string }) {
  const need = useNeed(id);
  if (need.isPending) return <LoadingBlock />;
  if (need.isError) return <ErrorState error={need.error} onRetry={() => need.refetch()} />;
  return <Detail need={need.data} />;
}

function Detail({ need }: { need: HiringNeedView }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const selections = useSelections(need.id);
  const build = useMutation({
    mutationFn: () => api.post<SelectionRunView>(`/employer/needs/${need.id}/selections`, {}),
    onSuccess: (run) => {
      void queryClient.invalidateQueries({ queryKey: employerKeys.selections(need.id) });
      router.push(`/employer/selections/${run.id}`);
    },
    onError: (error) => notify(errorMessage(error), 'danger'),
  });
  const setStatus = useMutation({
    mutationFn: (status: 'ACTIVE' | 'ARCHIVED') => api.patch<HiringNeedView>(`/employer/needs/${need.id}`, { status }),
    onSuccess: (updated) => {
      queryClient.setQueryData(employerKeys.need(need.id), updated);
      void queryClient.invalidateQueries({ queryKey: employerKeys.needs });
      notify(updated.status === 'ARCHIVED' ? 'Потребность перенесена в архив' : 'Потребность снова активна');
    },
    onError: (error) => notify(errorMessage(error), 'danger'),
  });

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/employer/needs" className="hover:underline">
            ← Потребности
          </Link>
        }
        title={need.title}
        actions={
          <>
            <Button onClick={() => build.mutate()} loading={build.isPending} disabled={need.status === 'ARCHIVED'}>
              Построить подборку
            </Button>
            <LinkButton href={`/employer/needs/${need.id}/coverage`} variant="outline">
              План теста и покрытие
            </LinkButton>
            <LinkButton href={`/employer/needs/${need.id}/edit`} variant="outline">
              Редактировать
            </LinkButton>
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader
            title="Требования"
            description={`Версия ${need.version}. Изменение потребности создаёт новую версию; сохранённые подборки ссылаются на свою версию.`}
            actions={<Badge tone={need.status === 'ACTIVE' ? 'success' : 'neutral'}>{NEED_STATUS_LABELS[need.status]}</Badge>}
          />
          <DefinitionList
            items={[
              { term: 'Специализация', value: need.specializationTitle },
              { term: 'Допустимые грейды', value: need.allowedGrades.map((g) => GRADE_LABELS[g]).join(', ') },
              {
                term: 'Обязательные (подтверждены тестом)',
                value: need.requiredSkills.length ? need.requiredSkills.map((s) => <Badge key={s.code} tone="success" className="mr-1">{s.title}</Badge>) : 'нет',
              },
              {
                term: 'Желательные',
                value: need.preferredSkills.length
                  ? need.preferredSkills.map((s) => (
                      <span key={s.code} className="mr-2 inline-block">
                        {s.title} <span className="text-xs text-muted">({SKILL_MODE_LABELS[s.mode].toLowerCase()})</span>
                      </span>
                    ))
                  : 'нет',
              },
              { term: 'Формат', value: `${WORK_FORMAT_LABELS[need.workFormat]}${need.city ? `, ${need.city}` : ''}` },
              { term: 'Зарплата', value: formatSalaryRange(need.salaryFrom, need.salaryTo) },
            ]}
          />
          <p className="mt-5 whitespace-pre-line text-[15px] text-ink-soft">{need.description}</p>
          <div className="mt-5">
            {need.status === 'ARCHIVED' ? (
              <Button variant="outline" size="sm" onClick={() => setStatus.mutate('ACTIVE')} loading={setStatus.isPending}>
                Вернуть из архива
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setStatus.mutate('ARCHIVED')} loading={setStatus.isPending}>
                Перенести в архив
              </Button>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="История подборок" description="Каждое построение и уточнение сохраняется." />
          {selections.isPending ? (
            <Spinner />
          ) : selections.isError ? (
            <ErrorState error={selections.error} />
          ) : selections.data.length === 0 ? (
            <p className="text-muted">Подборок ещё не было. Нажмите «Построить подборку».</p>
          ) : (
            <ol className="space-y-2">
              {selections.data.map((run) => (
                <li key={run.id}>
                  <Link href={`/employer/selections/${run.id}`} className="block rounded-lg border border-line px-3 py-2 hover:border-brand-300">
                    <span className="flex justify-between gap-2 text-sm">
                      <span className="font-medium">{formatDateTime(run.createdAt)}</span>
                      <span className="font-brand">{run.totalMatched} из {run.totalConsidered}</span>
                    </span>
                    <span className="text-xs text-muted">
                      версия потребности {run.needVersion} · {run.formulaVersion}
                      {run.parentRunId ? ' · уточнение' : ''}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </>
  );
}
