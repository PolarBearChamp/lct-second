import type { Metadata } from 'next';
import { EmployerDashboard } from './dashboard';

export const metadata: Metadata = { title: 'Кабинет работодателя' };

export default function EmployerHomePage() {
  return <EmployerDashboard />;
}
