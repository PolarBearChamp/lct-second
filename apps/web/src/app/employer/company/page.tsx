import type { Metadata } from 'next';
import { CompanyForm } from './company-form';

export const metadata: Metadata = { title: 'Компания' };

export default function CompanyPage() {
  return <CompanyForm />;
}
