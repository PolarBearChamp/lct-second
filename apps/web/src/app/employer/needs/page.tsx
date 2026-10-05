import type { Metadata } from 'next';
import { NeedsList } from './needs-list';

export const metadata: Metadata = { title: 'Потребности' };

export default function NeedsPage() {
  return <NeedsList />;
}
