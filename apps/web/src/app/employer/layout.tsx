import type { ReactNode } from 'react';
import { RoleGate } from '@/components/layout/role-gate';

export const dynamic = 'force-dynamic';

export default function EmployerLayout({ children }: { children: ReactNode }) {
  return (
    <RoleGate role="EMPLOYER" nextPath="/employer">
      {children}
    </RoleGate>
  );
}
