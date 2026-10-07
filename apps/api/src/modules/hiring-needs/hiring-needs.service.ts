import { Injectable } from '@nestjs/common';
import { notFound, unprocessable } from '../../common/errors';
import { PolicyService } from '../../common/policy.service';
import { isAssessable } from '../../domain/assessment/bank/registry';
import { BankCoverageError, buildAssessmentBlueprint } from '../../domain/assessment/blueprint';
import { getFamily } from '../../domain/assessment/bank/registry';
import { instantiate } from '../../domain/assessment/instantiate';
import { getSkill, getSpecialization, GRADE_TITLES, isKnownSkill, type GradeCode, type SpecializationCode } from '../../domain/catalog/catalog';
import type { NeedSpec } from '../../domain/matching/rank';
import type { Company, Grade, HiringNeed, Prisma, WorkFormat } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { CreateNeedDto, UpdateNeedDto } from './dto/need.dto';

type PreferredSkill = { skill: string; mode: 'SELF_REPORTED_ALLOWED' | 'VERIFIED_ONLY' };

export function needView(need: HiringNeed & { _count?: { selectionRuns: number } }) {
  const preferred = (need.preferredSkills as unknown as PreferredSkill[]) ?? [];
  return {
    id: need.id,
    title: need.title,
    description: need.description,
    specialization: need.specializationCode,
    specializationTitle: getSpecialization(need.specializationCode)?.title ?? need.specializationCode,
    allowedGrades: need.allowedGrades,
    requiredSkills: need.requiredSkills.map((code) => ({ code, title: getSkill(code)?.title ?? code })),
    preferredSkills: preferred.map((p) => ({ code: p.skill, title: getSkill(p.skill)?.title ?? p.skill, mode: p.mode })),
    workFormat: need.workFormat,
    city: need.city,
    salaryFrom: need.salaryFrom,
    salaryTo: need.salaryTo,
    salaryType: 'GROSS' as const,
    status: need.status,
    version: need.version,
    selectionsCount: need._count?.selectionRuns ?? 0,
    createdAt: need.createdAt.toISOString(),
    updatedAt: need.updatedAt.toISOString(),
  };
}

/** Требования потребности или вакансии в виде, пригодном для подбора (структурно у них одни и те же поля). */
export type RequirementsSource = Pick<HiringNeed, 'specializationCode' | 'allowedGrades' | 'requiredSkills' | 'preferredSkills' | 'workFormat' | 'city' | 'salaryFrom' | 'salaryTo'>;

export function needSpecOf(need: RequirementsSource): NeedSpec {
  return {
    specialization: need.specializationCode,
    allowedGrades: need.allowedGrades as GradeCode[],
    requiredSkills: need.requiredSkills,
    preferredSkills: (need.preferredSkills as unknown as PreferredSkill[]) ?? [],
    workFormat: need.workFormat,
    city: need.city,
    salaryFrom: need.salaryFrom,
    salaryTo: need.salaryTo,
  };
}

/**
 * Проверка структурированных требований (общая для потребностей и вакансий): навыки из справочника, обязательные навыки проверяются
 * заданиями, город для не удалённой работы, корректная вилка.
 */
export function validateRequirements(input: {
  specialization: string;
  requiredSkills: string[];
  preferredSkills: PreferredSkill[];
  workFormat: string;
  city?: string | null;
  salaryFrom: number;
  salaryTo: number;
}) {
  const fields: Record<string, string[]> = {};
  const add = (field: string, message: string) => (fields[field] = [...(fields[field] ?? []), message]);
  for (const skill of input.requiredSkills) {
    if (!isKnownSkill(skill)) add('requiredSkills', `Навыка нет в справочнике: ${skill}`);
    else if (!isAssessable(input.specialization as SpecializationCode, skill)) {
      add(
        'requiredSkills',
        `«${getSkill(skill)?.title}» пока не проверяется тестами этой специализации — укажите его как желательный навык`,
      );
    }
  }
  const preferredCodes = input.preferredSkills.map((p) => p.skill);
  if (new Set(preferredCodes).size !== preferredCodes.length) add('preferredSkills', 'Желательные навыки повторяются');
  for (const skill of preferredCodes) {
    if (!isKnownSkill(skill)) add('preferredSkills', `Навыка нет в справочнике: ${skill}`);
    if (input.requiredSkills.includes(skill)) add('preferredSkills', `«${getSkill(skill)?.title ?? skill}» уже указан как обязательный`);
  }
  if (input.workFormat !== 'REMOTE' && !input.city?.trim()) add('city', 'Для офисного и гибридного формата укажите город');
  if (input.salaryFrom > input.salaryTo) add('salaryTo', 'Значение «до» должно быть не меньше «от»');
  if (Object.keys(fields).length) throw unprocessable('VALIDATION_FAILED', 'Проверьте требования', { fields });
}

