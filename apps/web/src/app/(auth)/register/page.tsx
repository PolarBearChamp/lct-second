import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getMe } from '@/lib/api/server';
import { RegisterForm } from './register-form';

export const metadata: Metadata = { title: 'Регистрация' };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  const me = await getMe();
  if (me) redirect(me.user.role === 'CANDIDATE' ? '/candidate' : '/employer');
  const { role } = await searchParams;
  return <RegisterForm initialRole={role === 'EMPLOYER' ? 'EMPLOYER' : 'CANDIDATE'} />;
}
