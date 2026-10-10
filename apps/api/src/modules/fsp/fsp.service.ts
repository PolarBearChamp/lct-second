import { Inject, Injectable, Logger } from '@nestjs/common';
import { Clock } from '../../common/clock';
import { conflict, notFound, unprocessable } from '../../common/errors';
import { RATE_LIMITS, RateLimitService } from '../../common/rate-limit.service';
import { buildProfileView, FSP_DEMO_NOTICE } from '../../domain/privacy/profile-view';
import { isUniqueViolation } from '../../common/errors';
import type { FspLinkState, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { sha256 } from '../auth/crypto';
import { ProfileViewService } from '../profile-view/profile-view.service';
import { FSP_PROVIDER, FspProviderError, type FspAchievementRecord, type FspProvider } from './fsp-provider';

/**
 * Привязка ФСП ID и синхронизация достижений.
 * Состояния: NOT_LINKED (нет записи), LINKED_WITH_HISTORY, LINKED_WITHOUT_HISTORY, SYNC_ERROR.
 * При ошибке синхронизации последняя успешная история сохраняется. Отвязка убирает бонус ФСП и прекращает показ истории.
 */
@Injectable()
export class FspService {
  private readonly logger = new Logger(FspService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly rateLimit: RateLimitService,
    private readonly views: ProfileViewService,
    @Inject(FSP_PROVIDER) private readonly provider: FspProvider,
  ) {}

  async state(candidateId: string) {
    const loaded = await this.views.load(candidateId);
    if (!loaded) throw notFound();
    const link = await this.prisma.fspLink.findUnique({ where: { candidateId } });
    const view = buildProfileView('OWNER', loaded.profile, loaded.qualification, loaded.fsp, null, loaded.extras);
    return {
      provider: this.provider.name,
      demo: this.provider.isDemo,
      notice: this.provider.isDemo ? FSP_DEMO_NOTICE : null,
      state: link ? link.state : 'NOT_LINKED',
      externalId: link?.externalId ?? null,
      linkedAt: link?.linkedAt.toISOString() ?? null,
      lastSyncAttemptAt: link?.lastSyncAttemptAt?.toISOString() ?? null,
      lastSuccessfulSyncAt: link?.lastSuccessfulSyncAt?.toISOString() ?? null,
      lastErrorCode: link?.lastErrorCode ?? null,
      achievements: view.fsp.achievements,
    };
  }

  async link(candidateId: string, userId: string, rawExternalId: string, code: string, requestId: string) {
    this.rateLimit.consume(`fsp-link:${userId}`, RATE_LIMITS.fspLinkPerUser);
    const externalId = rawExternalId.trim().toUpperCase();
    const existing = await this.prisma.fspLink.findUnique({ where: { candidateId } });
    if (existing) throw conflict('FSP_ALREADY_LINKED', 'ФСП ID уже привязан. Отвяжите его, чтобы привязать другой.');
    const taken = await this.prisma.fspLink.findUnique({ where: { provider_externalId: { provider: this.provider.name, externalId } } });
    if (taken) throw conflict('FSP_ID_TAKEN', 'Этот ФСП ID уже привязан к другому профилю');
    // Только ввод чужого ID без кода не даёт доступа к его достижениям.
    if (!(await this.provider.verifyLinkCode(externalId, code))) {
      throw unprocessable('FSP_CODE_INVALID', 'Неверный ФСП ID или код подтверждения');
    }
    const now = this.clock.now();
    const codeHash = sha256(`${this.provider.name}:${externalId}:${code.trim()}`);
    const redeemed = await this.prisma.fspLinkCodeRedemption.findUnique({ where: { codeHash } });
    // Код одноразовый: другой профиль не может использовать его повторно (тот же кандидат может привязать ID заново после отвязки).
    if (redeemed && redeemed.candidateId !== candidateId) throw conflict('FSP_CODE_USED', 'Этот одноразовый код уже использован');
    try {
      await this.prisma.$transaction(async (tx) => {
        if (!redeemed) {
          await tx.fspLinkCodeRedemption.create({
            data: { codeHash, provider: this.provider.name, externalId, candidateId, redeemedAt: now },
          });
        }
        await tx.fspLink.create({
          data: { candidateId, provider: this.provider.name, externalId, state: 'LINKED_WITHOUT_HISTORY', linkedAt: now },
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict('FSP_CODE_USED', 'Этот одноразовый код уже использован');
      throw error;
    }
    await this.audit.record({ actorUserId: userId, action: 'fsp.linked', objectType: 'FspLink', objectId: candidateId, requestId, metadata: { provider: this.provider.name } });
    await this.sync(candidateId, userId, requestId);
    return this.state(candidateId);
  }

  async unlink(candidateId: string, userId: string, requestId: string) {
    const link = await this.prisma.fspLink.findUnique({ where: { candidateId } });
    if (!link) return this.state(candidateId);
    await this.prisma.$transaction([
      this.prisma.fspAchievement.deleteMany({ where: { candidateId, provider: link.provider } }),
      this.prisma.fspLink.delete({ where: { candidateId } }),
    ]);
    await this.audit.record({ actorUserId: userId, action: 'fsp.unlinked', objectType: 'FspLink', objectId: candidateId, requestId });
    return this.state(candidateId);
  }

  /** Обновление через провайдер. Ошибка не удаляет последнюю успешную историю. */
  async sync(candidateId: string, userId: string | null, requestId: string | null) {
    const link = await this.prisma.fspLink.findUnique({ where: { candidateId } });
    if (!link) throw conflict('FSP_NOT_LINKED', 'ФСП ID не привязан');
    const now = this.clock.now();
    let records: FspAchievementRecord[];
    try {
      records = await this.provider.fetchAchievements(link.externalId);
    } catch (error) {
      const code = error instanceof FspProviderError ? error.code : 'FSP_UNAVAILABLE';
      this.logger.warn(`Синхронизация ФСП не удалась: ${code}`);
      await this.prisma.fspLink.update({
        where: { candidateId },
        data: { state: 'SYNC_ERROR', lastSyncAttemptAt: now, lastErrorCode: code },
      });
      await this.audit.record({ actorUserId: userId, action: 'fsp.sync_failed', objectType: 'FspLink', objectId: candidateId, requestId, metadata: { code } });
      return this.state(candidateId);
    }
    const state: FspLinkState = records.length ? 'LINKED_WITH_HISTORY' : 'LINKED_WITHOUT_HISTORY';
    await this.prisma.$transaction(async (tx) => {
      await tx.fspAchievement.deleteMany({ where: { candidateId, provider: link.provider } });
      if (records.length) {
        await tx.fspAchievement.createMany({ data: records.map((r) => this.toRow(candidateId, link.provider, r, now)) });
      }
      await tx.fspLink.update({
        where: { candidateId },
        data: { state, lastSyncAttemptAt: now, lastSuccessfulSyncAt: now, lastErrorCode: null },
      });
    });
    await this.audit.record({ actorUserId: userId, action: 'fsp.synced', objectType: 'FspLink', objectId: candidateId, requestId, metadata: { records: records.length } });
    return this.state(candidateId);
  }

  private toRow(candidateId: string, provider: string, r: FspAchievementRecord, now: Date): Prisma.FspAchievementCreateManyInput {
    return {
      candidateId,
      provider,
      externalId: r.externalId,
      eventId: r.eventId,
      eventTitle: r.eventTitle,
      discipline: r.discipline,
      eventLevel: r.eventLevel,
      eventDate: r.eventDate ? new Date(`${r.eventDate}T00:00:00.000Z`) : null,
      participationType: r.participationType,
      place: r.place,
      teamRole: r.teamRole,
      skillTags: r.skillTags,
      source: r.source,
      verifiedAt: r.verifiedAt ? new Date(r.verifiedAt) : null,
      syncedAt: now,
      isDemo: this.provider.isDemo,
    };
  }
}
