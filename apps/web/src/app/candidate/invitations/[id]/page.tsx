import type { Metadata } from 'next';
import { CandidateInvitationDetailView } from './invitation-detail';

export const metadata: Metadata = { title: 'Приглашение' };

export default async function CandidateInvitationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CandidateInvitationDetailView id={id} />;
}
