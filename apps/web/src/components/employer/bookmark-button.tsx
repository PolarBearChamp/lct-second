'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api/client';

export function BookmarkButton({ candidateId, initial }: { candidateId: string; initial: boolean }) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const [bookmarked, setBookmarked] = useState(initial);
  const toggle = useMutation({
    mutationFn: () => (bookmarked ? api.delete(`/employer/bookmarks/${candidateId}`) : api.post(`/employer/bookmarks/${candidateId}`)),
    onSuccess: () => {
      setBookmarked(!bookmarked);
      void queryClient.invalidateQueries({ queryKey: ['employer', 'bookmarks'] });
      notify(bookmarked ? 'Убрано из закладок' : 'Добавлено в закладки', 'info');
    },
    onError: (error) => notify(errorMessage(error), 'danger'),
  });
  return (
    <Button variant={bookmarked ? 'secondary' : 'outline'} size="sm" loading={toggle.isPending} onClick={() => toggle.mutate()} aria-pressed={bookmarked}>
      {bookmarked ? '★ В закладках' : '☆ В закладки'}
    </Button>
  );
}
