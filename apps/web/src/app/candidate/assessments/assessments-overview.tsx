'use client';

import {
  GRADE_LABELS,
  SPECIALIZATION_LABELS,
  type AttemptView,
  type EligibilityResponse,
  type Grade,
  type GradeEligibility,
} from '@fsp/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { AttemptStatusBadge } from '@/components/candidate/attempt-status';
import { useMe } from '@/components/layout/me-context';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, LinkButton } from '@/components/ui/button';
import { Card, CardHeader, PageHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { EmptyState, ErrorState, LoadingBlock, Spinner } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage, idempotencyKey } from '@/lib/api/client';
import { formatDateTime } from '@/lib/format';
import { queryKeys, useAttempts, useEligibility, useQualifications, useSpecializations } from '@/lib/queries';

const EVENT_LABELS = {
  CONFIRMED: 'Первое подтверждение',
  RECONFIRMED: 'Повторное подтверждение',
  RAISED: 'Повышение грейда',
  LOWERED_BY_CHOICE: 'Подтверждён более низкий грейд (по выбору)',
} as const;

export function AssessmentsOverview() {
  const me = useMe();
  const spec = me.candidate?.activeSpecialization ?? null;
  const eligibility = useEligibility(spec);

  if (!spec) {
    return (
      <>
        <PageHeader title="Тестирование" />
        <EmptyState
          title="Сначала выберите специализацию"
          description="Пройдите короткий опрос: он поможет выбрать направление и уровень, с которого стоит начать."
          action={<LinkButton href="/candidate/survey">Пройти опрос</LinkButton>}
        />
      </>
    );
  }
  return (
    <>
      <PageHeader
        title="Тестирование"
        eyebrow={SPECIALIZATION_LABELS[spec]}
        description="Тест подтверждает грейд для поиска работодателями. Задания генерируются из банка проверенных шаблонов для каждого кандидата индивидуально и оцениваются на сервере."
      />
      {eligibility.isPending ? (
        <LoadingBlock />
      ) : eligibility.isError ? (
        <ErrorState error={eligibility.error} onRetry={() => eligibility.refetch()} />
      ) : (
        <Overview data={eligibility.data} />
      )}
    </>
  );
}

