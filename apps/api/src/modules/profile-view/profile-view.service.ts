import { Injectable } from '@nestjs/common';
import { evaluateDiscoverability } from '../../domain/candidate/discoverability';
import {
  buildProfileView,
  type CandidateProfileView,
  type FspSource,
  type ProfileSource,
  type ProfileViewMode,
  type QualificationSource,
} from '../../domain/privacy/profile-view';
import { notFound } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import { candidateFactsInclude, hasActivePublicationConsent, toDiscoverabilityFacts } from '../candidate-profiles/candidate-facts';

export interface LoadedCandidate {
  profile: ProfileSource & { userId: string };
  qualification: QualificationSource | null;
  fsp: FspSource | null;
}

/**
 * Загрузка данных и построение представления профиля для конкретного зрителя.
 * Права проверяются здесь, на backend: работодатель получает обезличенную карточку, только если кандидат
 * сейчас доступен в поиске, или расширенную — только при действующем доступе к контактам для его компании.
 */
@Injectable()
export class ProfileViewService {
  constructor(private readonly prisma: PrismaService) {}

  async load(candidateId: string): Promise<LoadedCandidate | null> {
    const profile = await this.prisma.candidateProfile.findUnique({
      where: { id: candidateId },
      include: { skills: true, fspLink: true, fspAchievements: { orderBy: { eventDate: 'desc' } } },
    });
    if (!profile) return null;
    const qualification = profile.activeSpecializationCode
      ? await this.prisma.candidateQualification.findUnique({
          where: {
            candidateId_specializationCode: { candidateId, specializationCode: profile.activeSpecializationCode },
          },
        })
      : null;
    return {
      profile: { ...profile, skills: profile.skills.map((s) => ({ skillCode: s.skillCode, months: s.months })) },
      qualification,
      fsp: profile.fspLink
        ? {
            state: profile.fspLink.state,
            linkedAt: profile.fspLink.linkedAt,
            lastSuccessfulSyncAt: profile.fspLink.lastSuccessfulSyncAt,
            externalId: profile.fspLink.externalId,
            achievements: profile.fspAchievements,
          }
        : null,
    };
  }

  async ownerView(candidateId: string): Promise<CandidateProfileView> {
    const loaded = await this.load(candidateId);
    if (!loaded) throw notFound();
    return buildProfileView('OWNER', loaded.profile, loaded.qualification, loaded.fsp);
  }

  /** Как карточку видит любой работодатель без доступа (для предпросмотра кандидатом). */
  async redactedPreview(candidateId: string): Promise<CandidateProfileView> {
    const loaded = await this.load(candidateId);
    if (!loaded) throw notFound();
    return buildProfileView('EMPLOYER_REDACTED', loaded.profile, loaded.qualification, loaded.fsp);
  }

  /** Активный доступ компании к контактам кандидата (не отозван). */
  async activeGrant(candidateId: string, companyId: string) {
    const grant = await this.prisma.contactAccessGrant.findUnique({
      where: { candidateId_companyId: { candidateId, companyId } },
    });
    return grant && !grant.revokedAt ? grant : null;
  }

  async isDiscoverable(candidateId: string): Promise<boolean> {
    const profile = await this.prisma.candidateProfile.findUnique({ where: { id: candidateId }, include: candidateFactsInclude });
    if (!profile) return false;
    const consent = await hasActivePublicationConsent(this.prisma, profile.userId);
    return evaluateDiscoverability(toDiscoverabilityFacts(profile, consent)).discoverable;
  }

  /**
   * Представление для работодателя. 404 — если кандидат скрыт и у компании нет действующего доступа
   * (одинаково для «не существует» и «недоступен», чтобы не раскрывать наличие профиля).
   */
  async employerView(companyId: string, candidateId: string): Promise<CandidateProfileView> {
    const loaded = await this.load(candidateId);
    if (!loaded) throw notFound('CANDIDATE_NOT_FOUND', 'Кандидат не найден или недоступен');
    const grant = await this.activeGrant(candidateId, companyId);
    let mode: ProfileViewMode;
    if (grant) {
      mode = 'EMPLOYER_GRANTED';
    } else if (await this.isDiscoverable(candidateId)) {
      mode = 'EMPLOYER_REDACTED';
    } else {
      throw notFound('CANDIDATE_NOT_FOUND', 'Кандидат не найден или недоступен');
    }
    return buildProfileView(mode, loaded.profile, loaded.qualification, loaded.fsp, grant ? { channels: grant.channels, grantedAt: grant.grantedAt } : null);
  }
}
