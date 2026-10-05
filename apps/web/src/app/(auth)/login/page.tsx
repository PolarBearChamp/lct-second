import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getMe } from '@/lib/api/server';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Вход' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const me = await getMe();
  if (me) redirect(me.user.role === 'CANDIDATE' ? '/candidate' : '/employer');
  const { next } = await searchParams;
  return <LoginForm next={next} />;
}
