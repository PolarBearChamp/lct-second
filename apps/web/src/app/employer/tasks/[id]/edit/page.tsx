import type { Metadata } from 'next';
import { EditTask } from './edit-task';

export const metadata: Metadata = { title: 'Редактирование задания' };

export default async function EditTaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EditTask id={id} />;
}
