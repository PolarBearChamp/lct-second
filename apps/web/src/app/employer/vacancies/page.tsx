import type { Metadata } from 'next';
import { VacanciesList } from './vacancies-list';

export const metadata: Metadata = { title: 'Вакансии' };

export default function VacanciesPage() {
  return <VacanciesList />;
}
