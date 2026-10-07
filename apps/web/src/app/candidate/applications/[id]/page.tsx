import type { Metadata } from 'next';
import { CandidateApplicationView } from './application-view';

export const metadata: Metadata = { title: 'Отклик' };

export default async function CandidateApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CandidateApplicationView id={id} />;
}
