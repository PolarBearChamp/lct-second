import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/clock';
import { conflict, isUniqueViolation, notFound } from '../../common/errors';
import { PolicyService } from '../../common/policy.service';
import {
  ACTIVE_APPLICATION_STATUSES,
  compareApplicationEvents,
  sourcesOf,
  type ApplicationStatusCode,
} from '../../domain/applications/state';
import { GRADE_TITLES, getSpecialization } from '../../domain/catalog/catalog';
import type { MatchCandidate } from '../../domain/matching/rank';
import type { Application, ApplicationStatus, Company, Prisma, Vacancy } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MatchingRepository } from '../matching/matching.repository';
import { ProfileViewService } from '../profile-view/profile-view.service';
import type { ApplyDto, CandidateApplicationQueryDto, VacancyApplicationsQueryDto } from './dto/vacancy.dto';
import { applyBlockerError, VacanciesService } from './vacancies.service';
import { evaluateFit, vacancySnapshotOf, vacancySpecOf, type VacancySnapshot } from './vacancy-views';

const ACTIVE: ApplicationStatus[] = ACTIVE_APPLICATION_STATUSES as ApplicationStatus[];

const STATUS_TEXT: Record<ApplicationStatus, string> = {
  SENT: 'Отправлен',
  VIEWED: 'Просмотрен',
  SHORTLISTED: 'В шорт-листе',
  REJECTED: 'Отклонён',
  WITHDRAWN: 'Отозван',
};

/**
 * Самостоятельные отклики кандидатов на вакансии.
 * Отклик — явное согласие раскрыть выбранные контакты именно этой компании (ContactAccessGrant), поэтому, как и принятие
 * приглашения, требует подтверждения раскрытия. Переходы статусов — условные UPDATE (WHERE status IN …): параллельные
 * «в шорт-лист»/«отозвать» и двойной клик обрабатываются атомарно, победитель один.
 */
