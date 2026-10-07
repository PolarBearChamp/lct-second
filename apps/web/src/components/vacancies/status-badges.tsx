import { APPLICATION_STATUS_LABELS, VACANCY_STATUS_LABELS, type ApplicationStatus, type VacancyStatus } from '@fsp/contracts';
import { Badge, type Tone } from '@/components/ui/badge';

const APPLICATION_TONES: Record<ApplicationStatus, Tone> = {
  SENT: 'brand',
  VIEWED: 'info',
  SHORTLISTED: 'success',
  REJECTED: 'neutral',
  WITHDRAWN: 'neutral',
};

const VACANCY_TONES: Record<VacancyStatus, Tone> = {
  DRAFT: 'neutral',
  PUBLISHED: 'success',
  CLOSED: 'warning',
};

export function ApplicationStatusBadge({ status }: { status: ApplicationStatus }) {
  return <Badge tone={APPLICATION_TONES[status]}>{APPLICATION_STATUS_LABELS[status]}</Badge>;
}

export function VacancyStatusBadge({ status }: { status: VacancyStatus }) {
  return <Badge tone={VACANCY_TONES[status]}>{VACANCY_STATUS_LABELS[status]}</Badge>;
}
