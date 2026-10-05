import { Injectable } from '@nestjs/common';
import { conflict, unprocessable } from '../../common/errors';
import { INDUSTRIES, isKnownCode, titleOf } from '../../domain/catalog/catalog';
import type { Company } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { UpsertCompanyDto } from './dto/company.dto';

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
    /** Проверка компаний в MVP не выполняется. */
    verified: false,
    updatedAt: company.updatedAt.toISOString(),
  };
}

/** Профиль компании. В MVP один аккаунт работодателя управляет одной компанией. */
@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
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
    const company = await this.prisma.company.upsert({
      where: { ownerUserId: userId },
      create: { ownerUserId: userId, ...data },
      update: data,
    });
    await this.audit.record({ actorUserId: userId, action: 'company.updated', objectType: 'Company', objectId: company.id, requestId });
    return { company: companyView(company) };
  }
}
