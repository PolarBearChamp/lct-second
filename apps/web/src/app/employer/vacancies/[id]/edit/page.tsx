import type { Metadata } from 'next';
import { EditVacancy } from './edit-vacancy';

export const metadata: Metadata = { title: 'Редактирование вакансии' };

export default async function EditVacancyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EditVacancy id={id} />;
}
