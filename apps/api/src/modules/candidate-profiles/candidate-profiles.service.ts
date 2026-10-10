import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/clock';
import { isUniqueViolation, notFound, unprocessable, conflict } from '../../common/errors';
import { CONSENT_POLICY_VERSIONS } from '../../config/policies';
import {
  INDUSTRIES,
  isKnownCode,
  isKnownSkill,
  SOFT_SKILLS,
  TEAM_ROLES,
  TIMEZONES,
  getSkill,
} from '../../domain/catalog/catalog';
import { recommendFromSurvey, SURVEY_VERSION, validateSurveyAnswers, type SurveyAnswers } from '../../domain/catalog/survey';
import { ageGroup, isPlausibleBirthDate } from '../../domain/candidate/age';
import { evaluateDiscoverability } from '../../domain/candidate/discoverability';
import { buildProfileView } from '../../domain/privacy/profile-view';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ProfileViewService } from '../profile-view/profile-view.service';
import { candidateFactsInclude, hasActivePublicationConsent, toDiscoverabilityFacts } from './candidate-facts';
import type { GuardianConsentDto, UpdateConsentsDto, UpdateProfileDto } from './dto/profile.dto';

@Injectable()
export class CandidateProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly views: ProfileViewService,
  ) {}

  async candidateIdOf(userId: string): Promise<string> {
    const profile = await this.prisma.candidateProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!profile) throw notFound('PROFILE_NOT_FOUND', 'Профиль кандидата не найден');
    return profile.id;
  }

  async getOwnProfile(userId: string) {
    const profile = await this.prisma.candidateProfile.findUnique({
      where: { userId },
      include: { ...candidateFactsInclude, skills: { orderBy: { skillCode: 'asc' } } },
    });
    if (!profile) throw notFound('PROFILE_NOT_FOUND', 'Профиль кандидата не найден');
    const consents = await this.prisma.consentRecord.findMany({ where: { userId }, orderBy: { acceptedAt: 'desc' } });
    const publicationConsent = await hasActivePublicationConsent(this.prisma, userId);
    const discoverability = evaluateDiscoverability(toDiscoverabilityFacts(profile, publicationConsent), this.clock.now());
    const loaded = await this.views.load(profile.id);
    const view = buildProfileView('OWNER', loaded!.profile, loaded!.qualification, loaded!.fsp, null, loaded!.extras);
    const verified = new Set(view.skills.filter((s) => s.source === 'VERIFIED').map((s) => s.code));
    const consentState = (type: 'DATA_PROCESSING' | 'PROFILE_PUBLICATION' | 'GUARDIAN_CONSENT') => {
      // Действующая запись важнее более «свежей» отозванной: при равных метках времени порядок не определён.
      const latest = consents.find((c) => c.type === type && !c.withdrawnAt) ?? consents.find((c) => c.type === type);
      return {
        active: Boolean(latest && !latest.withdrawnAt),
        policyVersion: latest?.policyVersion ?? null,
        acceptedAt: latest?.acceptedAt.toISOString() ?? null,
        withdrawnAt: latest?.withdrawnAt?.toISOString() ?? null,
        currentPolicyVersion: CONSENT_POLICY_VERSIONS[type],
      };
    };
    const survey = profile.survey as { version: string; answers: SurveyAnswers; completedAt: string } | null;
    return {
      profile: {
        id: profile.id,
        alias: profile.alias,
        fullName: profile.fullName,
        contactEmail: profile.contactEmail,
        phone: profile.phone,
        messenger: profile.messenger,
        city: profile.city,
        timezone: profile.timezone,
        workFormats: profile.workFormats,
        availability: profile.availability,
        salaryFrom: profile.salaryFrom,
        salaryTo: profile.salaryTo,
        industries: profile.industries,
        activeSpecialization: profile.activeSpecializationCode,
        declaredGrade: profile.declaredGrade,
        experienceMonths: profile.experienceMonths,
        birthDate: profile.birthDate ? profile.birthDate.toISOString().slice(0, 10) : null,
        ageGroup: ageGroup(profile.birthDate, this.clock.now()),
        guardianName: profile.guardianName,
        skills: profile.skills.map((s) => ({
          code: s.skillCode,
          title: getSkill(s.skillCode)?.title ?? s.skillCode,
          months: s.months,
          verified: verified.has(s.skillCode),
        })),
        teamRoles: profile.teamRoles,
        experienceDescription: profile.experienceDescription,
        softSkills: profile.softSkills,
        externalLinks: profile.externalLinks,
        isDiscoverable: profile.isDiscoverable,
        showSalaryToEmployers: profile.showSalaryToEmployers,
        showFspToEmployers: profile.showFspToEmployers,
        disclosureChannels: profile.disclosureChannels,
        updatedAt: profile.updatedAt.toISOString(),
      },
      survey: survey
        ? { version: survey.version, answers: survey.answers, completedAt: survey.completedAt, recommendation: recommendFromSurvey(survey.answers) }
        : null,
      consents: { dataProcessing: consentState('DATA_PROCESSING'), profilePublication: consentState('PROFILE_PUBLICATION'), guardian: consentState('GUARDIAN_CONSENT') },
      discoverability,
      qualification: view.qualification,
      verifiedSkills: [...verified],
    };
  }

  async update(userId: string, dto: UpdateProfileDto, requestId: string) {
    const current = await this.prisma.candidateProfile.findUnique({ where: { userId } });
    if (!current) throw notFound('PROFILE_NOT_FOUND', 'Профиль кандидата не найден');
    const errors: Record<string, string[]> = {};
    const addError = (field: string, message: string) => (errors[field] = [...(errors[field] ?? []), message]);

    if (dto.timezone && !isKnownCode(TIMEZONES, dto.timezone)) addError('timezone', 'Неизвестный часовой пояс');
    dto.industries?.forEach((code) => !isKnownCode(INDUSTRIES, code) && addError('industries', `Неизвестная отрасль: ${code}`));
    dto.teamRoles?.forEach((code) => !isKnownCode(TEAM_ROLES, code) && addError('teamRoles', `Неизвестная роль: ${code}`));
    dto.softSkills?.forEach((code) => !isKnownCode(SOFT_SKILLS, code) && addError('softSkills', `Неизвестный навык: ${code}`));
    if (dto.skills) {
      const codes = dto.skills.map((s) => s.code);
      if (new Set(codes).size !== codes.length) addError('skills', 'Навыки не должны повторяться');
      codes.forEach((code) => !isKnownSkill(code) && addError('skills', `Навыка нет в справочнике: ${code}`));
    }
    const salaryFrom = dto.salaryFrom !== undefined ? dto.salaryFrom : current.salaryFrom;
    const salaryTo = dto.salaryTo !== undefined ? dto.salaryTo : current.salaryTo;
    if (salaryFrom !== null && salaryTo !== null && salaryFrom > salaryTo) {
      addError('salaryTo', 'Значение «до» должно быть не меньше значения «от»');
    }
    if (dto.birthDate && !isPlausibleBirthDate(new Date(`${dto.birthDate}T00:00:00Z`), this.clock.now())) {
      addError('birthDate', 'Проверьте дату рождения: не в будущем, возраст от 10 до 100 лет');
    }
    if (Object.keys(errors).length) throw unprocessable('VALIDATION_FAILED', 'Проверьте введённые данные', { fields: errors });

    const data: Prisma.CandidateProfileUpdateInput = {};
    const assign = <K extends keyof UpdateProfileDto>(key: K, column: keyof Prisma.CandidateProfileUpdateInput = key as never) => {
      const value = dto[key];
      if (value === undefined) return;
      const normalized = typeof value === 'string' ? value.trim() || null : value;
      (data as Record<string, unknown>)[column as string] = normalized;
    };
    assign('fullName');
    assign('contactEmail');
    assign('phone');
    assign('messenger');
    assign('city');
    assign('timezone');
    assign('workFormats');
    assign('availability');
    assign('salaryFrom');
    assign('salaryTo');
    assign('industries');
    assign('declaredGrade');
    assign('experienceMonths');
    assign('teamRoles');
    assign('experienceDescription');
    assign('softSkills');
    assign('externalLinks');
    assign('isDiscoverable');
    assign('showSalaryToEmployers');
    assign('showFspToEmployers');
    assign('disclosureChannels');
    if (dto.birthDate !== undefined) data.birthDate = dto.birthDate ? new Date(`${dto.birthDate}T00:00:00Z`) : null;
    if (dto.activeSpecialization !== undefined) {
      data.activeSpecialization = dto.activeSpecialization
        ? { connect: { code: dto.activeSpecialization } }
        : { disconnect: true };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.candidateProfile.update({ where: { id: current.id }, data });
      if (dto.skills) {
        await tx.candidateSkill.deleteMany({ where: { candidateId: current.id } });
        if (dto.skills.length) {
          await tx.candidateSkill.createMany({
            data: dto.skills.map((s) => ({ candidateId: current.id, skillCode: s.code, months: s.months ?? null })),
          });
        }
      }
      await this.audit.recordTx(tx, {
        actorUserId: userId,
        action: 'candidate.profile_updated',
        objectType: 'CandidateProfile',
        objectId: current.id,
        requestId,
        metadata: { fields: Object.keys(dto) },
      });
    });
    return this.getOwnProfile(userId);
  }

  async saveSurvey(userId: string, answers: SurveyAnswers, requestId: string) {
    const errors = validateSurveyAnswers(answers);
    if (errors.length) throw unprocessable('SURVEY_INVALID', 'Ответы опроса некорректны', { errors });
    const profile = await this.prisma.candidateProfile.findUnique({ where: { userId } });
    if (!profile) throw notFound('PROFILE_NOT_FOUND', 'Профиль кандидата не найден');
    const recommendation = recommendFromSurvey(answers);
    const survey = { version: SURVEY_VERSION, answers, completedAt: this.clock.now().toISOString() };
    const industries = Array.isArray(answers.industries) ? answers.industries : profile.industries;
    await this.prisma.candidateProfile.update({ where: { id: profile.id }, data: { survey, industries } });
    await this.audit.record({
      actorUserId: userId,
      action: 'candidate.survey_completed',
      objectType: 'CandidateProfile',
      objectId: profile.id,
      requestId,
      metadata: { version: SURVEY_VERSION },
    });
    return { survey, recommendation };
  }

  /** Явное изменение согласия на публикацию с историей. Отзыв согласия скрывает профиль из поиска. */
  async updateConsents(userId: string, dto: UpdateConsentsDto, requestId: string) {
    const now = this.clock.now();
    const profile = await this.prisma.candidateProfile.findUnique({ where: { userId } });
    if (!profile) throw notFound('PROFILE_NOT_FOUND', 'Профиль кандидата не найден');
    try {
      await this.prisma.$transaction(async (tx) => {
        const active = await tx.consentRecord.findFirst({ where: { userId, type: 'PROFILE_PUBLICATION', withdrawnAt: null } });
        if (dto.profilePublication && !active) {
          await tx.consentRecord.create({
            data: {
              userId,
              type: 'PROFILE_PUBLICATION',
              policyVersion: CONSENT_POLICY_VERSIONS.PROFILE_PUBLICATION,
              acceptedAt: now,
            },
          });
        }
        if (!dto.profilePublication && active) {
          await tx.consentRecord.updateMany({
            where: { userId, type: 'PROFILE_PUBLICATION', withdrawnAt: null },
            data: { withdrawnAt: now },
          });
          await tx.candidateProfile.update({ where: { id: profile.id }, data: { isDiscoverable: false } });
        }
        await this.audit.recordTx(tx, {
          actorUserId: userId,
          action: dto.profilePublication ? 'candidate.publication_consent_given' : 'candidate.publication_consent_withdrawn',
          objectType: 'ConsentRecord',
          objectId: profile.id,
          requestId,
          metadata: { policyVersion: CONSENT_POLICY_VERSIONS.PROFILE_PUBLICATION },
        });
      });
    } catch (error) {
      // Параллельный повторный запрос уже создал действующее согласие (уникальный индекс) — итог тот же.
      if (!isUniqueViolation(error)) throw error;
    }
    return this.getOwnProfile(userId);
  }

  /**
   * Согласие законного представителя (кандидаты 16–17 лет). В MVP — заявление кандидата с ФИО представителя; подтверждение
   * самим представителем (подпись, Госуслуги) вне MVP. Отзыв скрывает профиль из поиска.
   */
  async updateGuardianConsent(userId: string, dto: GuardianConsentDto, requestId: string) {
    const now = this.clock.now();
    const profile = await this.prisma.candidateProfile.findUnique({ where: { userId } });
    if (!profile) throw notFound('PROFILE_NOT_FOUND', 'Профиль кандидата не найден');
    if (dto.consent) {
      if (ageGroup(profile.birthDate, now) !== 'MINOR_16_17') {
        throw conflict('GUARDIAN_CONSENT_NOT_APPLICABLE', 'Согласие законного представителя нужно только кандидатам 16–17 лет: укажите дату рождения');
      }
      const guardianName = dto.guardianName?.trim() || profile.guardianName;
      if (!guardianName) throw unprocessable('VALIDATION_FAILED', 'Укажите ФИО законного представителя', { fields: { guardianName: ['Укажите ФИО законного представителя'] } });
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.candidateProfile.update({ where: { id: profile.id }, data: { guardianName } });
          const active = await tx.consentRecord.findFirst({ where: { userId, type: 'GUARDIAN_CONSENT', withdrawnAt: null } });
          if (!active) {
            await tx.consentRecord.create({ data: { userId, type: 'GUARDIAN_CONSENT', policyVersion: CONSENT_POLICY_VERSIONS.GUARDIAN_CONSENT, acceptedAt: now } });
          }
          await this.audit.recordTx(tx, {
            actorUserId: userId,
            action: 'candidate.guardian_consent_given',
            objectType: 'ConsentRecord',
            objectId: profile.id,
            requestId,
            metadata: { policyVersion: CONSENT_POLICY_VERSIONS.GUARDIAN_CONSENT },
          });
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    } else {
      await this.prisma.$transaction(async (tx) => {
        const changed = await tx.consentRecord.updateMany({ where: { userId, type: 'GUARDIAN_CONSENT', withdrawnAt: null }, data: { withdrawnAt: now } });
        if (changed.count && ageGroup(profile.birthDate, now) === 'MINOR_16_17') {
          await tx.candidateProfile.update({ where: { id: profile.id }, data: { isDiscoverable: false } });
        }
        await this.audit.recordTx(tx, { actorUserId: userId, action: 'candidate.guardian_consent_withdrawn', objectType: 'ConsentRecord', objectId: profile.id, requestId });
      });
    }
    return this.getOwnProfile(userId);
  }

  async qualifications(userId: string) {
    const candidateId = await this.candidateIdOf(userId);
    const [qualifications, history] = await Promise.all([
      this.prisma.candidateQualification.findMany({ where: { candidateId }, orderBy: { confirmedAt: 'desc' } }),
      this.prisma.qualificationHistory.findMany({ where: { candidateId }, orderBy: { occurredAt: 'desc' } }),
    ]);
    return {
      qualifications: qualifications.map((q) => ({
        specialization: q.specializationCode,
        grade: q.confirmedGrade,
        overallScore: q.overallScore,
        groupScores: q.groupScores,
        skillEvidence: q.skillEvidence,
        verifiedSkills: q.verifiedSkills,
        confirmedAt: q.confirmedAt.toISOString(),
        nextReassessmentAt: q.nextReassessmentAt.toISOString(),
        policyVersion: q.policyVersion,
        attemptId: q.attemptId,
      })),
      history: history.map((h) => ({
        id: h.id,
        specialization: h.specializationCode,
        eventType: h.eventType,
        grade: h.grade,
        previousGrade: h.previousGrade,
        overallScore: h.overallScore,
        attemptId: h.attemptId,
        policyVersion: h.policyVersion,
        occurredAt: h.occurredAt.toISOString(),
      })),
    };
  }
}
