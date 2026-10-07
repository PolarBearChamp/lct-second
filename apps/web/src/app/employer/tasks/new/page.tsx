import type { Metadata } from 'next';
import { NewTask } from './new-task';

export const metadata: Metadata = { title: 'Новое задание' };

export default function NewTaskPage() {
  return <NewTask />;
}
