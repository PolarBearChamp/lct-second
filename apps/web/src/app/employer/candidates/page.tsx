import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingBlock } from '@/components/ui/states';
import { CandidateBank } from './candidate-bank';

export const metadata: Metadata = { title: 'Банк кандидатов' };

export default function CandidatesPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <CandidateBank />
    </Suspense>
  );
}
