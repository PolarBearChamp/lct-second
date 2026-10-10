import { WORK_FORMAT_LABELS, type CandidateSummary } from '@fsp/contracts';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { InvitationStatusBadge } from '@/components/invitations/invitation-status';
import { IntegrityBadge } from '@/components/profile/integrity';
import { Badge } from '@/components/ui/badge';
import { formatSalaryRange } from '@/lib/format';
import { BookmarkButton } from './bookmark-button';

/** Краткая обезличенная карточка в выдаче: без ФИО и контактов. */
export function CandidateSummaryCard({
  candidate,
  href,
  rank,
  score,
  children,
}: {
  candidate: CandidateSummary;
  href: string;
  rank?: number;
  /** null — балл подбора не считается (грейд не подтверждён тестом). */
  score?: number | null;
  children?: ReactNode;
}) {
  return (
    <article className="card p-5" aria-label={candidate.displayName}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          {rank !== undefined ? (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 font-brand font-bold text-brand-700" aria-label={`Место ${rank}`}>
              {rank}
            </span>
          ) : null}
          <div className="min-w-0">
            <Link href={href} className="text-lg font-bold hover:text-brand-600 hover:underline">
              {candidate.displayName}
            </Link>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
              {candidate.gradeConfirmed ? (
                <>
                  <Badge tone="success">Грейд по тесту: {candidate.gradeTitle}</Badge>
                  <span className="text-muted">балл теста {candidate.overallScore}</span>
                </>
              ) : (
                <>
                  <Badge tone="warning">Грейд не подтверждён тестом</Badge>
                  <span className="text-muted">заявлен: {candidate.declaredGradeTitle ?? "не указан"}</span>
                </>
              )}
              {candidate.minor ? <Badge tone="warning" title="Особые условия труда работников до 18 лет (ТК РФ, гл. 42)">16–17 лет</Badge> : null}
              <IntegrityBadge level={candidate.integrityLevel} />
              {candidate.fsp.relevantEvents ? <Badge tone="brand">ФСП: {candidate.fsp.relevantEvents} мероприятие(й)</Badge> : null}
              {candidate.activeInvitation ? <InvitationStatusBadge status={candidate.activeInvitation.status} /> : null}
              {candidate.hasContactAccess ? <Badge tone="success">контакты доступны</Badge> : null}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {score !== undefined && score !== null ? (
            <div className="text-right">
              <div className="font-brand text-2xl font-bold text-brand-700">{score.toFixed(1)}</div>
              <div className="text-xs text-muted">соответствие</div>
            </div>
          ) : score === null ? (
            <div className="max-w-[9rem] text-right text-xs text-muted">балл не считается: нет результата теста</div>
          ) : null}
          <BookmarkButton candidateId={candidate.candidateId} initial={candidate.bookmarked} />
        </div>
      </div>
      {candidate.otherCategories.length ? (
        <div className="mt-2 text-sm text-muted">
          Также подтверждено: {candidate.otherCategories.map((c) => `${c.specializationTitle} · ${c.gradeTitle}`).join('; ')}
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {candidate.verifiedSkills.map((s) => (
          <Badge key={s.code} tone="success">
            ✓ {s.title}
          </Badge>
        ))}
        {candidate.selfReportedSkillsCount ? <Badge>+{candidate.selfReportedSkillsCount} указано кандидатом</Badge> : null}
      </div>
      <div className="mt-3 text-sm text-muted">
        {candidate.city ?? 'город не указан'} · {candidate.workFormats.map((f) => WORK_FORMAT_LABELS[f]).join(', ')} · ожидания:{' '}
        {candidate.salaryHidden ? 'скрыты кандидатом' : candidate.salary ? formatSalaryRange(candidate.salary.from, candidate.salary.to, false) : 'не указаны'}
      </div>
      {children ? <div className="mt-4 border-t border-line pt-4">{children}</div> : null}
    </article>
  );
}
