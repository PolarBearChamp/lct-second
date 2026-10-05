import type { Metadata } from 'next';
import { CandidateInvitations } from './candidate-invitations';

export const metadata: Metadata = { title: 'Приглашения' };

export default function CandidateInvitationsPage() {
  return <CandidateInvitations />;
}
