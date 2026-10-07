import type { Metadata } from 'next';
import { TasksList } from './tasks-list';

export const metadata: Metadata = { title: 'Короткие задания' };

export default function TasksPage() {
  return <TasksList />;
}
