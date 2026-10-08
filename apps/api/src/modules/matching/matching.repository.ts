import { Injectable } from '@nestjs/common';
import { isMinor } from '../../domain/candidate/age';
import { evaluateDiscoverability } from '../../domain/candidate/discoverability';
import type { GradeCode } from '../../domain/catalog/catalog';
import type { MatchCandidate } from '../../domain/matching/rank';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { toDiscoverabilityFacts } from '../candidate-profiles/candidate-facts';

const include = {
  user: { select: { emailVerifiedAt: true, consents: { where: { type: 'GUARDIAN_CONSENT' as const, withdrawnAt: null }, select: { id: true } } } },
  _count: { select: { skills: true } },
  skills: { select: { skillCode: true } },
  qualifications: true,
  fspLink: { select: { state: true } },
  fspAchievements: { select: { externalId: true, eventId: true, discipline: true, place: true, teamRole: true } },
} satisfies Prisma.CandidateProfileInclude;

type Loaded = Prisma.CandidateProfileGetPayload<{ include: typeof include }>;

/**
 * Загрузка кандидатов для подбора. SQL отсекает заведомо невидимых (флаг видимости, статус, email,
 * активная специализация; подтверждённый грейд не обязателен — такие кандидаты идут отдельным блоком); затем те же правила, что в профиле кандидата, проверяются функцией evaluateDiscoverability.
 */
@Injectable()
export class MatchingRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * qualificationFor — оценивать кандидата по квалификации этой специализации, а не по активной (отклик на вакансию другой
   * специализации, по которой у кандидата тоже есть подтверждение). Без подтверждения квалификация остаётся null.
   */
  async load(options: { specialization?: string; ids?: string[]; prefilter?: boolean; qualificationFor?: string } = {}): Promise<MatchCandidate[]> {
    const prefilter = options.prefilter ?? true;
    const where: Prisma.CandidateProfileWhereInput = {
      ...(options.ids ? { id: { in: options.ids } } : {}),
      ...(prefilter
        ? {
            isDiscoverable: true,
            availability: 'ACTIVE',
            user: { emailVerifiedAt: { not: null } },
            activeSpecializationCode: options.specialization ?? { not: null },
          }
        : {}),
    };
    const profiles = await this.prisma.candidateProfile.findMany({ where, include });
    if (profiles.length === 0) return [];
    const consents = await this.prisma.consentRecord.findMany({
      where: { userId: { in: profiles.map((p) => p.userId) }, type: 'PROFILE_PUBLICATION', withdrawnAt: null },
      select: { userId: true },
    });
    const withConsent = new Set(consents.map((consent) => consent.userId));
    return profiles.map((profile) => this.toMatchCandidate(profile, withConsent.has(profile.userId), options.qualificationFor));
  }

  private toMatchCandidate(profile: Loaded, consent: boolean, qualificationFor?: string): MatchCandidate {
    const facts = toDiscoverabilityFacts(
      { ...profile, qualifications: profile.qualifications.map((q) => ({ specializationCode: q.specializationCode })) },
      consent,
    );
    const specialization = qualificationFor ?? profile.activeSpecializationCode;
    const qualification = profile.qualifications.find((q) => q.specializationCode === specialization) ?? null;
    const hasSalary = profile.salaryFrom !== null || profile.salaryTo !== null;
    const fspVisible = profile.showFspToEmployers && Boolean(profile.fspLink);
    return {
      candidateId: profile.id,
      alias: profile.alias,
      discoverable: evaluateDiscoverability(facts).discoverable,
      declaredGrade: (profile.declaredGrade as GradeCode | null) ?? null,
      minor: isMinor(profile.birthDate, new Date()),
      specialization: qualification ? specialization : profile.activeSpecializationCode,
      qualification: qualification
        ? {
            specialization: qualification.specializationCode,
            grade: qualification.confirmedGrade as GradeCode,
            overallScore: qualification.overallScore,
            verifiedSkills: qualification.verifiedSkills,
            // Только безопасные поля: счётчики частей и прочие внутренние данные оценки работодателю не передаются.
            groupScores: ((qualification.groupScores as Array<{ group: string; title: string; score: number }>) ?? []).map((g) => ({ group: g.group, title: g.title, score: g.score })),
          }
        : null,
      selfReportedSkills: profile.skills.map((s) => s.skillCode),
      workFormats: profile.workFormats,
      city: profile.city,
      salary: hasSalary && profile.showSalaryToEmployers ? { from: profile.salaryFrom, to: profile.salaryTo } : null,
      salaryHidden: hasSalary && !profile.showSalaryToEmployers,
      fspAchievements: fspVisible ? profile.fspAchievements : [],
      experienceMonths: profile.experienceMonths,
    };
  }
}
