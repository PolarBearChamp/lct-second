'use client';

import type { MeResponse } from '@fsp/contracts';
import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, type ReactNode } from 'react';
import { api } from '@/lib/api/client';

const MeContext = createContext<MeResponse | null>(null);

export const ME_QUERY_KEY = ['me'] as const;

/** Текущий пользователь: начальное значение приходит из серверного layout, далее обновляется запросом. */
export function MeProvider({ initial, children }: { initial: MeResponse; children: ReactNode }) {
  const { data } = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: () => api.get<MeResponse>('/auth/me'),
    initialData: initial,
    refetchInterval: 60_000,
  });
  return <MeContext.Provider value={data ?? initial}>{children}</MeContext.Provider>;
}

export function useMe(): MeResponse {
  const me = useContext(MeContext);
  if (!me) throw new Error('useMe используется вне MeProvider');
  return me;
}
