import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/clock';
import { conflict, unprocessable } from '../../common/errors';
import { runVerification, type VerificationCheck } from '../../domain/companies/verification';
import { INDUSTRIES, isKnownCode, titleOf } from '../../domain/catalog/catalog';
import { Prisma, type Company, type CompanyVerificationStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CompanyRegistry } from './company-registry';
import type { UpsertCompanyDto, VerifyCompanyDto } from './dto/company.dto';

const VERIFICATION_TEXT: Record<CompanyVerificationStatus, string> = {
  NOT_REQUESTED: 'Проверка не запрашивалась',
  VERIFIED: 'Компания проверена (демо-реестр)',
  REJECTED: 'Проверка не пройдена',
};

export function companyView(company: Company) {
  return {
    id: company.id,
    name: company.name,
    description: company.description,
    industry: company.industry,
    industryTitle: company.industry ? titleOf(INDUSTRIES, company.industry) : null,
    website: company.website,
    contactPersonName: company.contactPersonName,
    contactChannelType: company.contactChannelType,
    contactValue: company.contactValue,
    /** Добровольная метка доверия: основной сценарий без неё не блокируется. */
    verified: company.verificationStatus === 'VERIFIED',
    verification: {
      status: company.verificationStatus,
      statusTitle: VERIFICATION_TEXT[company.verificationStatus],
      inn: company.inn,
      verifiedAt: company.verifiedAt?.toISOString() ?? null,
      checks: (company.verificationChecks as VerificationCheck[] | null) ?? [],
      /** Проверка выполняется по демонстрационному реестру, а не по ЕГРЮЛ. */
      demo: true,
    },
    updatedAt: company.updatedAt.toISOString(),
  };
}

/** Профиль компании. В MVP один аккаунт работодателя управляет одной компанией. */
@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly registry: CompanyRegistry,
  ) {}

  async getOwn(userId: string) {
    const company = await this.prisma.company.findUnique({ where: { ownerUserId: userId } });
    return { company: company ? companyView(company) : null };
  }

  /** Компания текущего работодателя; без заполненного профиля компании действия подбора недоступны. */
  async requireCompany(userId: string): Promise<Company> {
    const company = await this.prisma.company.findUnique({ where: { ownerUserId: userId } });
    if (!company) throw conflict('COMPANY_PROFILE_REQUIRED', 'Сначала заполните профиль компании');
    return company;
  }

  async upsert(userId: string, dto: UpsertCompanyDto, requestId: string) {
    if (dto.industry && !isKnownCode(INDUSTRIES, dto.industry)) {
      throw unprocessable('VALIDATION_FAILED', 'Проверьте введённые данные', { fields: { industry: ['Неизвестная отрасль'] } });
    }
    const data = {
      name: dto.name.trim(),
      description: dto.description?.trim() || null,
      industry: dto.industry || null,
      website: dto.website || null,
      contactPersonName: dto.contactPersonName?.trim() || null,
      contactChannelType: dto.contactChannelType,
      contactValue: dto.contactValue.trim(),
    };
    // Смена названия снимает метку доверия: проверка относилась к прежнему названию.
    const existing = await this.prisma.company.findUnique({ where: { ownerUserId: userId }, select: { name: true, verificationStatus: true } });
    const resetVerification = existing && existing.verificationStatus !== 'NOT_REQUESTED' && existing.name !== data.name;
    const company = await this.prisma.company.upsert({
      where: { ownerUserId: userId },
      create: { ownerUserId: userId, ...data },
      update: { ...data, ...(resetVerification ? { verificationStatus: 'NOT_REQUESTED' as const, verifiedAt: null, verificationChecks: Prisma.DbNull } : {}) },
    });
    await this.audit.record({ actorUserId: userId, action: 'company.updated', objectType: 'Company', objectId: company.id, requestId });
    return { company: companyView(company) };
  }

  /**
   * Добровольная проверка компании (метка доверия): ИНН, наличие в реестре, совпадение названия и домена почты аккаунта.
   * Результат любой — основной сценарий не блокируется; неуспешную проверку можно повторить после исправления данных.
   */
  async verify(userId: string, dto: VerifyCompanyDto, requestId: string) {
    const company = await this.requireCompany(userId);
    const owner = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
    const inn = dto.inn.trim();
    const result = runVerification({ inn, companyName: company.name, ownerEmail: owner.email }, (value) => this.registry.find(value));
    const updated = await this.prisma.company.update({
      where: { id: company.id },
      data: {
        inn,
        verificationStatus: result.verified ? 'VERIFIED' : 'REJECTED',
        verifiedAt: result.verified ? this.clock.now() : null,
        verificationChecks: result.checks as unknown as Prisma.InputJsonValue,
      },
    });
    await this.audit.record({
      actorUserId: userId,
      action: 'company.verification_checked',
      objectType: 'Company',
      objectId: company.id,
      requestId,
      metadata: { status: updated.verificationStatus, failed: result.checks.filter((c) => !c.passed).map((c) => c.code) },
    });
    return { company: companyView(updated) };
  }
}
