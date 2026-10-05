import type { Metadata } from 'next';
import { AttemptResultView } from './result-view';

export const metadata: Metadata = { title: 'Результат теста' };

export default async function AttemptResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AttemptResultView attemptId={id} />;
}
