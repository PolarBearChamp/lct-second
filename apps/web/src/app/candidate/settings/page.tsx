import type { Metadata } from 'next';
import { CandidateSettings } from './candidate-settings';

export const metadata: Metadata = { title: 'Приватность и ФСП' };

export default function CandidateSettingsPage() {
  return <CandidateSettings />;
}
