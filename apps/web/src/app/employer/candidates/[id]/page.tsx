import type { Metadata } from 'next';
import { EmployerCandidateView } from './candidate-view';

export const metadata: Metadata = { title: 'Карточка кандидата' };

export default async function EmployerCandidatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ needId?: string; specialization?: string }>;
}) {
  const [{ id }, { needId, specialization }] = await Promise.all([params, searchParams]);
  return <EmployerCandidateView id={id} needId={needId} specialization={specialization} />;
}
