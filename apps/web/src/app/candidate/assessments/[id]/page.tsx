import type { Metadata } from 'next';
import { TestRunner } from './test-runner';

export const metadata: Metadata = { title: 'Прохождение теста' };

export default async function AttemptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TestRunner attemptId={id} />;
}
