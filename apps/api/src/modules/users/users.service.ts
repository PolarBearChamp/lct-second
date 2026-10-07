import { Injectable } from '@nestjs/common';
import { evaluateDiscoverability, missingProfileFields } from '../../domain/candidate/discoverability';
import { PrismaService } from '../../prisma/prisma.service';
import {
  candidateFactsInclude,
  hasActivePublicationConsent,
  toDiscoverabilityFacts,
} from '../candidate-profiles/candidate-facts';
import type { MeResponseDto, OnboardingStepDto } from './dto/me.dto';

/** Состояние текущего пользователя и прогресс онбординга. */
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getMe(userId: string): Promise<MeResponseDto> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const base: MeResponseDto = {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        emailVerified: Boolean(user.emailVerifiedAt),
        isDemo: user.isDemo,
      },
      candidate: null,
      employer: null,
    };

    if (user.role === 'CANDIDATE') {
      const profile = await this.prisma.candidateProfile.findUniqueOrThrow({
        where: { userId },
        include: candidateFactsInclude,
      });
      const consent = await hasActivePublicationConsent(this.prisma, userId);
      const facts = toDiscoverabilityFacts(profile, consent);
      const { discoverable, issues } = evaluateDiscoverability(facts);
      const activeQualification = profile.activeSpecializationCode
        ? await this.prisma.candidateQualification.findUnique({
            where: {
              candidateId_specializationCode: {
                candidateId: profile.id,
                specializationCode: profile.activeSpecializationCode,
              },
            },
          })
        : null;
      const newInvitations = await this.prisma.invitation.count({
        where: { candidateId: profile.id, status: 'SENT' },
      });
      const steps: OnboardingStepDto[] = [
        { key: 'EMAIL', title: 'Подтверждение email', done: facts.emailVerified },
        { key: 'PROFILE', title: 'Профиль', done: missingProfileFields(facts).filter((f) => f !== 'activeSpecializationCode' && f !== 'declaredGrade').length === 0 },
        { key: 'SURVEY', title: 'Опрос и выбор специализации', done: Boolean(profile.survey && profile.activeSpecializationCode && profile.declaredGrade) },
        { key: 'ASSESSMENT', title: 'Тестирование', done: Boolean(activeQualification) },
        { key: 'PUBLICATION', title: 'Публикация профиля', done: discoverable },
      ];
      base.candidate = {
        profileId: profile.id,
        alias: profile.alias,
        activeSpecialization: profile.activeSpecializationCode,
        declaredGrade: profile.declaredGrade,
        confirmedGrade: activeQualification?.confirmedGrade ?? null,
        onboarding: steps,
        nextStep: steps.find((step) => !step.done)?.key ?? null,
        discoverable,
        discoverabilityIssues: issues,
        newInvitations,
      };
    } else {
      const company = await this.prisma.company.findUnique({ where: { ownerUserId: userId } });
      const activeNeeds = company
        ? await this.prisma.hiringNeed.count({ where: { companyId: company.id, status: 'ACTIVE' } })
        : 0;
      const newApplications = company ? await this.prisma.application.count({ where: { companyId: company.id, status: 'SENT' } }) : 0;
      const pendingTaskReviews = company
        ? await this.prisma.taskAssignment.count({ where: { status: 'SUBMITTED', verdict: null, task: { companyId: company.id, kind: 'APPROACH' } } })
        : 0;
      base.employer = {
        companyId: company?.id ?? null,
        companyName: company?.name ?? null,
        companyComplete: Boolean(company?.name && company.contactValue),
        activeNeeds,
        newApplications,
        pendingTaskReviews,
      };
    }
    return base;
  }
}
