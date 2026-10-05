import type { Metadata } from 'next';
import { NeedDetail } from './need-detail';

export const metadata: Metadata = { title: 'Потребность' };

export default async function NeedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <NeedDetail id={id} />;
}
