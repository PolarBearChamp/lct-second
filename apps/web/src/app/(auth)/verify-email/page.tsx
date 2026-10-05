import type { Metadata } from 'next';
import { getMe } from '@/lib/api/server';
import { VerifyEmailView } from './verify-email-view';

export const metadata: Metadata = { title: 'Подтверждение email' };

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const [{ token }, me] = await Promise.all([searchParams, getMe()]);
  return <VerifyEmailView token={token ?? null} me={me} />;
}
