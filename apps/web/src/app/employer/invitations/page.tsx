'use client';

import { INVITATION_STATUS_LABELS, INVITATION_STATUSES } from '@fsp/contracts';
import Link from 'next/link';
import { useState } from 'react';
import { InvitationStatusBadge } from '@/components/invitations/invitation-status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/card';
import { Field, Select } from '@/components/ui/field';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { formatDate, formatSalaryRange } from '@/lib/format';
import { useEmployerInvitations } from '@/lib/employer-queries';

export default function EmployerInvitationsPage() {
  const [status, setStatus] = useState('ALL');
  const [page, setPage] = useState(1);
  const list = useEmployerInvitations(status, page);
  return (
    <>
      <PageHeader title="Приглашения" description="Статусы обновляются при возвращении на вкладку и каждые 30 секунд." />
      <div className="mb-4 max-w-xs">
        <Field label="Статус">
          {(props) => (
            <Select
              {...props}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="ALL">Все</option>
              <option value="ACTIVE">Ожидают ответа</option>
              {INVITATION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {INVITATION_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      {list.isPending ? (
        <LoadingBlock />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <EmptyState title="Приглашений нет" description="Отправьте предложение из карточки кандидата в подборке или банке." />
      ) : (
        <>
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-[15px]">
              <thead className="text-sm text-muted">
                <tr className="border-b border-line">
                  <th className="px-4 py-3 font-medium">Кандидат</th>
                  <th className="px-4 py-3 font-medium">Предложение</th>
                  <th className="px-4 py-3 font-medium">Зарплата</th>
                  <th className="px-4 py-3 font-medium">Статус</th>
                  <th className="px-4 py-3 font-medium">Отправлено</th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((inv) => (
                  <tr key={inv.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-3">
                      <Link href={`/employer/invitations/${inv.id}`} className="font-medium text-brand-600 hover:underline">
                        Кандидат {inv.candidateAlias}
                      </Link>
                      {inv.hasContactAccess ? (
                        <Badge tone="success" className="ml-2">
                          контакты
                        </Badge>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      {inv.title}
                      {inv.needTitle ? <div className="text-xs text-muted">{inv.needTitle}</div> : null}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-brand text-sm">{formatSalaryRange(inv.salaryFrom, inv.salaryTo, false)}</td>
                    <td className="px-4 py-3">
                      <InvitationStatusBadge status={inv.status} />
                    </td>
                    <td className="px-4 py-3 text-sm text-muted">{formatDate(inv.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav aria-label="Страницы" className="mt-4 flex items-center justify-center gap-3">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              ← Назад
            </Button>
            <span className="text-sm text-muted">Страница {page}</span>
            <Button variant="outline" size="sm" disabled={page * list.data.pageSize >= list.data.total} onClick={() => setPage(page + 1)}>
              Далее →
            </Button>
          </nav>
        </>
      )}
    </>
  );
}
