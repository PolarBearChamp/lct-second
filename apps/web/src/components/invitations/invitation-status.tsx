import { INVITATION_STATUS_LABELS, type InvitationStatus } from '@fsp/contracts';
import { Badge, type Tone } from '@/components/ui/badge';

const TONES: Record<InvitationStatus, Tone> = {
  SENT: 'brand',
  VIEWED: 'info',
  ACCEPTED: 'success',
  DECLINED: 'neutral',
  WITHDRAWN: 'neutral',
  EXPIRED: 'warning',
};

export function InvitationStatusBadge({ status }: { status: InvitationStatus }) {
  return <Badge tone={TONES[status]}>{INVITATION_STATUS_LABELS[status]}</Badge>;
}
