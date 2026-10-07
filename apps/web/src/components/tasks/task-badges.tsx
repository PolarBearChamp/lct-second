import {
  SHORT_TASK_STATUS_LABELS,
  TASK_ASSIGNMENT_STATUS_LABELS,
  TASK_VERDICT_LABELS,
  type ShortTaskStatus,
  type TaskAssignmentStatus,
  type TaskVerdict,
} from '@fsp/contracts';
import { Badge, type Tone } from '@/components/ui/badge';

const TASK_TONES: Record<ShortTaskStatus, Tone> = { DRAFT: 'neutral', ACTIVE: 'success', CLOSED: 'warning' };
const ASSIGNMENT_TONES: Record<TaskAssignmentStatus, Tone> = { OFFERED: 'brand', SUBMITTED: 'success', SKIPPED: 'neutral', EXPIRED: 'warning' };
const VERDICT_TONES: Record<TaskVerdict, Tone> = { STRONG: 'success', ACCEPTABLE: 'info', WEAK: 'warning' };

export function TaskStatusBadge({ status }: { status: ShortTaskStatus }) {
  return <Badge tone={TASK_TONES[status]}>{SHORT_TASK_STATUS_LABELS[status]}</Badge>;
}

export function AssignmentStatusBadge({ status }: { status: TaskAssignmentStatus }) {
  return <Badge tone={ASSIGNMENT_TONES[status]}>{TASK_ASSIGNMENT_STATUS_LABELS[status]}</Badge>;
}

export function VerdictBadge({ verdict }: { verdict: TaskVerdict }) {
  return <Badge tone={VERDICT_TONES[verdict]}>{TASK_VERDICT_LABELS[verdict]}</Badge>;
}
