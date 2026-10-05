import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { CATALOG_VERSION, COMPETENCY_GROUPS, SKILLS, SPECIALIZATIONS } from '../../domain/catalog/catalog';
import type { PrismaClient } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const RETRY_INITIAL_MS = 2_000;
const RETRY_MAX_MS = 30_000;

/**
 * Идемпотентно синхронизирует справочники из кода в БД при старте API.
 * Если база ещё недоступна (например, PostgreSQL перезапускается), синхронизация повторяется с нарастающей задержкой, а проверка
 * готовности (`/health/ready`) делает попытку сама: временный сбой при старте не оставляет API «неготовым» до перезапуска.
 */
@Injectable()
export class CatalogSyncService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CatalogSyncService.name);
  private synced = false;
  private inFlight: Promise<boolean> | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private retryDelayMs = RETRY_INITIAL_MS;

  constructor(private readonly prisma: PrismaService) {}

  get isSynced(): boolean {
    return this.synced;
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!(await this.ensureSynced())) this.scheduleRetry();
  }

  onModuleDestroy(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  /** Одна попытка синхронизации; параллельные вызовы делят результат. Возвращает, синхронизированы ли справочники. */
  ensureSynced(): Promise<boolean> {
    if (this.synced) return Promise.resolve(true);
    if (process.env.SKIP_CATALOG_SYNC === 'true') return Promise.resolve(false);
    this.inFlight ??= this.attempt().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async attempt(): Promise<boolean> {
    try {
      await syncCatalog(this.prisma);
      this.synced = true;
      this.logger.log(`Справочники синхронизированы (${CATALOG_VERSION})`);
      return true;
    } catch (error) {
      this.logger.error(`Не удалось синхронизировать справочники: ${(error as Error).message}`);
      return false;
    }
  }

  private scheduleRetry(): void {
    if (process.env.SKIP_CATALOG_SYNC === 'true') return;
    this.retryTimer = setTimeout(() => {
      void this.ensureSynced().then((ok) => {
        if (ok) return;
        this.retryDelayMs = Math.min(this.retryDelayMs * 2, RETRY_MAX_MS);
        this.scheduleRetry();
      });
    }, this.retryDelayMs);
    this.retryTimer.unref();
  }
}

export async function syncCatalog(prisma: PrismaService | PrismaClient): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const spec of SPECIALIZATIONS) {
      const data = { title: spec.title, description: spec.description, sortOrder: spec.sortOrder, catalogVersion: CATALOG_VERSION };
      await tx.specialization.upsert({ where: { code: spec.code }, create: { code: spec.code, ...data }, update: data });
    }
    for (const group of COMPETENCY_GROUPS) {
      const data = { specializationCode: group.specialization, title: group.title, sortOrder: group.sortOrder };
      await tx.competencyGroup.upsert({ where: { code: group.code }, create: { code: group.code, ...data }, update: data });
    }
    for (const skill of SKILLS) {
      const data = {
        title: skill.title,
        category: skill.category,
        specializationCodes: skill.specializations,
        catalogVersion: CATALOG_VERSION,
      };
      await tx.skill.upsert({ where: { code: skill.code }, create: { code: skill.code, ...data }, update: data });
    }
  });
}
