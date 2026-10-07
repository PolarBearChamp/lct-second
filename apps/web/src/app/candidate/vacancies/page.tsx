import type { Metadata } from 'next';
import { CandidateVacancies } from './candidate-vacancies';

export const metadata: Metadata = { title: 'Вакансии' };

export default function CandidateVacanciesPage() {
  return <CandidateVacancies />;
}
