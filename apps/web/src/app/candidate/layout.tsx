import type { ReactNode } from 'react';
import { RoleGate } from '@/components/layout/role-gate';

export const dynamic = 'force-dynamic';

export default function CandidateLayout({ children }: { children: ReactNode }) {
  return (
    <RoleGate role="CANDIDATE" nextPath="/candidate">
      {children}
    </RoleGate>
  );
}
