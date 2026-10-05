'use client';

import { GRADE_LABELS, SKILL_EVIDENCE_LABELS, type AttemptResult } from '@fsp/contracts';
import { AttemptStatusBadge } from '@/components/candidate/attempt-status';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { LinkButton } from '@/components/ui/button';
import { Card, CardHeader, PageHeader } from '@/components/ui/card';
import { BigScore, ScoreBar } from '@/components/ui/score';
import { ErrorState, LoadingBlock } from '@/components/ui/states';
import { formatDateTime } from '@/lib/format';
import { useAttemptResult } from '@/lib/queries';

export function AttemptResultView({ attemptId }: { attemptId: string }) {
  const result = useAttemptResult(attemptId);
  if (result.isPending) return <LoadingBlock label="Подсчитываем результат…" />;
  if (result.isError) return <ErrorState error={result.error} onRetry={() => result.refetch()} />;
  return <ResultBody r={result.data} />;
}

function ResultBody({ r }: { r: AttemptResult }) {
  const tone = r.status === 'PASSED' ? 'success' : r.status === 'FAILED' ? 'danger' : 'warning';
  const t = r.thresholds;
  const nextGrade = r.eligibility.grades;
  return (
    <>
      <PageHeader
        eyebrow={`${r.specializationTitle} · уровень ${GRADE_LABELS[r.grade]}`}
        title="Результат тестирования"
        actions={
          <LinkButton href="/candidate/assessments" variant="outline">
            К тестированию
          </LinkButton>
        }
      />
      <div className="space-y-6">
        <Alert tone={tone} title={r.statusMessage}>
          Попытка начата {formatDateTime(r.startedAt)}, завершена {formatDateTime(r.finishedAt)}.
        </Alert>

        {r.overallScore !== null ? (
          <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
            <Card>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted">Общий балл</span>
                <AttemptStatusBadge status={r.status} />
              </div>
              <div className="mt-3">
                <BigScore score={r.overallScore} caption="из 100" />
              </div>
              {r.confident ? (
                <Badge tone="success" className="mt-3">
                  Уверенное прохождение
                </Badge>
              ) : null}
              <p className="mt-4 text-sm text-muted">
                Порог прохождения: общий ≥ {t.passOverall} и каждая группа ≥ {t.passGroupMin}. Уверенно: общий ≥ {t.confidentOverall}, группы ≥{' '}
                {t.confidentGroupMin}.
              </p>
            </Card>
            <Card>
              <CardHeader title="Группы навыков" description="Балл группы — средний результат её мини-кейсов. Отметка на шкале — минимальный порог группы." />
              <div className="space-y-4">
                {r.groups.map((g) => (
                  <div key={g.group}>
                    <ScoreBar label={g.title} score={g.score} threshold={t.passGroupMin} />
                    <p className="mt-1 text-xs text-muted">
                      Верных частей: {g.earnedParts} из {g.totalParts} в {g.items} кейсах
                    </p>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        ) : (
          <Card>
            <p className="text-muted">Для прерванной попытки баллы не рассчитываются.</p>
          </Card>
        )}

        {r.skills.length ? (
          <Card>
            <CardHeader
              title="Навыки, оценённые в тесте"
              description={`Навык подтверждается, если он оценён минимум в ${t.skillMinCases} разных кейсах и результат по нему ≥ ${t.skillMinScore}. Подтверждение действует только при успешном прохождении теста.`}
            />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-[15px]">
                <thead className="text-sm text-muted">
                  <tr className="border-b border-line">
                    <th className="py-2 pr-3 font-medium">Навык</th>
                    <th className="py-2 pr-3 font-medium">Результат</th>
                    <th className="py-2 pr-3 font-medium">Кейсов</th>
                    <th className="py-2 font-medium">Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {r.skills.map((s) => (
                    <tr key={s.skill} className="border-b border-line last:border-0">
                      <td className="py-2 pr-3">{s.title}</td>
                      <td className="py-2 pr-3 font-brand">{s.score}</td>
                      <td className="py-2 pr-3">{s.cases}</td>
                      <td className="py-2">
                        <Badge tone={s.status === 'CONFIRMED' && r.passed ? 'success' : s.status === 'BELOW_THRESHOLD' ? 'warning' : 'neutral'}>
                          {s.status === 'CONFIRMED' && !r.passed ? 'Не подтверждается: тест не пройден' : SKILL_EVIDENCE_LABELS[s.status]}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Рекомендации" />
            {r.recommendations.length ? (
              <ul className="space-y-2">
                {r.recommendations.map((rec, index) => (
                  <li key={index} className="rounded-lg border border-line px-3 py-2 text-[15px]">
                    {rec.message}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted">Отличный результат — специальных рекомендаций нет.</p>
            )}
          </Card>
          <Card>
            <CardHeader title="Следующие попытки" description="Даты рассчитаны сервером по политике пересдач." />
            <ul className="space-y-2">
              {nextGrade.map((g) => (
                <li key={g.grade} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
                  <span className="font-medium">{GRADE_LABELS[g.grade]}</span>
                  {g.allowed ? (
                    <Badge tone="success">можно сейчас</Badge>
                  ) : (
                    <span className="text-sm text-muted">{g.availableAt ? `с ${formatDateTime(g.availableAt)}` : g.message}</span>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <p className="text-xs text-muted">
          Версии: политика {r.versions.policy}, банк {r.versions.bank}, план {r.versions.blueprint}. Правильные ответы и ключи проверки не показываются, чтобы
          задания банка не распространялись.
        </p>
      </div>
    </>
  );
}
