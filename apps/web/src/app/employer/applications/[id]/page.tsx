import type { Metadata } from 'next';
import { ApplicationView } from './application-view';

export const metadata: Metadata = { title: 'Отклик на вакансию' };

export default async function EmployerApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ApplicationView id={id} />;
}
