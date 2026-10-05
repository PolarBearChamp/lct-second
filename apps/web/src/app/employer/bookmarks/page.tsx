'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { CandidateSummaryCard } from '@/components/employer/candidate-summary-card';
import { Button, LinkButton } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { api } from '@/lib/api/client';
import { formatDate } from '@/lib/format';
import { employerKeys, useBookmarks } from '@/lib/employer-queries';

export default function BookmarksPage() {
  const queryClient = useQueryClient();
  const bookmarks = useBookmarks();
  const remove = useMutation({
    mutationFn: (candidateId: string) => api.delete(`/employer/bookmarks/${candidateId}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: employerKeys.bookmarks }),
  });
  return (
    <>
      <PageHeader title="Закладки" description="Закладки не зависят от фильтров подборок. Видимость кандидатов проверяется заново при каждом открытии." />
      {bookmarks.isPending ? (
        <LoadingBlock />
      ) : bookmarks.isError ? (
        <ErrorState error={bookmarks.error} onRetry={() => bookmarks.refetch()} />
      ) : bookmarks.data.length === 0 ? (
        <EmptyState title="Закладок пока нет" description="Добавляйте кандидатов из подборок и банка, чтобы вернуться к ним позже." action={<LinkButton href="/employer/candidates">Открыть банк</LinkButton>} />
      ) : (
        <ul className="space-y-4">
          {bookmarks.data.map((b) =>
            b.unavailable ? (
              <li key={b.candidateId} className="card flex flex-wrap items-center justify-between gap-3 p-5">
                <span className="text-muted">
                  Кандидат недоступен в поиске (профиль скрыт или не опубликован). Добавлен {formatDate(b.createdAt)}.
                  {b.hasContactAccess ? (
                    <>
                      {' '}
                      <Link className="font-medium text-brand-600 underline" href={`/employer/candidates/${b.candidateId}`}>
                        Доступ к контактам действует
                      </Link>
                    </>
                  ) : null}
                </span>
                <Button variant="ghost" size="sm" onClick={() => remove.mutate(b.candidateId)}>
                  Убрать
                </Button>
              </li>
            ) : (
              <li key={b.candidateId}>
                <CandidateSummaryCard candidate={b.candidate} href={`/employer/candidates/${b.candidateId}`} />
              </li>
            ),
          )}
        </ul>
      )}
    </>
  );
}
