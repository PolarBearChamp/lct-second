import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/clock';
import { AppError, conflict, notFound } from '../../common/errors';
import { PolicyService } from '../../common/policy.service';
import {
  applyBlockers,
  ACTIVE_APPLICATION_STATUSES,
  vacancySources,
  type ApplyBlocker,
} from '../../domain/applications/state';
import { missingProfileFields, usableContactChannels } from '../../domain/candidate/discoverability';
import { getSpecialization } from '../../domain/catalog/catalog';
import type { Company, Grade, Prisma, Vacancy, WorkFormat } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { candidateFactsInclude, toDiscoverabilityFacts } from '../candidate-profiles/candidate-facts';
import { validateRequirements } from '../hiring-needs/hiring-needs.service';
import { MatchingRepository } from '../matching/matching.repository';
import type { CandidateVacancyQueryDto, CreateVacancyDto, UpdateVacancyDto } from './dto/vacancy.dto';
import { companySnapshotOf, evaluateFit, vacancyRequirements, vacancySpecOf } from './vacancy-views';

const FIELD_TITLES: Record<string, string> = {
  fullName: 'ФИО',
  city: 'город',
  timezone: 'часовой пояс',
  workFormats: 'формат работы',
  activeSpecializationCode: 'специализация',
  declaredGrade: 'заявленный грейд',
  experienceMonths: 'опыт в месяцах',
  skills: 'стек из справочника',
};

const VACANCY_STATUS_TEXT = { DRAFT: 'Черновик', PUBLISHED: 'Опубликована', CLOSED: 'Закрыта' } as const;

/**
 * Вакансии. Работодатель публикует вакансию напрямую (черновик → публикация → закрытие, правки с версионированием),
 * кандидат видит общий список опубликованных вакансий. Зарплатная вилка обязательна и до принятия решения видна кандидату.
 */
