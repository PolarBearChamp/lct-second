'use client';

import {
  CONTACT_CHANNEL_LABELS,
  GRADE_LABELS,
  SKILL_MODE_LABELS,
  WORK_FORMAT_LABELS,
  type CandidateApplicationDetail,
} from '@fsp/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ExplanationPanel } from '@/components/employer/explanation-panel';
import { CompanyVerifiedBadge } from '@/components/employer/company-verification';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, LinkButton } from '@/components/ui/button';
import { Card, CardHeader, DefinitionList, PageHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Checkbox, Field, Textarea } from '@/components/ui/field';
import { ErrorState, LoadingBlock } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { ApplicationStatusBadge } from '@/components/vacancies/status-badges';
import { api, errorMessage } from '@/lib/api/client';
import { formatDate, formatSalaryRange } from '@/lib/format';
import { useCandidateVacancy } from '@/lib/vacancy-queries';

export function CandidateVacancyView({ id }: { id: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const vacancy = useCandidateVacancy(id);
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [note, setNote] = useState('');

  const apply = useMutation({
    mutationFn: () => api.post<CandidateApplicationDetail>(`/candidate/vacancies/${id}/applications`, { confirmDisclosure: true, ...(note.trim() ? { coverNote: note.trim() } : {}) }),
    onSuccess: (application) => {
      void queryClient.invalidateQueries({ queryKey: ['candidate', 'vacancies'] });
      void queryClient.invalidateQueries({ queryKey: ['candidate', 'vacancy', id] });
      void queryClient.invalidateQueries({ queryKey: ['candidate', 'applications'] });
      setOpen(false);
      notify('Отклик отправлен — контакты раскрыты только этой компании');
      router.push(`/candidate/applications/${application.id}`);
    },
    onError: (error) => notify(errorMessage(error), 'danger'),
  });

  if (vacancy.isPending) return <LoadingBlock lines={6} />;
  if (vacancy.isError) return <ErrorState error={vacancy.error} onRetry={() => vacancy.refetch()} />;
  const v = vacancy.data;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/candidate/vacancies" className="hover:underline">
            ← Все вакансии
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {v.title}
            {v.myApplication ? <ApplicationStatusBadge status={v.myApplication.status} /> : null}
          </span>
        }
      />
      {v.status === 'CLOSED' ? <Alert tone="neutral" title="Вакансия закрыта">Новые отклики не принимаются.</Alert> : null}
      <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="text-sm text-muted">Зарплата</div>
                <div className="font-brand text-3xl font-bold text-brand-700">{formatSalaryRange(v.salaryFrom, v.salaryTo, false)}</div>
                <div className="text-sm text-muted">в месяц до вычета налогов (GROSS)</div>
              </div>
              <Badge tone="brand">
                {WORK_FORMAT_LABELS[v.workFormat]}
                {v.city ? `, ${v.city}` : ''}
              </Badge>
            </div>
            <p className="mt-5 whitespace-pre-line text-[15px] leading-relaxed">{v.description}</p>
          </Card>

          <Card>
            <CardHeader as="h3" title="Требования" description={`${v.specializationTitle} · допустимые грейды: ${v.allowedGrades.map((g) => GRADE_LABELS[g]).join(', ')}`} />
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
            <p className="mt-3 text-xs text-muted">Обязательные навыки считаются выполненными только при подтверждении тестом.</p>
          </Card>

          <Card>
            <CardHeader as="h3" title="Как вы соответствуете требованиям" description="Считается по данным, подтверждённым тестом. Несоответствие не запрещает отклик — работодатель увидит, что именно не подтверждено." />
            {v.fit === null ? (
              <Alert tone="warning" title="Нет подтверждённой квалификации по этой специализации">
                Пройдите тест на <Link className="underline" href="/candidate/assessments">странице тестирования</Link> — без него откликнуться нельзя.
              </Alert>
            ) : v.fit.passes && v.fit.explanation && v.fit.score !== null ? (
              <>
                <div className="mb-4 flex items-baseline gap-2">
                  <span className="font-brand text-3xl font-bold text-brand-700">{v.fit.score.toFixed(1)}</span>
                  <span className="text-sm text-muted">из 100 · обязательные условия выполнены</span>
                </div>
                <ExplanationPanel explanation={v.fit.explanation} score={v.fit.score} />
              </>
            ) : (
              <Alert tone="warning" title="Не все обязательные условия подтверждены">
                <ul className="mt-1 list-disc pl-5">
                  {v.fit.violations.map((violation) => (
                    <li key={violation}>{violation}</li>
                  ))}
                </ul>
              </Alert>
            )}
          </Card>

          <Card>
            <CardHeader as="h3" title="Компания" />
            <DefinitionList
              items={[
                {
                  term: 'Название',
                  value: (
                    <span className="flex flex-wrap items-center gap-2">
                      {v.company.name}
                      <CompanyVerifiedBadge verified={v.company.verified} />
                    </span>
                  ),
                },
                { term: 'Отрасль', value: v.company.industryTitle ?? '—' },
                {
                  term: 'Сайт',
                  value: v.company.website ? (
                    <a href={v.company.website} target="_blank" rel="noopener noreferrer nofollow" className="text-brand-600 hover:underline">
                      {v.company.website}
                    </a>
                  ) : (
                    '—'
                  ),
                },
                { term: 'Опубликована', value: formatDate(v.publishedAt) },
              ]}
            />
            {v.company.description ? <p className="mt-4 whitespace-pre-line text-[15px] text-ink-soft">{v.company.description}</p> : null}
            <p className="mt-4 text-xs text-muted">Компании не проходят верификацию в MVP — проверьте работодателя перед передачей документов.</p>
          </Card>
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader as="h3" title="Отклик" />
            {v.myApplication ? (
              <div className="space-y-3">
                <p className="text-sm">Вы уже откликнулись на эту вакансию.</p>
                <LinkButton href={`/candidate/applications/${v.myApplication.id}`}>Открыть мой отклик</LinkButton>
              </div>
            ) : v.canApply ? (
              <div className="space-y-3">
                <p className="text-sm text-ink-soft">Отклик раскроет выбранные контакты только компании «{v.company.name}». Перед отправкой вы увидите, что именно будет раскрыто.</p>
                <Button onClick={() => setOpen(true)}>Откликнуться</Button>
              </div>
            ) : (
              <div className="space-y-3">
                <Alert tone="warning" title="Откликнуться пока нельзя">
                  <ul className="mt-1 list-disc pl-5">
                    {v.blockers.map((blocker) => (
                      <li key={blocker.code}>{blocker.message}</li>
                    ))}
                  </ul>
                </Alert>
                {v.blockers.some((b) => b.code === 'QUALIFICATION_REQUIRED') ? <LinkButton href="/candidate/assessments" variant="outline" size="sm">К тестированию</LinkButton> : null}
                {v.blockers.some((b) => b.code === 'PROFILE_INCOMPLETE') ? <LinkButton href="/candidate/profile" variant="outline" size="sm">К профилю</LinkButton> : null}
                {v.blockers.some((b) => b.code === 'NO_CONTACT_CHANNEL') ? <LinkButton href="/candidate/settings#channels" variant="outline" size="sm">Выбрать каналы связи</LinkButton> : null}
              </div>
            )}
          </Card>
        </aside>
      </div>

      <ConfirmDialog
        open={open}
        title="Откликнуться на вакансию?"
        confirmLabel="Откликнуться и раскрыть контакты"
        confirmDisabled={!confirmed || v.disclosure.channels.length === 0}
        loading={apply.isPending}
        onClose={() => setOpen(false)}
        onConfirm={() => apply.mutate()}
      >
        <p>
          <strong>{v.company.name}</strong>: {v.title}, <strong>{formatSalaryRange(v.salaryFrom, v.salaryTo)}</strong>, {WORK_FORMAT_LABELS[v.workFormat].toLowerCase()}.
        </p>
        <div>
          <p className="font-medium text-ink">Только этой компании будет раскрыто:</p>
          <ul className="mt-1 list-disc pl-5">
            <li>ФИО: {v.disclosure.fullName ?? 'не заполнено'}</li>
            {v.disclosure.channels.map((c) => (
              <li key={c.channel}>
                {CONTACT_CHANNEL_LABELS[c.channel]}: {c.value}
              </li>
            ))}
            <li>{v.disclosure.alsoShared.filter((s) => s !== 'ФИО').join(', ')}</li>
          </ul>
        </div>
        <Field label="Сопроводительное сообщение (необязательно)" hint="До 1000 символов. Не указывайте то, что не готовы показать этой компании.">
          {(props) => <Textarea rows={3} maxLength={1000} {...props} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
        <Checkbox checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} label="Я понимаю, какие данные будут раскрыты, и согласен(на) на это" />
        <p className="text-xs text-muted">Доступ можно отозвать в любой момент в «Приватность и ФСП»; уже полученную копию данных компании отозвать технически невозможно.</p>
      </ConfirmDialog>
    </>
  );
}
