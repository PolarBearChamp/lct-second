import type { MeResponse } from '@fsp/contracts';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { LinkButton } from '@/components/ui/button';
import { getMe } from '@/lib/api/server';
import { AppShell } from './app-shell';
import { PublicHeader } from './public-header';

/**
 * Серверная проверка доступа к кабинету: сессия, подтверждение email, роль.
 * Это удобство интерфейса; права на данные всё равно проверяет API.
 */
export async function RoleGate({ role, nextPath, children }: { role: MeResponse['user']['role']; nextPath: string; children: ReactNode }) {
  const me = await getMe();
  if (!me) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  if (!me.user.emailVerified) redirect('/verify-email');
  if (me.user.role !== role) {
    const home = me.user.role === 'CANDIDATE' ? '/candidate' : '/employer';
    return (
      <>
        <PublicHeader />
        <main id="main" className="mx-auto max-w-xl px-4 py-16">
          <div className="card p-8" role="alert">
            <h1 className="text-2xl font-bold">Раздел недоступен для вашей роли</h1>
            <p className="mt-2 text-muted">
              {role === 'CANDIDATE' ? 'Этот раздел предназначен для кандидатов.' : 'Этот раздел предназначен для работодателей.'}
            </p>
            <LinkButton href={home} className="mt-6">
              Перейти в свой кабинет
            </LinkButton>
          </div>
        </main>
      </>
    );
  }
  return (
    <AppShell me={me} area={role === 'CANDIDATE' ? 'candidate' : 'employer'}>
      {children}
    </AppShell>
  );
}
