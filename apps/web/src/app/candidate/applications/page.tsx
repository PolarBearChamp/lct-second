import type { Metadata } from 'next';
import { CandidateApplications } from './candidate-applications';

export const metadata: Metadata = { title: 'Мои отклики' };

export default function CandidateApplicationsPage() {
  return <CandidateApplications />;
}