function Overview({ data }: { data: EligibilityResponse }) {
  const specs = useSpecializations();
  const groups = useMemo(() => specs.data?.find((s) => s.code === data.specialization)?.groups ?? [], [specs.data, data.specialization]);
  const r = data.rules;
  return (
    <div className="space-y-6">
      {data.activeAttempt ? (
        <Alert
          tone="brand"
          title={`Незавершённая попытка: ${GRADE_LABELS[data.activeAttempt.grade]}`}
          actions={<LinkButton href={`/candidate/assessments/${data.activeAttempt.id}`}>Продолжить тест</LinkButton>}
        >
          Таймер идёт на сервере и не останавливается при закрытии страницы. Попытка завершится {formatDateTime(data.activeAttempt.expiresAt)}.
        </Alert>
      ) : null}

      {data.qualification ? (
        <Alert tone="success" title={`Подтверждённый грейд: ${GRADE_LABELS[data.qualification.grade]}`}>
          Подтверждён {formatDateTime(data.qualification.confirmedAt)}, общий балл {data.qualification.overallScore}. Новая официальная оценка этой
          специализации доступна после {formatDateTime(data.qualification.nextReassessmentAt)}.
        </Alert>
      ) : null}

      <Card>
        <CardHeader title="Как устроен тест" />
        <div className="grid gap-6 lg:grid-cols-2">
          <ul className="space-y-2 text-[15px]">
            <li>
              <strong>{r.cases} мини-кейсов</strong> — по {r.itemsPerGroup} из каждой группы навыков, не менее {r.minScoredParts} оцениваемых частей.
            </li>
            <li>
              <strong>{r.durationMinutes} минут</strong> по серверному таймеру. Перезагрузка страницы не продлевает время.
            </li>
            <li>Ответы сохраняются автоматически. Правильность промежуточных ответов во время теста не показывается.</li>
            <li>Форматы: выбор одного или нескольких вариантов, число, сопоставление, упорядочивание.</li>
          </ul>
          <div>
            <div className="mb-2 text-sm font-medium">Группы навыков</div>
            <ul className="space-y-1.5">
              {groups.map((g, i) => (
                <li key={g.code} className="flex items-center gap-2 text-[15px]">
                  <span className="font-brand text-sm text-brand-600">0{i + 1}</span>
                  {g.title}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="mt-6 grid gap-3 rounded-xl bg-canvas p-4 text-sm sm:grid-cols-2">
          <div>
            <strong>Прохождение:</strong> общий балл ≥ {r.passOverall} и каждая группа ≥ {r.passGroupMin}.
          </div>
          <div>
            <strong>Уверенно:</strong> общий ≥ {r.confidentOverall} и каждая группа ≥ {r.confidentGroupMin}.
          </div>
          <div>
            <strong>Навык подтверждён:</strong> оценён минимум в {r.skillMinCases} кейсах с результатом ≥ {r.skillMinScore}.
          </div>
          <div>
            <strong>Пересдача:</strong> того же уровня — через {r.retryCooldownHours} ч; новая оценка после подтверждения — через {r.reassessmentDays} дней.
          </div>
        </div>
        <p className="mt-3 text-xs text-muted">
          Пороги — рабочие параметры MVP ({r.policyVersion}), не научно откалиброванная шкала. Высокий балл не повышает грейд автоматически; неуспех не понижает
          подтверждённый грейд.
        </p>
      </Card>

      <GradeChoice data={data} />
      <AttemptHistory />
      <QualificationHistory />
    </div>
  );
}

function GradeChoice({ data }: { data: EligibilityResponse }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const me = useMe();
  const [selected, setSelected] = useState<GradeEligibility | null>(null);
  const [key] = useState(() => idempotencyKey());

  const start = useMutation({
    mutationFn: (grade: Grade) =>
      api.post<AttemptView>('/candidate/assessments', { specialization: data.specialization, grade }, { headers: { 'Idempotency-Key': `${key}${grade}` } }),
    onSuccess: (attempt) => {
      queryClient.setQueryData(queryKeys.attempt(attempt.id), attempt);
      void queryClient.invalidateQueries({ queryKey: ['candidate'] });
      router.push(`/candidate/assessments/${attempt.id}`);
    },
    onError: (error) => {
      notify(errorMessage(error), 'danger');
      setSelected(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.eligibility(data.specialization) });
    },
  });

  return (
    <Card>
      <CardHeader title="Выберите уровень теста" description={me.candidate?.declaredGrade ? `Заявленный вами грейд — ${GRADE_LABELS[me.candidate.declaredGrade]}.` : undefined} />
      <div className="grid gap-3 md:grid-cols-3">
        {data.grades.map((g) => (
          <div key={g.grade} className="flex flex-col rounded-xl border border-line p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="font-brand text-lg font-bold">{GRADE_LABELS[g.grade]}</span>
              {g.allowed ? <Badge tone="success">доступен</Badge> : <Badge tone="warning">недоступен</Badge>}
            </div>
            <p className="mt-2 flex-1 text-sm text-ink-soft">{g.allowed ? 'Тест можно начать сейчас.' : g.message}</p>
            {g.availableAt ? <p className="mt-1 text-sm font-medium">Доступно: {formatDateTime(g.availableAt)}</p> : null}
            {g.warnings.map((w) => (
              <p key={w.code} className="mt-2 rounded-lg bg-warning-50 px-2 py-1.5 text-[13px] text-warning-700">
                {w.message}
              </p>
            ))}
            <Button className="mt-4" disabled={!g.allowed} onClick={() => setSelected(g)}>
              Начать тест
            </Button>
          </div>
        ))}
      </div>
      <ConfirmDialog
        open={Boolean(selected)}
        title={selected ? `Начать тест на уровень ${GRADE_LABELS[selected.grade]}?` : ''}
        confirmLabel="Начать — таймер запустится"
        loading={start.isPending}
        onClose={() => setSelected(null)}
        onConfirm={() => selected && start.mutate(selected.grade)}
      >
        <p>
          На тест отводится <strong>{data.rules.durationMinutes} минут</strong>. Таймер серверный: закрытие вкладки не останавливает его.
        </p>
        <p>Кнопка «Прервать» завершает попытку без результата — повторить этот уровень можно будет через {data.rules.retryCooldownHours} ч.</p>
        {selected?.warnings.map((w) => (
          <Alert key={w.code} tone="warning">
            {w.message}
          </Alert>
        ))}
      </ConfirmDialog>
    </Card>
  );
}

function AttemptHistory() {
  const attempts = useAttempts();
  return (
    <Card>
      <CardHeader title="История попыток" />
      {attempts.isPending ? (
        <Spinner />
      ) : attempts.isError ? (
        <ErrorState error={attempts.error} onRetry={() => attempts.refetch()} />
      ) : attempts.data.length === 0 ? (
        <p className="text-muted">Попыток пока не было.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[15px]">
            <thead className="text-sm text-muted">
              <tr className="border-b border-line">
                <th className="py-2 pr-3 font-medium">Начата</th>
                <th className="py-2 pr-3 font-medium">Специализация</th>
                <th className="py-2 pr-3 font-medium">Уровень</th>
                <th className="py-2 pr-3 font-medium">Статус</th>
                <th className="py-2 pr-3 font-medium">Балл</th>
                <th className="py-2 font-medium">
                  <span className="sr-only">Действия</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {attempts.data.map((a) => (
                <tr key={a.id} className="border-b border-line last:border-0">
                  <td className="py-2.5 pr-3">{formatDateTime(a.startedAt)}</td>
                  <td className="py-2.5 pr-3">{a.specializationTitle}</td>
                  <td className="py-2.5 pr-3">{GRADE_LABELS[a.grade]}</td>
                  <td className="py-2.5 pr-3">
                    <AttemptStatusBadge status={a.status} />
                    {a.isSynthetic ? <span className="ml-2 text-xs text-muted">демо</span> : null}
                  </td>
                  <td className="py-2.5 pr-3 font-brand">{a.overallScore ?? '—'}</td>
                  <td className="py-2.5 text-right">
                    <Link
                      className="font-medium text-brand-600 hover:underline"
                      href={a.status === 'IN_PROGRESS' ? `/candidate/assessments/${a.id}` : `/candidate/assessments/${a.id}/result`}
                    >
                      {a.status === 'IN_PROGRESS' ? 'Продолжить' : 'Результат'}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function QualificationHistory() {
  const quals = useQualifications();
  if (quals.isPending || quals.isError || quals.data.history.length === 0) return null;
  return (
    <Card>
      <CardHeader title="История подтверждений" description="Неизменяемый журнал: все подтверждения сохраняются, даже если грейд позже изменился." />
      <ul className="space-y-2">
        {quals.data.history.map((h) => (
          <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
            <span>
              <strong>{SPECIALIZATION_LABELS[h.specialization]}</strong> · {GRADE_LABELS[h.grade]}
              {h.previousGrade ? ` (было: ${GRADE_LABELS[h.previousGrade]})` : ''} — {EVENT_LABELS[h.eventType]}
            </span>
            <span className="text-sm text-muted">
              {formatDateTime(h.occurredAt)} · балл {h.overallScore}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
