'use client';

import { APPLICATION_STATUS_LABELS, WORK_FORMAT_LABELS, type EmployerApplicationDetail } from '@fsp/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ExplanationPanel } from '@/components/employer/explanation-panel';
import { CandidateCard } from '@/components/profile/candidate-card';
import { Alert } from '@/components/ui/alert';
import { Button, buttonClass, LinkButton } from '@/components/ui/button';
import { Card, CardHeader, PageHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { ErrorState, LoadingBlock } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { ApplicationStatusBadge } from '@/components/vacancies/status-badges';
import { api, errorMessage } from '@/lib/api/client';
import { formatDateTime, formatSalaryRange } from '@/lib/format';
import { useEmployerApplication, vacancyKeys } from '@/lib/vacancy-queries';

export function ApplicationView({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const application = useEmployerApplication(id);
  const [rejectOpen, setRejectOpen] = useState(false);
  const viewSent = useRef(false);

  const onUpdated = (data: EmployerApplicationDetail) => {
    queryClient.setQueryData(vacancyKeys.employerApplication(id), data);
    void queryClient.invalidateQueries({ queryKey: vacancyKeys.applicationsAll });
    void queryClient.invalidateQueries({ queryKey: vacancyKeys.employerAll });
    void queryClient.invalidateQueries({ queryKey: ['me'] });
  };
  const markViewed = useMutation({ mutationFn: () => api.post<EmployerApplicationDetail>(`/employer/applications/${id}/view`), onSuccess: onUpdated });
  const shortlist = useMutation({
    mutationFn: () => api.post<EmployerApplicationDetail>(`/employer/applications/${id}/shortlist`),
    onSuccess: (data) => {
      onUpdated(data);
      notify('Кандидат в шорт-листе');
    },
    onError: (error) => notify(errorMessage(error), 'danger'),
  });
  const reject = useMutation({
    mutationFn: () => api.post<EmployerApplicationDetail>(`/employer/applications/${id}/reject`),
    onSuccess: (data) => {
      onUpdated(data);
      setRejectOpen(false);
      notify('Отклик отклонён', 'info');
    },
    onError: (error) => notify(errorMessage(error), 'danger'),
  });

  // Явное открытие конкретного отклика фиксирует просмотр; список и предзагрузка статус не меняют.
  const status = application.data?.status;
  const { mutate: sendView } = markViewed;
  useEffect(() => {
    if (status === 'SENT' && !viewSent.current) {
      viewSent.current = true;
      sendView();
    }
  }, [status, sendView]);

  if (application.isPending) return <LoadingBlock lines={6} />;
  if (application.isError) return <ErrorState error={application.error} onRetry={() => application.refetch()} />;
  const a = application.data;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/employer/vacancies/${a.vacancyId}`} className="hover:underline">
            ← {a.vacancyTitle}
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {a.profile?.displayName ?? `Кандидат ${a.candidateAlias}`}
            <ApplicationStatusBadge status={a.status} />
          </span>
        }
        actions={
          a.profile ? (
            <>
              <Link href={`/employer/candidates/${a.candidateId}`} className={buttonClass('outline', 'sm')}>
                Карточка и приглашение
              </Link>
              <a href={`/api/v1/employer/candidates/${a.candidateId}/pdf`} className={buttonClass('outline', 'sm')} download>
                PDF ({a.profile.mode === 'EMPLOYER_GRANTED' ? 'с контактами' : 'обезличенный'})
              </a>
            </>
          ) : null
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          {a.coverNote ? (
            <Card>
              <CardHeader as="h3" title="Сообщение кандидата" description={`Отклик от ${formatDateTime(a.createdAt)}`} />
              <p className="whitespace-pre-line text-[15px] leading-relaxed">{a.coverNote}</p>
            </Card>
          ) : null}

          <Card>
            <CardHeader
              as="h3"
              title="Соответствие требованиям вакансии"
              description="Те же правила, что при подборе по потребности: обязательные условия — по данным, подтверждённым тестом. Оценка — относительная мера, а не вероятность найма."
            />
            {a.fit === null ? (
              <p className="text-sm text-muted">Оценка недоступна.</p>
            ) : a.fit.passes && a.fit.explanation && a.fit.score !== null ? (
              <>
                <div className="mb-4 flex items-baseline gap-2">
                  <span className="font-brand text-3xl font-bold text-brand-700">{a.fit.score.toFixed(1)}</span>
                  <span className="text-sm text-muted">из 100 · все обязательные условия выполнены</span>
                </div>
                <ExplanationPanel explanation={a.fit.explanation} score={a.fit.score} />
              </>
            ) : (
              <Alert tone="warning" title="Не все обязательные условия вакансии подтверждены">
                <ul className="mt-1 list-disc pl-5">
                  {a.fit.violations.map((violation) => (
                    <li key={violation}>{violation}</li>
                  ))}
                </ul>
                <p className="mt-2">Кандидат откликнулся сам, поэтому отклик не отсекается автоматически — решение за вами.</p>
              </Alert>
            )}
          </Card>

          {a.profile ? (
            <CandidateCard view={a.profile} />
          ) : (
            <Alert tone="neutral" title="Карточка кандидата недоступна">
              Кандидат закрыл компании доступ к контактам, а его профиль скрыт из поиска. Статус и сообщение отклика сохранены.
            </Alert>
          )}
        </div>

        <aside className="space-y-6">
          {a.canDecide ? (
            <Card>
              <CardHeader as="h3" title="Решение" />
              <div className="flex flex-col gap-2">
                <Button onClick={() => shortlist.mutate()} loading={shortlist.isPending} disabled={a.status === 'SHORTLISTED'}>
                  {a.status === 'SHORTLISTED' ? 'В шорт-листе' : 'Взять в шорт-лист'}
                </Button>
                <Button variant="outline" onClick={() => setRejectOpen(true)}>
                  Отклонить
                </Button>
              </div>
              <p className="mt-3 text-xs text-muted">
                Свяжитесь с кандидатом по раскрытым контактам. Статус виден кандидату в его откликах.
              </p>
            </Card>
          ) : (
            <Alert tone="neutral" title={`Отклик ${APPLICATION_STATUS_LABELS[a.status].toLowerCase()}`}>
              {a.status === 'WITHDRAWN' ? 'Кандидат отозвал отклик.' : 'Вы отклонили этот отклик.'}
            </Alert>
          )}
          <Card>
            <CardHeader as="h3" title="Вакансия на момент отклика" description={a.vacancyCurrentVersion ? `Сейчас вакансия в версии ${a.vacancyCurrentVersion}` : undefined} />
            <div className="font-brand text-xl font-bold text-brand-700">{formatSalaryRange(a.salaryFrom, a.salaryTo, false)}</div>
            <div className="mb-3 text-sm text-muted">
              {a.specializationTitle} · {WORK_FORMAT_LABELS[a.workFormat]}
            </div>
            <p className="whitespace-pre-line text-sm text-ink-soft">{a.description}</p>
            <LinkButton href={`/employer/vacancies/${a.vacancyId}`} variant="outline" size="sm" className="mt-4">
              К вакансии
            </LinkButton>
          </Card>
          <Card>
            <CardHeader as="h3" title="История" />
            <ol className="space-y-2 text-sm">
              {a.events.map((e, index) => (
                <li key={index} className="flex justify-between gap-3">
                  <span>{APPLICATION_STATUS_LABELS[e.toStatus]}</span>
                  <span className="text-muted">{formatDateTime(e.occurredAt)}</span>
                </li>
              ))}
            </ol>
          </Card>
        </aside>
      </div>

      <ConfirmDialog open={rejectOpen} title="Отклонить отклик?" confirmLabel="Отклонить" tone="danger" loading={reject.isPending} onClose={() => setRejectOpen(false)} onConfirm={() => reject.mutate()}>
        <p>Кандидат увидит статус «Отклонён». Решение окончательное: вернуть отклик в работу нельзя — при желании направьте кандидату приглашение.</p>
      </ConfirmDialog>
    </>
  );
}
