import type { DiscoverabilityFacts } from '../../domain/candidate/discoverability';
import type { Prisma } from '../../generated/prisma/client';
import type { PrismaService, Tx } from '../../prisma/prisma.service';

export const candidateFactsInclude = {
  user: { select: { emailVerifiedAt: true, consents: { where: { type: 'GUARDIAN_CONSENT', withdrawnAt: null }, select: { id: true } } } },
  _count: { select: { skills: true } },
  qualifications: { select: { specializationCode: true } },
} satisfies Prisma.CandidateProfileInclude;

export type CandidateWithFacts = Prisma.CandidateProfileGetPayload<{ include: typeof candidateFactsInclude }>;

/**
 * Действующее согласие на публикацию: есть запись типа PROFILE_PUBLICATION без отзыва.
 * Новая запись создаётся только при отсутствии действующей, поэтому действующая запись одна, а решение
 * не зависит от порядка записей с одинаковой меткой времени.
 */
export async function hasActivePublicationConsent(db: PrismaService | Tx, userId: string): Promise<boolean> {
  const active = await db.consentRecord.findFirst({ where: { userId, type: 'PROFILE_PUBLICATION', withdrawnAt: null }, select: { id: true } });
  return Boolean(active);
}

export function toDiscoverabilityFacts(profile: CandidateWithFacts, publicationConsent: boolean): DiscoverabilityFacts {
  return {
    emailVerified: Boolean(profile.user.emailVerifiedAt),
    fullName: profile.fullName,
    city: profile.city,
    timezone: profile.timezone,
    workFormats: profile.workFormats,
    activeSpecializationCode: profile.activeSpecializationCode,
    declaredGrade: profile.declaredGrade,
    experienceMonths: profile.experienceMonths,
    skillsCount: profile._count.skills,
    disclosureChannels: profile.disclosureChannels,
    contactEmail: profile.contactEmail,
    phone: profile.phone,
    messenger: profile.messenger,
    hasActivePublicationConsent: publicationConsent,
    isDiscoverable: profile.isDiscoverable,
    availability: profile.availability,
    confirmedSpecializations: profile.qualifications.map((q) => q.specializationCode),
    birthDate: profile.birthDate,
    hasGuardianConsent: profile.user.consents.length > 0,
  };
}
