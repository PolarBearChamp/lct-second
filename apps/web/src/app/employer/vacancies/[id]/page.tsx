import type { Metadata } from 'next';
import { VacancyDetail } from './vacancy-detail';

export const metadata: Metadata = { title: 'Вакансия' };

export default async function VacancyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <VacancyDetail id={id} />;
}
