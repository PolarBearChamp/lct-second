'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useState } from 'react';
import { useMe } from '@/components/layout/me-context';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { LinkButton } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { TaskStatusBadge } from '@/components/tasks/task-badges';
import { formatDate } from '@/lib/format';
import { useEmployerTasks } from '@/lib/task-queries';

const TABS = [
  { value: 'ALL', label: 'Все' },
  { value: 'ACTIVE', label: 'Активные' },
  { value: 'DRAFT', label: 'Черновики' },
  { value: 'CLOSED', label: 'Закрытые' },
] as const;

export function TasksList() {
  const me = useMe();
  const hasCompany = Boolean(me.employer?.companyId);
  const [tab, setTab] = useState<(typeof TABS)[number]['value']>('ALL');
  const tasks = useEmployerTasks(tab, hasCompany);
  return (
    <>
      <PageHeader
        title="Короткие задания"
        description="Регулярная практика кандидатов: задание на 5–10 минут предлагается подходящим кандидатам не чаще раза в неделю. Вы видите ответы под псевдонимом и подтверждённым грейдом — без ФИО и контактов. Грейд кандидата и подбор задания не меняют."
        actions={hasCompany ? <LinkButton href="/employer/tasks/new">Новое задание</LinkButton> : null}
      />
      {!hasCompany ? (
        <Alert tone="brand" title="Сначала заполните профиль компании" actions={<LinkButton href="/employer/company">Заполнить</LinkButton>} />
      ) : (
        <>
          <div role="tablist" aria-label="Фильтр заданий" className="mb-4 inline-flex flex-wrap rounded-xl border border-line bg-surface p-1">
            {TABS.map((item) => (
              <button
                key={item.value}
                role="tab"
                aria-selected={tab === item.value}
                onClick={() => setTab(item.value)}
                className={clsx('rounded-lg px-4 py-1.5 text-sm font-medium', tab === item.value ? 'bg-brand-500 text-white' : 'text-ink-soft hover:bg-canvas')}
              >
                {item.label}
              </button>
            ))}
          </div>
          {tasks.isPending ? (
            <LoadingBlock />
          ) : tasks.isError ? (
            <ErrorState error={tasks.error} onRetry={() => tasks.refetch()} />
          ) : tasks.data.length === 0 ? (
            <EmptyState
              title={tab === 'ALL' ? 'Заданий пока нет' : 'В этой категории заданий нет'}
              description="Создайте короткое задание — тест с одним верным ответом или текстовый разбор. Его получат кандидаты с подходящей подтверждённой квалификацией."
              action={<LinkButton href="/employer/tasks/new">Создать задание</LinkButton>}
            />
          ) : (
            <ul className="space-y-3">
              {tasks.data.map((task) => (
                <li key={task.id}>
                  <Link href={`/employer/tasks/${task.id}`} className="card flex flex-wrap items-start justify-between gap-4 p-5 transition-colors hover:border-brand-300">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-lg font-bold">{task.title}</span>
                        <TaskStatusBadge status={task.status} />
                        {task.pendingReviewCount > 0 ? <Badge tone="brand">ждут оценки: {task.pendingReviewCount}</Badge> : null}
                      </div>
                      <div className="mt-1 text-muted">
                        {task.specializationTitle} · {task.kindTitle}
                        {task.allowedGrades.length ? ` · ${task.allowedGrades.join(', ')}` : ' · любой грейд'}
                      </div>
                    </div>
                    <div className="text-right text-sm text-muted">
                      <div>
                        предложено {task.offeredCount} · ответов {task.submittedCount}
                      </div>
                      <div>
                        {task.publishedAt ? `опубликовано ${formatDate(task.publishedAt)}` : `изменено ${formatDate(task.updatedAt)}`}
                        {task.deadlineAt ? ` · до ${formatDate(task.deadlineAt)}` : ''}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}
