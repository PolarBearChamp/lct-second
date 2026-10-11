import type { Metadata } from 'next';
import { GRADES, SPECIALIZATIONS } from '@fsp/contracts';
import { AssessmentsOverview } from './assessments-overview';

export const metadata: Metadata = { title: 'Тестирование' };

export default async function AssessmentsPage({ searchParams }: { searchParams: Promise<{ grade?: string; specialization?: string }> }) {
  const params = await searchParams;
  const preferredGrade = GRADES.find((grade) => grade === params.grade);
  const specialization = SPECIALIZATIONS.find((spec) => spec === params.specialization);
  return <AssessmentsOverview preferredGrade={preferredGrade} specialization={specialization} />;
}
