'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api/client';
import { Button } from '@/components/ui/button';

export function LogoutButton({ variant = 'ghost' }: { variant?: 'ghost' | 'outline' }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  return (
    <Button
      variant={variant}
      size="sm"
      loading={loading}
      onClick={async () => {
        setLoading(true);
        try {
          await api.post('/auth/logout');
        } finally {
          queryClient.clear();
          router.replace('/login');
          router.refresh();
        }
      }}
    >
      Выйти
    </Button>
  );
}
