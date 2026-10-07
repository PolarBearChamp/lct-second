import type { Metadata } from 'next';
import { CandidateTasks } from './candidate-tasks';

export const metadata: Metadata = { title: 'Короткие задания' };

export default function CandidateTasksPage() {
  return <CandidateTasks />;
}