@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly policies: PolicyService,
    private readonly audit: AuditService,
    private readonly vacancies: VacanciesService,
    private readonly candidates: MatchingRepository,
    private readonly views: ProfileViewService,
  ) {}

  // ───────────────────────────── Кандидат ─────────────────────────────

  async apply(candidateId: string, userId: string, vacancyId: string, dto: ApplyDto, requestId: string) {
    const vacancy = await this.prisma.vacancy.findFirst({ where: { id: vacancyId }, include: { company: true } });
    if (!vacancy || vacancy.status === 'DRAFT') throw notFound('VACANCY_NOT_FOUND', 'Вакансия не найдена');

    const active = await this.prisma.application.findFirst({ where: { vacancyId, candidateId, status: { in: ACTIVE } }, select: { id: true } });
    const blockers = await this.vacancies.applyBlockersFor(candidateId, vacancy, Boolean(active));
    if (blockers.length) throw applyBlockerError(blockers[0], blockers, active ? { applicationId: active.id } : undefined);

    const context = await this.vacancies.candidateContext(candidateId);
    const now = this.clock.now();
    const snapshot = vacancySnapshotOf(vacancy, vacancy.company);
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const application = await tx.application.create({
          data: {
            vacancyId,
            candidateId,
            companyId: vacancy.companyId,
            status: 'SENT',
            coverNote: dto.coverNote?.trim() || null,
            vacancySnapshot: snapshot as unknown as Prisma.InputJsonValue,
            vacancyVersion: vacancy.version,
            createdAt: now,
          },
        });
        await tx.applicationEvent.create({
          data: { applicationId: application.id, actorUserId: userId, fromStatus: null, toStatus: 'SENT', occurredAt: now, metadata: { channels: context.channels } },
        });
        // Отклик — осознанное согласие раскрыться этой компании: доступ только к ней и только к выбранным каналам.
        await tx.contactAccessGrant.upsert({
          where: { candidateId_companyId: { candidateId, companyId: vacancy.companyId } },
          create: { candidateId, companyId: vacancy.companyId, channels: context.channels, grantedAt: now, sourceApplicationId: application.id },
          update: { channels: context.channels, grantedAt: now, revokedAt: null, sourceApplicationId: application.id },
        });
        await this.audit.recordTx(tx, {
          actorUserId: userId,
          action: 'application.submitted',
          objectType: 'Application',
          objectId: application.id,
          requestId,
          metadata: { vacancyId, companyId: vacancy.companyId, channels: context.channels },
        });
        return application;
      });
      return this.candidateView(candidateId, created.id);
    } catch (error) {
      if (isUniqueViolation(error)) {
        const existing = await this.prisma.application.findFirst({ where: { vacancyId, candidateId, status: { in: ACTIVE } }, select: { id: true } });
        throw conflict('ACTIVE_APPLICATION_EXISTS', 'Вы уже откликнулись на эту вакансию', { applicationId: existing?.id });
      }
      throw error;
    }
  }

  async listForCandidate(candidateId: string, query: CandidateApplicationQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.ApplicationWhereInput = {
      candidateId,
      ...(query.status === 'ACTIVE' ? { status: { in: ACTIVE } } : query.status ? { status: query.status as ApplicationStatus } : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.application.count({ where }),
      this.prisma.application.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    return { page, pageSize, total, items: items.map((application) => this.baseView(application)) };
  }

  async candidateView(candidateId: string, applicationId: string) {
    const application = await this.prisma.application.findFirst({
      where: { id: applicationId, candidateId },
      include: { events: { orderBy: { occurredAt: 'asc' } }, vacancy: { select: { status: true } } },
    });
    if (!application) throw notFound('APPLICATION_NOT_FOUND', 'Отклик не найден');
    const grant = await this.prisma.contactAccessGrant.findUnique({ where: { candidateId_companyId: { candidateId, companyId: application.companyId } } });
    const snapshot = application.vacancySnapshot as unknown as VacancySnapshot;
    return {
      ...this.baseView(application),
      description: snapshot.description,
      coverNote: application.coverNote,
      company: { name: snapshot.company.name, industry: snapshot.company.industry, industryTitle: snapshot.company.industryTitle, website: snapshot.company.website, description: snapshot.company.description },
      companyContact: snapshot.company.contactType && snapshot.company.contactValue ? { type: snapshot.company.contactType, value: snapshot.company.contactValue } : null,
      vacancyStatus: application.vacancy.status,
      canWithdraw: ACTIVE.includes(application.status),
      events: this.events(application.events),
      contactAccess: grant
        ? { active: !grant.revokedAt, grantedAt: grant.grantedAt.toISOString(), revokedAt: grant.revokedAt?.toISOString() ?? null, channels: grant.channels }
        : null,
    };
  }

  /**
   * Отзыв отклика. Закрыть компании доступ к контактам можно тут же (revokeContactAccess) или отдельно в «Приватность и ФСП»:
   * по умолчанию доступ не отзывается, чтобы отзыв отклика не менял другие договорённости с этой компанией.
   */
  async withdraw(candidateId: string, userId: string, applicationId: string, revokeContactAccess: boolean, requestId: string) {
    const application = await this.prisma.application.findFirst({ where: { id: applicationId, candidateId } });
    if (!application) throw notFound('APPLICATION_NOT_FOUND', 'Отклик не найден');
    const changed = await this.transition(application.id, sourcesOf('WITHDRAWN'), 'WITHDRAWN', userId, { withdrawnAt: this.clock.now() });
    if (changed) {
      await this.audit.record({ actorUserId: userId, action: 'application.withdrawn', objectType: 'Application', objectId: application.id, requestId });
    } else {
      const current = await this.prisma.application.findUniqueOrThrow({ where: { id: application.id } });
      if (current.status !== 'WITHDRAWN') {
        throw conflict('APPLICATION_FINAL', `Отклик уже в статусе «${STATUS_TEXT[current.status]}» — отозвать его нельзя`, { status: current.status });
      }
    }
    if (revokeContactAccess) {
      const revoked = await this.prisma.contactAccessGrant.updateMany({
        where: { candidateId, companyId: application.companyId, revokedAt: null },
        data: { revokedAt: this.clock.now() },
      });
      if (revoked.count) {
        await this.audit.record({ actorUserId: userId, action: 'contact_access.revoked', objectType: 'Application', objectId: application.id, requestId, metadata: { companyId: application.companyId } });
      }
    }
    return this.candidateView(candidateId, application.id);
  }

  // ───────────────────────────── Работодатель ─────────────────────────────

  /** Отклики на вакансию. По умолчанию — по соответствию требованиям (подходящие выше), затем по дате. */
  async listForVacancy(company: Company, vacancyId: string, query: VacancyApplicationsQueryDto) {
    const vacancy = await this.vacancies.getOwn(company, vacancyId);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.ApplicationWhereInput = {
      vacancyId,
      ...(query.status === 'ACTIVE' ? { status: { in: ACTIVE } } : query.status ? { status: query.status as ApplicationStatus } : {}),
    };
    const applications = await this.prisma.application.findMany({ where, include: { candidate: { select: { alias: true, fullName: true } } } });
    const candidatesById = await this.candidatesFor(vacancy, applications.map((a) => a.candidateId));
    const grants = await this.prisma.contactAccessGrant.findMany({
      where: { companyId: company.id, candidateId: { in: applications.map((a) => a.candidateId) }, revokedAt: null },
      select: { candidateId: true },
    });
    const granted = new Set(grants.map((g) => g.candidateId));
    const spec = vacancySpecOf(vacancy);
    const rows = applications.map((application) => {
      const candidate = candidatesById.get(application.candidateId);
      const fit = candidate ? evaluateFit(candidate, spec, this.policies.matching, false) : null;
      return { application, candidate, fit };
    });
    const byDate = (a: (typeof rows)[number], b: (typeof rows)[number]) =>
      b.application.createdAt.getTime() - a.application.createdAt.getTime() || (a.application.id < b.application.id ? -1 : 1);
    rows.sort((a, b) => {
      if ((query.sort ?? 'FIT') === 'DATE') return byDate(a, b);
      const pass = Number(Boolean(b.fit?.passes)) - Number(Boolean(a.fit?.passes));
      if (pass) return pass;
      return (b.fit?.score ?? -1) - (a.fit?.score ?? -1) || (b.candidate?.qualification?.overallScore ?? -1) - (a.candidate?.qualification?.overallScore ?? -1) || byDate(a, b);
    });
    const start = (page - 1) * pageSize;
    return {
      page,
      pageSize,
      total: rows.length,
      sorting: (query.sort ?? 'FIT') === 'DATE' ? 'По дате отклика (новые выше)' : 'По соответствию требованиям вакансии: подходящие выше, затем по оценке соответствия, баллу теста и дате',
      items: rows.slice(start, start + pageSize).map(({ application, candidate, fit }) => {
        const hasAccess = granted.has(application.candidateId);
        return {
          ...this.baseView(application),
          candidateId: application.candidateId,
          candidateAlias: application.candidate.alias,
          // ФИО — только пока у компании есть действующий доступ к контактам.
          candidateName: hasAccess ? (application.candidate.fullName ?? `Кандидат ${application.candidate.alias}`) : `Кандидат ${application.candidate.alias}`,
          hasContactAccess: hasAccess,
          hasCoverNote: Boolean(application.coverNote),
          grade: candidate?.qualification?.grade ?? null,
          gradeTitle: candidate?.qualification ? GRADE_TITLES[candidate.qualification.grade] : null,
          overallScore: candidate?.qualification?.overallScore ?? null,
          fit: fit ? { passes: fit.passes, violations: fit.violations, score: fit.score } : null,
        };
      }),
    };
  }

  async employerView(company: Company, userId: string | null, applicationId: string, requestId: string | null = null) {
    const application = await this.prisma.application.findFirst({
      where: { id: applicationId, companyId: company.id },
      include: { events: { orderBy: { occurredAt: 'asc' } }, vacancy: true, candidate: { select: { alias: true, fullName: true } } },
    });
    if (!application) throw notFound('APPLICATION_NOT_FOUND', 'Отклик не найден');
    const [candidate] = await this.candidates.load({ ids: [application.candidateId], prefilter: false, qualificationFor: application.vacancy.specializationCode });
    const fit = candidate ? evaluateFit(candidate, vacancySpecOf(application.vacancy), this.policies.matching, true) : null;
    // Карточка строится тем же презентером, что и везде: контакты — только пока доступ не отозван; скрытый кандидат без доступа — null.
    const profile = await this.views.employerView(company.id, application.candidateId).catch(() => null);
    if (profile?.mode === 'EMPLOYER_GRANTED' && userId) {
      await this.audit.record({ actorUserId: userId, action: 'candidate.granted_profile_viewed', objectType: 'CandidateProfile', objectId: application.candidateId, requestId });
    }
    const snapshot = application.vacancySnapshot as unknown as VacancySnapshot;
    return {
      ...this.baseView(application),
      description: snapshot.description,
      coverNote: application.coverNote,
      candidateId: application.candidateId,
      candidateAlias: application.candidate.alias,
      vacancyCurrentVersion: application.vacancy.version,
      vacancyStatus: application.vacancy.status,
      events: this.events(application.events),
      fit,
      profile,
      canDecide: ACTIVE.includes(application.status),
    };
  }

  /** Явная отметка о просмотре (SENT → VIEWED). Открытие списка статус не меняет. Повтор идемпотентен. */
  async markViewed(company: Company, userId: string, applicationId: string, requestId: string) {
    const application = await this.requireOwn(company, applicationId);
    const changed = await this.transition(application.id, sourcesOf('VIEWED'), 'VIEWED', userId, { viewedAt: this.clock.now() });
    if (changed) await this.audit.record({ actorUserId: userId, action: 'application.viewed', objectType: 'Application', objectId: application.id, requestId });
    return this.employerView(company, null, application.id);
  }

  async shortlist(company: Company, userId: string, applicationId: string, requestId: string) {
    return this.decide(company, userId, applicationId, 'SHORTLISTED', 'application.shortlisted', requestId);
  }

  async reject(company: Company, userId: string, applicationId: string, requestId: string) {
    return this.decide(company, userId, applicationId, 'REJECTED', 'application.rejected', requestId);
  }

  private async decide(company: Company, userId: string, applicationId: string, to: 'SHORTLISTED' | 'REJECTED', action: string, requestId: string) {
    const application = await this.requireOwn(company, applicationId);
    const changed = await this.transition(application.id, sourcesOf(to), to, userId, { decidedAt: this.clock.now(), ...(application.viewedAt ? {} : { viewedAt: this.clock.now() }) });
    if (changed) {
      await this.audit.record({ actorUserId: userId, action, objectType: 'Application', objectId: application.id, requestId });
    } else {
      const current = await this.prisma.application.findUniqueOrThrow({ where: { id: application.id } });
      if (current.status !== to) {
        throw conflict('APPLICATION_FINAL', `Отклик уже в статусе «${STATUS_TEXT[current.status]}»`, { status: current.status });
      }
    }
    return this.employerView(company, null, application.id);
  }

  /** Новые (непросмотренные) отклики на все вакансии компании — для счётчика в меню. */
  newCountForCompany(companyId: string) {
    return this.prisma.application.count({ where: { companyId, status: 'SENT' } });
  }

  // ───────────────────────────── Вспомогательное ─────────────────────────────

  private async requireOwn(company: Company, applicationId: string) {
    const application = await this.prisma.application.findFirst({ where: { id: applicationId, companyId: company.id } });
    if (!application) throw notFound('APPLICATION_NOT_FOUND', 'Отклик не найден');
    return application;
  }

  private async candidatesFor(vacancy: Vacancy, candidateIds: string[]): Promise<Map<string, MatchCandidate>> {
    if (candidateIds.length === 0) return new Map();
    const loaded = await this.candidates.load({ ids: candidateIds, prefilter: false, qualificationFor: vacancy.specializationCode });
    return new Map(loaded.map((c) => [c.candidateId, c]));
  }

  private events(events: Array<{ fromStatus: ApplicationStatus | null; toStatus: ApplicationStatus; occurredAt: Date }>) {
    return [...events]
      .sort(compareApplicationEvents)
      .map((e) => ({ fromStatus: e.fromStatus, toStatus: e.toStatus, occurredAt: e.occurredAt.toISOString() }));
  }

  private baseView(application: Application) {
    const snapshot = application.vacancySnapshot as unknown as VacancySnapshot;
    return {
      id: application.id,
      status: application.status,
      statusTitle: STATUS_TEXT[application.status],
      vacancyId: application.vacancyId,
      vacancyTitle: snapshot.title,
      companyName: snapshot.company.name,
      specialization: snapshot.specialization,
      specializationTitle: getSpecialization(snapshot.specialization)?.title ?? snapshot.specialization,
      salaryFrom: snapshot.salaryFrom,
      salaryTo: snapshot.salaryTo,
      salaryType: 'GROSS' as const,
      workFormat: snapshot.workFormat,
      createdAt: application.createdAt.toISOString(),
      viewedAt: application.viewedAt?.toISOString() ?? null,
      decidedAt: application.decidedAt?.toISOString() ?? null,
      withdrawnAt: application.withdrawnAt?.toISOString() ?? null,
    };
  }

  /** Условный переход: применяется, только если текущий статус входит в from. Возвращает, был ли переход. */
  private async transition(
    applicationId: string,
    from: ApplicationStatusCode[],
    to: ApplicationStatusCode,
    actorUserId: string | null,
    data: Prisma.ApplicationUpdateManyMutationInput = {},
  ): Promise<boolean> {
    const now = this.clock.now();
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.application.findUnique({ where: { id: applicationId }, select: { status: true } });
      const updated = await tx.application.updateMany({ where: { id: applicationId, status: { in: from as ApplicationStatus[] } }, data: { ...data, status: to } });
      if (updated.count === 0) return false;
      await tx.applicationEvent.create({ data: { applicationId, actorUserId, fromStatus: before?.status ?? null, toStatus: to, occurredAt: now } });
      return true;
    });
  }
}
