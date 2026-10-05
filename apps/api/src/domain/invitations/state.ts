/**
 * Статусы приглашения и допустимые переходы:
 *   SENT → VIEWED                 кандидат явно открыл приглашение
 *   SENT / VIEWED → ACCEPTED      кандидат принял
 *   SENT / VIEWED → DECLINED      кандидат отказал
 *   SENT / VIEWED → WITHDRAWN     работодатель отозвал
 *   SENT / VIEWED → EXPIRED       истёк срок действия
 * Финальные статусы не переходят друг в друга.
 */
export type InvitationStatusCode = 'SENT' | 'VIEWED' | 'ACCEPTED' | 'DECLINED' | 'WITHDRAWN' | 'EXPIRED';

export const ACTIVE_INVITATION_STATUSES: InvitationStatusCode[] = ['SENT', 'VIEWED'];
export const FINAL_INVITATION_STATUSES: InvitationStatusCode[] = ['ACCEPTED', 'DECLINED', 'WITHDRAWN', 'EXPIRED'];

const TRANSITIONS: Record<InvitationStatusCode, InvitationStatusCode[]> = {
  SENT: ['VIEWED', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'EXPIRED'],
  VIEWED: ['ACCEPTED', 'DECLINED', 'WITHDRAWN', 'EXPIRED'],
  ACCEPTED: [],
  DECLINED: [],
  WITHDRAWN: [],
  EXPIRED: [],
};

export function canTransition(from: InvitationStatusCode, to: InvitationStatusCode): boolean {
  return TRANSITIONS[from].includes(to);
}

export const isActiveInvitation = (status: string) => ACTIVE_INVITATION_STATUSES.includes(status as InvitationStatusCode);

const LIFECYCLE_RANK: Record<InvitationStatusCode, number> = { SENT: 0, VIEWED: 1, ACCEPTED: 2, DECLINED: 2, WITHDRAWN: 2, EXPIRED: 2 };

/**
 * Порядок истории статусов: по времени, а при совпадении меток (одна миллисекунда, остановленные часы в тестах)
 * — по ходу жизненного цикла, чтобы история всегда читалась как SENT → VIEWED → итог.
 */
export function compareInvitationEvents(a: { occurredAt: Date; toStatus: string }, b: { occurredAt: Date; toStatus: string }): number {
  const byTime = a.occurredAt.getTime() - b.occurredAt.getTime();
  if (byTime !== 0) return byTime;
  return LIFECYCLE_RANK[a.toStatus as InvitationStatusCode] - LIFECYCLE_RANK[b.toStatus as InvitationStatusCode];
}
