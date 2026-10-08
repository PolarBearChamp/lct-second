import {
  CONTACT_CHANNEL_LABELS,
  SKILL_EVIDENCE_LABELS,
  WORK_FORMAT_LABELS,
  type CandidateProfileView,
} from '@fsp/contracts';
import type { ReactNode } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { ScoreBar } from '@/components/ui/score';
import { formatDate, formatMonths, formatSalaryRange } from '@/lib/format';

const OUTCOME_LABELS = { WIN: 'Победа', PRIZE: 'Призёр', PARTICIPATION: 'Участие' } as const;
const LEVEL_LABELS: Record<string, string> = {
  INTERNATIONAL: 'Международный',
  NATIONAL: 'Всероссийский',
  INTERREGIONAL: 'Межрегиональный',
  REGIONAL: 'Региональный',
};
const DISCIPLINE_LABELS: Record<string, string> = {
  PRODUCT: 'Продуктовое программирование',
  ALGORITHMIC: 'Алгоритмическое программирование',
  SECURITY: 'Программирование систем ИБ',
  ROBOTICS: 'Программирование робототехники',
  UAV: 'Программирование БАС',
};

function Section({ title, tone, children }: { title: string; tone?: 'verified' | 'self' | 'gap'; children: ReactNode }) {
  const marker = tone === 'verified' ? 'bg-success-600' : tone === 'self' ? 'bg-line-strong' : tone === 'gap' ? 'bg-warning-600' : 'bg-brand-500';
  return (
    <section className="border-t border-line pt-4">
      <h3 className="mb-3 flex items-center gap-2 text-base font-bold">
        <span className={`h-2.5 w-2.5 rounded-full ${marker}`} aria-hidden />
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * Карточка кандидата. Данные приходят из серверного представления (OWNER / EMPLOYER_REDACTED / EMPLOYER_GRANTED):
 * компонент показывает только то, что вернул API, и ничего не скрывает сам.
 */
export function CandidateCard({ view, extra }: { view: CandidateProfileView; extra?: ReactNode }) {
  const q = view.qualification;
  const verifiedSkills = view.skills.filter((s) => s.source === 'VERIFIED');
  const selfSkills = view.skills.filter((s) => s.source === 'SELF_REPORTED');
  const notProven = q ? q.skillEvidence.filter((s) => s.status !== 'CONFIRMED') : [];
  return (
    <article className="card space-y-5 p-5 sm:p-6" aria-label={view.displayName}>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-brand-50 font-brand text-lg font-bold text-brand-600" aria-hidden>
            {view.alias.slice(0, 2)}
          </div>
          <div className="min-w-0">
            <h2 className="text-xl font-bold">{view.displayName}</h2>
            <p className="text-muted">{view.specialization?.title ?? 'Специализация не выбрана'}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {q ? <Badge tone="success">Грейд по тесту: {q.gradeTitle}</Badge> : <Badge tone="warning">Грейд не подтверждён</Badge>}
          {view.minor ? <Badge tone="warning" title="Особые условия труда работников до 18 лет (ТК РФ, гл. 42)">16–17 лет</Badge> : null}
          {view.mode === 'EMPLOYER_REDACTED' ? <Badge>Обезличенная карточка</Badge> : null}
          {view.mode === 'EMPLOYER_GRANTED' ? <Badge tone="brand">Доступ к контактам выдан</Badge> : null}
        </div>
      </header>

      {extra}

      <Section title="Подтверждено тестом" tone="verified">
        {q ? (
          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-3">
              <ScoreBar label="Общий балл" score={q.overallScore} />
              {q.groupScores.map((g) => (
                <ScoreBar key={g.group} label={g.title} score={g.score} compact />
              ))}
              <p className="text-xs text-muted">Подтверждено {formatDate(q.confirmedAt)}</p>
            </div>
            <div>
              <div className="mb-2 text-sm text-muted">Навыки, подтверждённые заданиями</div>
              {verifiedSkills.length ? (
                <ul className="flex flex-wrap gap-2">
                  {verifiedSkills.map((s) => (
                    <li key={s.code}>
                      <Badge tone="success">✓ {s.title}</Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">Нет навыков с достаточным покрытием заданиями.</p>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">Подтверждённой квалификации по активной специализации нет.</p>
        )}
      </Section>

      <Section title="Указано кандидатом" tone="self">
        <dl className="grid gap-x-6 gap-y-2 text-[15px] sm:grid-cols-[180px_1fr]">
          <dt className="text-muted">Заявленный грейд</dt>
          <dd>{view.declaredGrade?.title ?? '—'}</dd>
          <dt className="text-muted">Опыт</dt>
          <dd>{formatMonths(view.experienceMonths)}</dd>
          <dt className="text-muted">Роли</dt>
          <dd>{view.teamRoles.map((r) => r.title).join(', ') || '—'}</dd>
          <dt className="text-muted">Soft skills</dt>
          <dd>{view.softSkills.map((r) => r.title).join(', ') || '—'}</dd>
          <dt className="text-muted">Отрасли</dt>
          <dd>{view.industries.map((r) => r.title).join(', ') || '—'}</dd>
        </dl>
        {selfSkills.length ? (
          <ul className="mt-3 flex flex-wrap gap-2" aria-label="Стек, указанный кандидатом">
            {selfSkills.map((s) => (
              <li key={s.code}>
                <Badge title="Указано кандидатом, тестом не подтверждено">
                  {s.title}
                  {s.months ? ` · ${formatMonths(s.months)}` : ''}
                </Badge>
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

      {notProven.length || selfSkills.length ? (
        <Section title="Что пока не подтверждено" tone="gap">
          <ul className="space-y-1 text-[15px]">
            {notProven.map((s) => (
              <li key={s.skill}>
                {s.title}: {SKILL_EVIDENCE_LABELS[s.status].toLowerCase()} (оценён в {s.cases} кейс(ах), результат {s.score})
              </li>
            ))}
            {selfSkills.length ? <li>Стек из самоописания ({selfSkills.length}) не проверялся тестом.</li> : null}
          </ul>
        </Section>
      ) : null}

      <Section title="Условия">
        <dl className="grid gap-x-6 gap-y-2 text-[15px] sm:grid-cols-[180px_1fr]">
          <dt className="text-muted">Город</dt>
          <dd>{view.city ?? '—'}</dd>
          <dt className="text-muted">Формат работы</dt>
          <dd>{view.workFormats.map((f) => WORK_FORMAT_LABELS[f]).join(', ') || '—'}</dd>
          <dt className="text-muted">Зарплатные ожидания</dt>
          <dd>{view.salaryExpectation ? formatSalaryRange(view.salaryExpectation.from, view.salaryExpectation.to) : 'не указаны'}</dd>
        </dl>
      </Section>

      <Section title="Достижения ФСП">
        {view.fsp.achievements.length ? (
          <>
            {view.fsp.demoNotice ? (
              <Alert tone="warning" className="mb-3">
                {view.fsp.demoNotice}
              </Alert>
            ) : null}
            <ul className="space-y-2">
              {view.fsp.achievements.map((a, index) => (
                <li key={index} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-[15px]">
                  <span>
                    <strong>{OUTCOME_LABELS[a.outcome]}</strong>
                    {a.place ? ` (${a.place} место)` : ''} · {DISCIPLINE_LABELS[a.discipline ?? ''] ?? a.discipline ?? 'дисциплина не указана'} ·{' '}
                    {LEVEL_LABELS[a.eventLevel ?? ''] ?? a.eventLevel ?? 'уровень не указан'} · {a.year ?? 'год не указан'}
                    {a.eventTitle ? <span className="block text-sm text-muted">{a.eventTitle}</span> : null}
                  </span>
                  <span className="flex flex-wrap gap-1">
                    {a.relevantToSpecialization ? <Badge tone="brand">релевантно специализации</Badge> : <Badge>не влияет на подбор</Badge>}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm text-muted">
            {view.fsp.linked ? 'ФСП ID привязан, достижений пока нет.' : 'Достижения ФСП не привязаны. Это не влияет на доступ к подбору.'}
          </p>
        )}
      </Section>

      {view.personal ? (
        <Section title={view.mode === 'OWNER' ? 'Личные данные (видны работодателю только после принятия приглашения)' : 'Данные, раскрытые кандидатом'}>
          <dl className="grid gap-x-6 gap-y-2 text-[15px] sm:grid-cols-[180px_1fr]">
            <dt className="text-muted">ФИО</dt>
            <dd>{view.personal.fullName ?? '—'}</dd>
            {view.contacts?.map((c) => (
              <div key={c.channel} className="contents">
                <dt className="text-muted">{CONTACT_CHANNEL_LABELS[c.channel]}</dt>
                <dd className="break-all">{c.value}</dd>
              </div>
            ))}
            <dt className="text-muted">Ссылки</dt>
            <dd className="break-all">
              {view.personal.externalLinks.length
                ? view.personal.externalLinks.map((link) => (
                    <a key={link} href={link} target="_blank" rel="noopener noreferrer nofollow" className="block text-brand-600 hover:underline">
                      {link}
                    </a>
                  ))
                : '—'}
            </dd>
          </dl>
          {view.personal.experienceDescription ? <p className="mt-3 whitespace-pre-line text-[15px]">{view.personal.experienceDescription}</p> : null}
        </Section>
      ) : null}
    </article>
  );
}
