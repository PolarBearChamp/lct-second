import type { Metadata } from 'next';
import { SelectionView } from './selection-view';

export const metadata: Metadata = { title: 'Подборка' };

export default async function SelectionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string }> }) {
  const [{ id }, { page }] = await Promise.all([params, searchParams]);
  return <SelectionView id={id} page={Math.max(1, Number(page) || 1)} />;
}
