import type { Metadata } from 'next';
import { TaskDetail } from './task-detail';

export const metadata: Metadata = { title: 'Задание' };

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TaskDetail id={id} />;
}
