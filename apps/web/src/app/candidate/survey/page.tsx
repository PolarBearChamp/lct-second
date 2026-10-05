import type { Metadata } from 'next';
import { SurveyWizard } from './survey-wizard';

export const metadata: Metadata = { title: 'Опрос и специализация' };

export default function SurveyPage() {
  return <SurveyWizard />;
}
