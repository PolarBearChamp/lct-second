import type { Metadata } from 'next';
import { CandidateVacancyView } from './vacancy-view';

export const metadata: Metadata = { title: 'Вакансия' };

export default async function CandidateVacancyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CandidateVacancyView id={id} />;
}
