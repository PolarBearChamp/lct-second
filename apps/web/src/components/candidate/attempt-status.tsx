import { ATTEMPT_STATUS_LABELS, type AttemptStatus } from '@fsp/contracts';
import { Badge, type Tone } from '@/components/ui/badge';

const TONES: Record<AttemptStatus, Tone> = {
  IN_PROGRESS: 'brand',
  PASSED: 'success',
  FAILED: 'danger',
  EXPIRED: 'warning',
  ABANDONED: 'neutral',
};

export function AttemptStatusBadge({ status }: { status: AttemptStatus }) {
  return <Badge tone={TONES[status]}>{ATTEMPT_STATUS_LABELS[status]}</Badge>;
}
