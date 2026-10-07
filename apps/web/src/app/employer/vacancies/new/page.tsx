import type { Metadata } from 'next';
import { NewVacancy } from './new-vacancy';

export const metadata: Metadata = { title: 'Новая вакансия' };

export default async function NewVacancyPage({ searchParams }: { searchParams: Promise<{ needId?: string }> }) {
  const { needId } = await searchParams;
  return <NewVacancy needId={needId} />;
}
