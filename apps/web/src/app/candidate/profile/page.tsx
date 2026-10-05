import type { Metadata } from 'next';
import { ProfileEditor } from './profile-editor';

export const metadata: Metadata = { title: 'Профиль' };

export default function CandidateProfilePage() {
  return <ProfileEditor />;
}