@Injectable()
export class VacanciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly policies: PolicyService,
    private readonly audit: AuditService,
    private readonly candidates: MatchingRepository,
  ) {}

  // ───────────────────────────── Работодатель ─────────────────────────────

  async create(company: Company, userId: string, dto: CreateVacancyDto, requestId: string) {
    validateRequirements(dto);
    if (dto.needId) {
      const need = await this.prisma.hiringNeed.findFirst({ where: { id: dto.needId, companyId: company.id } });
      if (!need) throw notFound('NEED_NOT_FOUND', 'Потребность не найдена');
    }
    const now = this.clock.now();
    const publish = dto.publish === true;
    const vacancy = await this.prisma.vacancy.create({
      data: {
        companyId: company.id,
        needId: dto.needId ?? null,
        title: dto.title.trim(),
        description: dto.description.trim(),
        specializationCode: dto.specialization,
        allowedGrades: dto.allowedGrades as Grade[],
        requiredSkills: dto.requiredSkills,
        preferredSkills: dto.preferredSkills.map((p) => ({ skill: p.skill, mode: p.mode })) as unknown as Prisma.InputJsonValue,
        workFormat: dto.workFormat as WorkFormat,
        city: dto.workFormat === 'REMOTE' ? dto.city?.trim() || null : dto.city!.trim(),
        salaryFrom: dto.salaryFrom,
        salaryTo: dto.salaryTo,
        status: publish ? 'PUBLISHED' : 'DRAFT',
        publishedAt: publish ? now : null,
      },
    });
    await this.audit.record({ actorUserId: userId, action: 'vacancy.created', objectType: 'Vacancy', objectId: vacancy.id, requestId, metadata: { published: publish } });
    return this.employerView(company, vacancy.id);
  }

  async list(company: Company, status?: string) {
    const vacancies = await this.prisma.vacancy.findMany({
      where: { companyId: company.id, ...(status ? { status: status as never } : {}) },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    });
    const counts = await this.counts(vacancies.map((v) => v.id));
    return vacancies.map((v) => this.baseEmployerView(v, counts.get(v.id)));
  }

  /** Вакансия своей компании; чужая — 404 (как несуществующая). */
  async getOwn(company: Company, vacancyId: string): Promise<Vacancy> {
    const vacancy = await this.prisma.vacancy.findFirst({ where: { id: vacancyId, companyId: company.id } });
    if (!vacancy) throw notFound('VACANCY_NOT_FOUND', 'Вакансия не найдена');
    return vacancy;
  }

  async employerView(company: Company, vacancyId: string) {
    const vacancy = await this.getOwn(company, vacancyId);
    const counts = await this.counts([vacancy.id]);
    return this.baseEmployerView(vacancy, counts.get(vacancy.id));
  }

  async update(company: Company, userId: string, vacancyId: string, dto: UpdateVacancyDto, requestId: string) {
    const current = await this.getOwn(company, vacancyId);
    const merged = {
      specialization: dto.specialization ?? current.specializationCode,
      requiredSkills: dto.requiredSkills ?? current.requiredSkills,
      preferredSkills: dto.preferredSkills ?? ((current.preferredSkills as unknown as Array<{ skill: string; mode: 'SELF_REPORTED_ALLOWED' | 'VERIFIED_ONLY' }>) ?? []),
      workFormat: dto.workFormat ?? current.workFormat,
      city: dto.city !== undefined ? dto.city : current.city,
      salaryFrom: dto.salaryFrom ?? current.salaryFrom,
      salaryTo: dto.salaryTo ?? current.salaryTo,
    };
    validateRequirements(merged);
    const updated = await this.prisma.vacancy.update({
      where: { id: current.id },
      data: {
        title: dto.title?.trim(),
        description: dto.description?.trim(),
        specializationCode: dto.specialization,
        allowedGrades: dto.allowedGrades as Grade[] | undefined,
        requiredSkills: dto.requiredSkills,
        preferredSkills: dto.preferredSkills ? (dto.preferredSkills.map((p) => ({ skill: p.skill, mode: p.mode })) as unknown as Prisma.InputJsonValue) : undefined,
        workFormat: dto.workFormat as WorkFormat | undefined,
        city: dto.city !== undefined ? dto.city?.trim() || null : undefined,
        salaryFrom: dto.salaryFrom,
        salaryTo: dto.salaryTo,
        // Правка — новая версия: отклики хранят снимок вакансии, по которой поданы.
        version: { increment: 1 },
      },
    });
    await this.audit.record({
      actorUserId: userId,
      action: 'vacancy.updated',
      objectType: 'Vacancy',
      objectId: current.id,
      requestId,
      metadata: { fields: Object.keys(dto), version: updated.version },
    });
    return this.employerView(company, current.id);
  }

  /** Публикация (DRAFT → PUBLISHED) и повторное открытие (CLOSED → PUBLISHED). Повтор на опубликованной вакансии идемпотентен. */
  async publish(company: Company, userId: string, vacancyId: string, requestId: string) {
    const vacancy = await this.getOwn(company, vacancyId);
    if (vacancy.status === 'PUBLISHED') return this.employerView(company, vacancy.id);
    const changed = await this.prisma.vacancy.updateMany({
      where: { id: vacancy.id, status: { in: vacancySources('PUBLISHED') } },
      data: { status: 'PUBLISHED', publishedAt: this.clock.now(), closedAt: null },
    });
    if (changed.count) {
      await this.audit.record({ actorUserId: userId, action: 'vacancy.published', objectType: 'Vacancy', objectId: vacancy.id, requestId, metadata: { from: vacancy.status } });
    }
    return this.employerView(company, vacancy.id);
  }

  /** Закрытие (PUBLISHED → CLOSED): новые отклики не принимаются, поданные остаются в работе. Повтор идемпотентен. */
  async close(company: Company, userId: string, vacancyId: string, requestId: string) {
    const vacancy = await this.getOwn(company, vacancyId);
    if (vacancy.status === 'CLOSED') return this.employerView(company, vacancy.id);
    if (vacancy.status === 'DRAFT') {
      throw conflict('VACANCY_NOT_PUBLISHED', 'Черновик нельзя закрыть: сначала опубликуйте вакансию или измените её', { status: vacancy.status });
    }
    const changed = await this.prisma.vacancy.updateMany({
      where: { id: vacancy.id, status: { in: ['PUBLISHED'] } },
      data: { status: 'CLOSED', closedAt: this.clock.now() },
    });
    if (changed.count) {
      await this.audit.record({ actorUserId: userId, action: 'vacancy.closed', objectType: 'Vacancy', objectId: vacancy.id, requestId });
    }
    return this.employerView(company, vacancy.id);
  }

  // ───────────────────────────── Кандидат ─────────────────────────────

  /** Общий список опубликованных вакансий с фильтрами; для каждой — соответствие кандидата и возможность откликнуться. */
  async browse(candidateId: string, query: CandidateVacancyQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const context = await this.candidateContext(candidateId);
    const where: Prisma.VacancyWhereInput = {
      status: 'PUBLISHED',
      ...(query.onlyMine ? { specializationCode: { in: context.confirmedSpecializations.length ? context.confirmedSpecializations : ['__none__'] } } : {}),
      ...(query.specialization ? { specializationCode: query.specialization } : {}),
      ...(query.workFormat ? { workFormat: query.workFormat } : {}),
      ...(query.grade ? { allowedGrades: { has: query.grade } } : {}),
      ...(query.city?.trim() ? { OR: [{ workFormat: 'REMOTE' }, { city: { equals: query.city.trim(), mode: 'insensitive' } }] } : {}),
      ...(query.q?.trim()
        ? {
            AND: [
              {
                OR: [
                  { title: { contains: query.q.trim(), mode: 'insensitive' } },
                  { description: { contains: query.q.trim(), mode: 'insensitive' } },
                ],
              },
            ],
          }
        : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.vacancy.count({ where }),
      this.prisma.vacancy.findMany({
        where,
        include: { company: true },
        orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const mine = await this.myApplications(candidateId, items.map((v) => v.id));
    const fits = await this.fitsFor(candidateId, items);
    return {
      page,
      pageSize,
      total,
      items: items.map((vacancy) => {
        const application = mine.get(vacancy.id) ?? null;
        const fit = fits.get(vacancy.id) ?? null;
        return {
          ...this.baseCandidateView(vacancy, vacancy.company),
          myApplication: application ? { id: application.id, status: application.status } : null,
          fit: fit ? { passes: fit.passes, violations: fit.violations, score: fit.score } : null,
          canApply: this.blockersFor(context, vacancy, Boolean(application && ACTIVE_APPLICATION_STATUSES.includes(application.status))).length === 0,
        };
      }),
    };
  }

  /** Опубликованная вакансия для кандидата. Закрытая видна только тому, кто на неё откликался (история); черновик — никому. */
  async candidateView(candidateId: string, vacancyId: string) {
    const vacancy = await this.prisma.vacancy.findFirst({ where: { id: vacancyId }, include: { company: true } });
    const application = vacancy
      ? await this.prisma.application.findFirst({ where: { vacancyId: vacancy.id, candidateId }, orderBy: { createdAt: 'desc' }, select: { id: true, status: true } })
      : null;
    if (!vacancy || vacancy.status === 'DRAFT' || (vacancy.status === 'CLOSED' && !application)) {
      throw notFound('VACANCY_NOT_FOUND', 'Вакансия не найдена');
    }
    const context = await this.candidateContext(candidateId);
    const hasActive = Boolean(application && ACTIVE_APPLICATION_STATUSES.includes(application.status));
    const blockers = this.blockersFor(context, vacancy, hasActive);
    const fit = (await this.fitsFor(candidateId, [vacancy], true)).get(vacancy.id) ?? null;
    const valueOf = (channel: string) => (channel === 'EMAIL' ? context.profile.contactEmail : channel === 'PHONE' ? context.profile.phone : context.profile.messenger);
    return {
      ...this.baseCandidateView(vacancy, vacancy.company),
      description: vacancy.description,
      preferredSkills: vacancyRequirements(vacancy).preferredSkills,
      company: { ...companySnapshotOf(vacancy.company), verified: vacancy.company.verificationStatus === 'VERIFIED' },
      status: vacancy.status,
      myApplication: application ? { id: application.id, status: application.status } : null,
      fit,
      canApply: blockers.length === 0,
      blockers,
      /** Что будет раскрыто компании при отклике (текущие выбранные и заполненные каналы). */
      disclosure: {
        fullName: context.profile.fullName,
        channels: context.channels.map((channel) => ({ channel, value: valueOf(channel) })),
        alsoShared: ['ФИО', 'ссылки на портфолио', 'описание опыта', 'названия мероприятий ФСП', 'сопроводительное сообщение'],
      },
    };
  }

  // ───────────────────────────── Для откликов ─────────────────────────────

  /** Препятствия к отклику для данного кандидата и вакансии (пусто — можно откликаться). */
  async applyBlockersFor(candidateId: string, vacancy: Vacancy, hasActiveApplication: boolean): Promise<ApplyBlocker[]> {
    return this.blockersFor(await this.candidateContext(candidateId), vacancy, hasActiveApplication);
  }

  async candidateContext(candidateId: string) {
    const profile = await this.prisma.candidateProfile.findUniqueOrThrow({ where: { id: candidateId }, include: candidateFactsInclude });
    const facts = toDiscoverabilityFacts(profile, false);
    return {
      profile,
      facts,
      confirmedSpecializations: facts.confirmedSpecializations,
      missingFields: missingProfileFields(facts),
      channels: usableContactChannels(profile) as Array<'EMAIL' | 'PHONE' | 'MESSENGER'>,
    };
  }

  private blockersFor(context: Awaited<ReturnType<VacanciesService['candidateContext']>>, vacancy: Vacancy, hasActiveApplication: boolean): ApplyBlocker[] {
    return applyBlockers(
      {
        vacancyStatus: vacancy.status,
        vacancySpecialization: vacancy.specializationCode,
        confirmedSpecializations: context.confirmedSpecializations,
        missingProfileFields: context.missingFields,
        usableChannels: context.channels,
        hasActiveApplication,
      },
      {
        specialization: getSpecialization(vacancy.specializationCode)?.title ?? vacancy.specializationCode,
        fields: (codes) => codes.map((code) => FIELD_TITLES[code] ?? code).join(', '),
      },
    );
  }

  /** Соответствие кандидата вакансиям страницы — по квалификации той специализации, на которую вакансия. */
  private async fitsFor(candidateId: string, vacancies: Vacancy[], withExplanation = false) {
    const result = new Map<string, ReturnType<typeof evaluateFit>>();
    const specializations = [...new Set(vacancies.map((v) => v.specializationCode))];
    for (const specialization of specializations) {
      const [candidate] = await this.candidates.load({ ids: [candidateId], prefilter: false, qualificationFor: specialization });
      if (!candidate) continue;
      for (const vacancy of vacancies.filter((v) => v.specializationCode === specialization)) {
        result.set(vacancy.id, evaluateFit(candidate, vacancySpecOf(vacancy), this.policies.matching, withExplanation));
      }
    }
    return result;
  }

  private async myApplications(candidateId: string, vacancyIds: string[]) {
    const rows = await this.prisma.application.findMany({
      where: { candidateId, vacancyId: { in: vacancyIds } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, vacancyId: true, status: true },
    });
    const byVacancy = new Map<string, { id: string; status: (typeof rows)[number]['status'] }>();
    // Активный отклик приоритетнее прежних (отозванных) по той же вакансии.
    for (const row of rows) {
      const existing = byVacancy.get(row.vacancyId);
      if (!existing || (!ACTIVE_APPLICATION_STATUSES.includes(existing.status) && ACTIVE_APPLICATION_STATUSES.includes(row.status))) {
        byVacancy.set(row.vacancyId, { id: row.id, status: row.status });
      }
    }
    return byVacancy;
  }

  private async counts(vacancyIds: string[]) {
    const grouped = await this.prisma.application.groupBy({
      by: ['vacancyId', 'status'],
      where: { vacancyId: { in: vacancyIds } },
      _count: { _all: true },
    });
    const counts = new Map<string, { total: number; fresh: number; active: number }>();
    for (const row of grouped) {
      const entry = counts.get(row.vacancyId) ?? { total: 0, fresh: 0, active: 0 };
      entry.total += row._count._all;
      if (row.status === 'SENT') entry.fresh += row._count._all;
      if (ACTIVE_APPLICATION_STATUSES.includes(row.status)) entry.active += row._count._all;
      counts.set(row.vacancyId, entry);
    }
    return counts;
  }

  // ───────────────────────────── Представления ─────────────────────────────

  private baseEmployerView(vacancy: Vacancy, counts: { total: number; fresh: number; active: number } = { total: 0, fresh: 0, active: 0 }) {
    return {
      id: vacancy.id,
      title: vacancy.title,
      description: vacancy.description,
      ...vacancyRequirements(vacancy),
      status: vacancy.status,
      statusTitle: VACANCY_STATUS_TEXT[vacancy.status],
      version: vacancy.version,
      needId: vacancy.needId,
      publishedAt: vacancy.publishedAt?.toISOString() ?? null,
      closedAt: vacancy.closedAt?.toISOString() ?? null,
      applicationsCount: counts.total,
      newApplicationsCount: counts.fresh,
      activeApplicationsCount: counts.active,
      createdAt: vacancy.createdAt.toISOString(),
      updatedAt: vacancy.updatedAt.toISOString(),
    };
  }

  private baseCandidateView(vacancy: Vacancy, company: Company) {
    const requirements = vacancyRequirements(vacancy);
    return {
      id: vacancy.id,
      title: vacancy.title,
      companyName: company.name,
      companyIndustry: companySnapshotOf(company).industryTitle,
      companyVerified: company.verificationStatus === 'VERIFIED',
      ...requirements,
      publishedAt: vacancy.publishedAt?.toISOString() ?? null,
    };
  }
}

/** Ошибка отклика по первому препятствию (общее для API и тестов). */
export function applyBlockerError(blocker: ApplyBlocker, blockers: ApplyBlocker[], extra?: Record<string, unknown>): AppError {
  const code = blocker.code === 'VACANCY_NOT_OPEN' ? 'VACANCY_CLOSED' : blocker.code;
  return conflict(code, blocker.message, { blockers, ...extra });
}