/** Внутреннее описание потребности компании (не публикуемая вакансия). */
@Injectable()
export class HiringNeedsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policies: PolicyService,
    private readonly audit: AuditService,
  ) {}

  async create(company: Company, userId: string, dto: CreateNeedDto, requestId: string) {
    validateRequirements(dto);
    const need = await this.prisma.hiringNeed.create({
      data: {
        companyId: company.id,
        title: dto.title.trim(),
        description: dto.description.trim(),
        specializationCode: dto.specialization,
        allowedGrades: dto.allowedGrades as Grade[],
        requiredSkills: dto.requiredSkills,
        preferredSkills: dto.preferredSkills.map((p) => ({ skill: p.skill, mode: p.mode })) as unknown as Prisma.InputJsonValue,
        workFormat: dto.workFormat as WorkFormat,
        city: dto.workFormat === 'REMOTE' ? (dto.city?.trim() || null) : dto.city!.trim(),
        salaryFrom: dto.salaryFrom,
        salaryTo: dto.salaryTo,
        status: dto.status ?? 'ACTIVE',
      },
    });
    await this.audit.record({ actorUserId: userId, action: 'need.created', objectType: 'HiringNeed', objectId: need.id, requestId });
    return needView(need);
  }

  async list(company: Company, status?: string) {
    const needs = await this.prisma.hiringNeed.findMany({
      where: { companyId: company.id, ...(status ? { status: status as never } : {}) },
      include: { _count: { select: { selectionRuns: true } } },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    });
    return needs.map(needView);
  }

  /** Потребность своей компании; чужая — 404 (как несуществующая). */
  async getOwn(company: Company, needId: string): Promise<HiringNeed> {
    const need = await this.prisma.hiringNeed.findFirst({ where: { id: needId, companyId: company.id } });
    if (!need) throw notFound('NEED_NOT_FOUND', 'Потребность не найдена');
    return need;
  }

  async get(company: Company, needId: string) {
    const need = await this.prisma.hiringNeed.findFirst({
      where: { id: needId, companyId: company.id },
      include: { _count: { select: { selectionRuns: true } } },
    });
    if (!need) throw notFound('NEED_NOT_FOUND', 'Потребность не найдена');
    return needView(need);
  }

  async update(company: Company, userId: string, needId: string, dto: UpdateNeedDto, requestId: string) {
    const current = await this.getOwn(company, needId);
    const merged = {
      specialization: dto.specialization ?? current.specializationCode,
      requiredSkills: dto.requiredSkills ?? current.requiredSkills,
      preferredSkills: dto.preferredSkills ?? ((current.preferredSkills as unknown as PreferredSkill[]) ?? []),
      workFormat: dto.workFormat ?? current.workFormat,
      city: dto.city !== undefined ? dto.city : current.city,
      salaryFrom: dto.salaryFrom ?? current.salaryFrom,
      salaryTo: dto.salaryTo ?? current.salaryTo,
    };
    validateRequirements(merged);
    const updated = await this.prisma.hiringNeed.update({
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
        status: dto.status,
        // Любое изменение создаёт новую версию: сохранённые подборки ссылаются на версию, по которой построены.
        version: { increment: 1 },
      },
      include: { _count: { select: { selectionRuns: true } } },
    });
    await this.audit.record({
      actorUserId: userId,
      action: 'need.updated',
      objectType: 'HiringNeed',
      objectId: current.id,
      requestId,
      metadata: { fields: Object.keys(dto), version: updated.version },
    });
    return needView(updated);
  }

  /**
   * Предпросмотр плана теста под требования: связь «требование → навык → семейство», покрытие и образцы условий
   * без правильных ответов. Не меняет грейд кандидатов и не создаёт отдельный обязательный экзамен.
   */
  async assessmentPreview(company: Company, needId: string, grade?: GradeCode) {
    const need = await this.getOwn(company, needId);
    const spec = needSpecOf(need);
    const grades = grade ? [grade] : spec.allowedGrades;
    const policy = this.policies.assessment;
    try {
      return {
        needId: need.id,
        needVersion: need.version,
        specialization: need.specializationCode,
        notice:
          'Это предпросмотр: регистрационный тест кандидата строится по общему плану специализации. Требования выбирают семейства и прикладной контекст, но не меняют пороги и сложность грейда; отдельный экзамен под работодателя в MVP не проводится.',
        grades: grades.map((g) => {
          const blueprint = buildAssessmentBlueprint(
            { specialization: spec.specialization as SpecializationCode, requiredSkills: spec.requiredSkills, preferredSkills: spec.preferredSkills },
            g,
            policy,
          );
          return {
            grade: g,
            gradeTitle: GRADE_TITLES[g],
            blueprint,
            samples: blueprint.slots.map((slot) => {
              const family = getFamily(slot.familyId)!;
              const instance = instantiate(family, g, `preview|${need.id}|v${need.version}|${g}|${slot.position}`);
              // Только публичные условия: ключ проверки и семантические идентификаторы не передаются.
              return { position: slot.position, familyTitle: slot.familyTitle, groupTitle: slot.groupTitle, task: instance.public };
            }),
          };
        }),
      };
    } catch (error) {
      if (error instanceof BankCoverageError) throw unprocessable('BANK_COVERAGE', error.message);
      throw error;
    }
  }
}
