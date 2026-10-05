import type { Metadata } from 'next';
import { AssessmentsOverview } from './assessments-overview';

export const metadata: Metadata = { title: 'Тестирование' };

export default function AssessmentsPage() {
  return <AssessmentsOverview />;
}
