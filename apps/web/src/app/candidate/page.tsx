import type { Metadata } from 'next';
import { CandidateDashboard } from './dashboard';

export const metadata: Metadata = { title: 'Кабинет кандидата' };

export default function CandidateHomePage() {
  return <CandidateDashboard />;
}
