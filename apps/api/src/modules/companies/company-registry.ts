import { readFileSync } from 'node:fs';
import { Injectable } from '@nestjs/common';
import type { RegistryOrganization } from '../../domain/companies/verification';
import { resolveFixturePath } from '../fsp/mock-fsp.provider';

/**
 * Демонстрационный реестр организаций для добровольной проверки компании (data/fixtures/company-registry-mock.json).
 * Все организации вымышлены; реальный реестр (ФНС/ЕГРЮЛ) не подключён — его место за этим же интерфейсом.
 */
@Injectable()
export class CompanyRegistry {
  private readonly organizations: Map<string, RegistryOrganization>;

  constructor() {
    const data = JSON.parse(readFileSync(resolveFixturePath('company-registry-mock.json', 'COMPANY_REGISTRY_MOCK_PATH'), 'utf8')) as { organizations: RegistryOrganization[] };
    this.organizations = new Map(data.organizations.map((o) => [o.inn, o]));
  }

  find(inn: string): RegistryOrganization | null {
    return this.organizations.get(inn) ?? null;
  }
}
