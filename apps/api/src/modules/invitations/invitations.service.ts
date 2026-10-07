import { Injectable } from '@nestjs/common';
import { addDays, Clock } from '../../common/clock';
import { conflict, isUniqueViolation, notFound, unprocessable } from '../../common/errors';
import { PolicyService } from '../../common/policy.service';
import { usableContactChannels } from '../../domain/candidate/discoverability';
import { INDUSTRIES, titleOf } from '../../domain/catalog/catalog';
import { ACTIVE_INVITATION_STATUSES, compareInvitationEvents, type InvitationStatusCode } from '../../domain/invitations/state';
import type { Company, ContactChannel, Invitation, InvitationStatus, Prisma } from '../../generated/prisma/client';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MatchingRepository } from '../matching/matching.repository';
import type { SendInvitationDto } from './dto/invitation.dto';

type CompanySnapshot = { name: string; industry: string | null; industryTitle: string | null; website: string | null; description: string | null };

const ACTIVE: InvitationStatus[] = ['SENT', 'VIEWED'];

/**
 * Приглашения и раскрытие контактов.
 * Все переходы статусов — условные UPDATE (WHERE status IN …), поэтому параллельные accept/withdraw,
 * двойной клик и повторная отправка обрабатываются атомарно: побеждает первый, второй получает 409
 * (или тот же результат, если действие идемпотентно повторено).
 */
@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly policies: PolicyService,
    private readonly audit: AuditService,
    private readonly candidates: MatchingRepository,
  ) {}

  // ───────────────────────────── Работодатель ─────────────────────────────

  async send(company: Company, userId: string, dto: SendInvitationDto, idempotencyKey: string | undefined, requestId: string) {
    if (dto.salaryFrom > dto.salaryTo) {
      throw unprocessable('VALIDATION_FAILED', 'Проверьте зарплатную вилку', { fields: { salaryTo: ['Значение «до» должно быть не меньше «от»'] } });
    }
    if (idempotencyKey) {
      const existing = await this.prisma.invitation.findUnique({ where: { companyId_clientRequestId: { companyId: company.id, clientRequestId: idempotencyKey } } });
      if (existing) return { invitation: await this.employerView(company, existing.id), created: false };
    }
    const [candidate] = await this.candidates.load({ ids: [dto.candidateId], prefilter: false });
    const grant = await this.prisma.contactAccessGrant.findUnique({ where: { candidateId_companyId: { candidateId: dto.candidateId, companyId: company.id } } });
    if (!candidate || (!candidate.discoverable && !(grant && !grant.revokedAt))) {
      throw notFound('CANDIDATE_NOT_FOUND', 'Кандидат не найден или недоступен');
    }
    if (dto.needId) {
      const need = await this.prisma.hiringNeed.findFirst({ where: { id: dto.needId, companyId: company.id } });
      if (!need) throw notFound('NEED_NOT_FOUND', 'Потребность не найдена');
      if (need.status === 'ARCHIVED') throw unprocessable('NEED_ARCHIVED', 'Потребность в архиве');
    }
    await this.expireStale({ companyId: company.id, candidateId: dto.candidateId });
    const now = this.clock.now();
    const snapshot: CompanySnapshot = {
      name: company.name,
      industry: company.industry,
      industryTitle: company.industry ? titleOf(INDUSTRIES, company.industry) : null,
      website: company.website,
      description: company.description,
    };
    try {
      const invitation = await this.prisma.$transaction(async (tx) => {
        const created = await tx.invitation.create({
          data: {
            companyId: company.id,
            candidateId: dto.candidateId,
            needId: dto.needId ?? null,
            title: dto.title.trim(),
            description: dto.description.trim(),
            salaryFrom: dto.salaryFrom,
            salaryTo: dto.salaryTo,
            workFormat: dto.workFormat,
            employerContactType: dto.employerContactType,
            employerContact: dto.employerContact.trim(),
            companySnapshot: snapshot as unknown as Prisma.InputJsonValue,
            status: 'SENT',
            createdAt: now,
            expiresAt: addDays(now, this.policies.invitation.ttlDays),
            createdByUserId: userId,
            clientRequestId: idempotencyKey ?? null,
            policyVersion: this.policies.invitation.version,
          },
        });
        await tx.invitationEvent.create({ data: { invitationId: created.id, actorUserId: userId, fromStatus: null, toStatus: 'SENT', occurredAt: now } });
        await this.audit.recordTx(tx, {
          actorUserId: userId,
          action: 'invitation.sent',
          objectType: 'Invitation',
          objectId: created.id,
          requestId,
          metadata: { candidateId: dto.candidateId, needId: dto.needId ?? null },
        });
        return created;
      });
      return { invitation: await this.employerView(company, invitation.id), created: true };
    } catch (error) {
      if (isUniqueViolation(error)) {
        if (idempotencyKey) {
          const existing = await this.prisma.invitation.findUnique({ where: { companyId_clientRequestId: { companyId: company.id, clientRequestId: idempotencyKey } } });
          if (existing) return { invitation: await this.employerView(company, existing.id), created: false };
        }
        const active = await this.prisma.invitation.findFirst({
          where: { companyId: company.id, candidateId: dto.candidateId, status: { in: ACTIVE } },
        });
        throw conflict('ACTIVE_INVITATION_EXISTS', 'У этого кандидата уже есть активное приглашение от вашей компании. Чтобы изменить условия, отзовите его и отправьте новое.', {
          invitationId: active?.id,
        });
      }
      throw error;
    }
  }

  async listForCompany(company: Company, status: string | undefined, page: number, pageSize: number) {
    await this.expireStale({ companyId: company.id });
    const where: Prisma.InvitationWhereInput = {
      companyId: company.id,
      ...(status === 'ACTIVE' ? { status: { in: ACTIVE } } : status ? { status: status as InvitationStatus } : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.invitation.count({ where }),
      this.prisma.invitation.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { candidate: { select: { alias: true } }, need: { select: { title: true } } },
      }),
    ]);
    const grants = await this.prisma.contactAccessGrant.findMany({
      where: { companyId: company.id, candidateId: { in: items.map((i) => i.candidateId) }, revokedAt: null },
      select: { candidateId: true },
    });
    const granted = new Set(grants.map((g) => g.candidateId));
    return {
      page,
      pageSize,
      total,
      items: items.map((inv) => ({
        ...this.baseView(inv),
        candidateId: inv.candidateId,
        candidateAlias: inv.candidate.alias,
        needId: inv.needId,
        needTitle: inv.need?.title ?? null,
        hasContactAccess: granted.has(inv.candidateId),
      })),
    };
  }

  async employerView(company: Company, invitationId: string) {
    await this.expireStale({ companyId: company.id, ids: [invitationId] });
    const inv = await this.prisma.invitation.findFirst({
      where: { id: invitationId, companyId: company.id },
      include: { candidate: { select: { alias: true } }, need: { select: { title: true } }, events: { orderBy: { occurredAt: 'asc' } } },
    });
    if (!inv) throw notFound('INVITATION_NOT_FOUND', 'Приглашение не найдено');
    const grant = await this.prisma.contactAccessGrant.findUnique({ where: { candidateId_companyId: { candidateId: inv.candidateId, companyId: company.id } } });
    return {
      ...this.baseView(inv),
      description: inv.description,
      employerContactType: inv.employerContactType,
      employerContact: inv.employerContact,
      candidateId: inv.candidateId,
      candidateAlias: inv.candidate.alias,
      needId: inv.needId,
      needTitle: inv.need?.title ?? null,
      events: [...inv.events].sort(compareInvitationEvents).map((e) => ({ fromStatus: e.fromStatus, toStatus: e.toStatus, occurredAt: e.occurredAt.toISOString() })),
      contactAccess: grant
        ? { active: !grant.revokedAt, grantedAt: grant.grantedAt.toISOString(), revokedAt: grant.revokedAt?.toISOString() ?? null, fromThisInvitation: grant.sourceInvitationId === inv.id }
        : null,
    };
  }

  async withdraw(company: Company, userId: string, invitationId: string, requestId: string) {
    const inv = await this.prisma.invitation.findFirst({ where: { id: invitationId, companyId: company.id } });
    if (!inv) throw notFound('INVITATION_NOT_FOUND', 'Приглашение не найдено');
    await this.expireStale({ ids: [inv.id] });
    const changed = await this.transition(inv.id, ACTIVE, 'WITHDRAWN', userId, { respondedAt: this.clock.now() });
    if (!changed) {
      const current = await this.prisma.invitation.findUniqueOrThrow({ where: { id: inv.id } });
      if (current.status !== 'WITHDRAWN') {
        throw conflict('INVITATION_FINAL', `Приглашение уже в статусе «${STATUS_TEXT[current.status]}» — отзыв невозможен`, { status: current.status });
      }
    } else {
      await this.audit.record({ actorUserId: userId, action: 'invitation.withdrawn', objectType: 'Invitation', objectId: inv.id, requestId });
    }
    return this.employerView(company, inv.id);
  }

  // ───────────────────────────── Кандидат ─────────────────────────────

  async listForCandidate(candidateId: string, status: string | undefined, page: number, pageSize: number) {
    await this.expireStale({ candidateId });
    const where: Prisma.InvitationWhereInput = {
      candidateId,
      ...(status === 'ACTIVE' ? { status: { in: ACTIVE } } : status ? { status: status as InvitationStatus } : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.invitation.count({ where }),
      this.prisma.invitation.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    return { page, pageSize, total, items: items.map((inv) => this.baseView(inv)) };
  }

  async candidateView(candidateId: string, invitationId: string) {
    await this.expireStale({ candidateId, ids: [invitationId] });
    const inv = await this.prisma.invitation.findFirst({
      where: { id: invitationId, candidateId },
      include: { events: { orderBy: { occurredAt: 'asc' } } },
    });
    if (!inv) throw notFound('INVITATION_NOT_FOUND', 'Приглашение не найдено');
    const profile = await this.prisma.candidateProfile.findUniqueOrThrow({ where: { id: candidateId } });
    const grant = await this.prisma.contactAccessGrant.findUnique({ where: { candidateId_companyId: { candidateId, companyId: inv.companyId } } });
    const channels = usableContactChannels(profile);
    const valueOf = (c: string) => (c === 'EMAIL' ? profile.contactEmail : c === 'PHONE' ? profile.phone : profile.messenger);
    return {
      ...this.baseView(inv),
      description: inv.description,
      employerContactType: inv.employerContactType,
      employerContact: inv.employerContact,
      company: inv.companySnapshot as unknown as CompanySnapshot,
      companyVerified: false,
      events: [...inv.events].sort(compareInvitationEvents).map((e) => ({ fromStatus: e.fromStatus, toStatus: e.toStatus, occurredAt: e.occurredAt.toISOString() })),
      /** Что будет раскрыто компании при принятии (текущие выбранные и заполненные каналы). */
      disclosure: {
        fullName: profile.fullName,
        channels: channels.map((c) => ({ channel: c, value: valueOf(c) })),
        alsoShared: ['ФИО', 'ссылки на портфолио', 'описание опыта', 'названия мероприятий ФСП'],
      },
      contactAccess: grant
        ? { active: !grant.revokedAt, grantedAt: grant.grantedAt.toISOString(), revokedAt: grant.revokedAt?.toISOString() ?? null, channels: grant.channels }
        : null,
    };
  }

  /** Явная отметка о просмотре. Открытие списка или prefetch статус не меняют. */
  async markViewed(candidateId: string, userId: string, invitationId: string) {
    const inv = await this.prisma.invitation.findFirst({ where: { id: invitationId, candidateId } });
    if (!inv) throw notFound('INVITATION_NOT_FOUND', 'Приглашение не найдено');
    await this.expireStale({ ids: [inv.id] });
    await this.transition(inv.id, ['SENT'], 'VIEWED', userId, { viewedAt: this.clock.now() });
    return this.candidateView(candidateId, inv.id);
  }

  /**
   * Принятие: проверка адресата, состояния и срока → ACCEPTED + событие → доступ к контактам только для пары
   * кандидат+компания. Повторное принятие идемпотентно и НЕ восстанавливает отозванный доступ.
   */
  async accept(candidateId: string, userId: string, invitationId: string, requestId: string) {
    const inv = await this.prisma.invitation.findFirst({ where: { id: invitationId, candidateId } });
    if (!inv) throw notFound('INVITATION_NOT_FOUND', 'Приглашение не найдено');
    await this.expireStale({ ids: [inv.id] });
    const fresh = await this.prisma.invitation.findUniqueOrThrow({ where: { id: inv.id } });
    if (fresh.status === 'ACCEPTED') return this.candidateView(candidateId, inv.id);
    if (fresh.status === 'EXPIRED') throw conflict('INVITATION_EXPIRED', 'Срок действия приглашения истёк');
    if (!ACTIVE.includes(fresh.status)) {
      throw conflict('INVITATION_FINAL', `Приглашение уже в статусе «${STATUS_TEXT[fresh.status]}»`, { status: fresh.status });
    }
    const profile = await this.prisma.candidateProfile.findUniqueOrThrow({ where: { id: candidateId } });
    const channels = usableContactChannels(profile) as ContactChannel[];
    if (channels.length === 0) {
      throw conflict('NO_CONTACT_CHANNEL', 'Выберите и заполните хотя бы один канал связи в настройках приватности, чтобы принять приглашение');
    }
    const now = this.clock.now();
    const accepted = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.invitation.updateMany({
        where: { id: inv.id, candidateId, status: { in: ACTIVE }, expiresAt: { gt: now } },
        data: { status: 'ACCEPTED', respondedAt: now },
      });
      if (updated.count === 0) return false;
      await tx.invitationEvent.create({
        data: { invitationId: inv.id, actorUserId: userId, fromStatus: fresh.status, toStatus: 'ACCEPTED', occurredAt: now, metadata: { channels } },
      });
      await tx.contactAccessGrant.upsert({
        where: { candidateId_companyId: { candidateId, companyId: inv.companyId } },
        create: { candidateId, companyId: inv.companyId, channels, grantedAt: now, sourceInvitationId: inv.id },
        update: { channels, grantedAt: now, revokedAt: null, sourceInvitationId: inv.id },
      });
      await this.audit.recordTx(tx, {
        actorUserId: userId,
        action: 'invitation.accepted',
        objectType: 'Invitation',
        objectId: inv.id,
        requestId,
        metadata: { companyId: inv.companyId, channels },
      });
      return true;
    });
    if (!accepted) {
      const current = await this.prisma.invitation.findUniqueOrThrow({ where: { id: inv.id } });
      if (current.status !== 'ACCEPTED') {
        throw conflict('INVITATION_FINAL', `Приглашение уже в статусе «${STATUS_TEXT[current.status]}»`, { status: current.status });
      }
    }
    return this.candidateView(candidateId, inv.id);
  }

  async decline(candidateId: string, userId: string, invitationId: string, reason: string | undefined, requestId: string) {
    const inv = await this.prisma.invitation.findFirst({ where: { id: invitationId, candidateId } });
    if (!inv) throw notFound('INVITATION_NOT_FOUND', 'Приглашение не найдено');
    await this.expireStale({ ids: [inv.id] });
    const changed = await this.transition(inv.id, ACTIVE, 'DECLINED', userId, { respondedAt: this.clock.now() }, { reason: reason ?? null });
    if (!changed) {
      const current = await this.prisma.invitation.findUniqueOrThrow({ where: { id: inv.id } });
      if (current.status !== 'DECLINED') {
        throw conflict('INVITATION_FINAL', `Приглашение уже в статусе «${STATUS_TEXT[current.status]}»`, { status: current.status });
      }
    } else {
      await this.audit.record({ actorUserId: userId, action: 'invitation.declined', objectType: 'Invitation', objectId: inv.id, requestId, metadata: { reason: reason ?? null } });
    }
    return this.candidateView(candidateId, inv.id);
  }

  // ───────────────────────────── Доступ к контактам ─────────────────────────────

  async contactAccess(candidateId: string) {
    const grants = await this.prisma.contactAccessGrant.findMany({
      where: { candidateId },
      include: { company: { select: { name: true } } },
      orderBy: { grantedAt: 'desc' },
    });
    return grants.map((g) => ({
      companyId: g.companyId,
      companyName: g.company.name,
      channels: g.channels,
      grantedAt: g.grantedAt.toISOString(),
      revokedAt: g.revokedAt?.toISOString() ?? null,
      active: !g.revokedAt,
      sourceInvitationId: g.sourceInvitationId,
      sourceApplicationId: g.sourceApplicationId,
    }));
  }

  /** Отзыв дальнейшего доступа: исторический ACCEPTED не меняется, новые ответы API и PDF контактов не содержат. */
  async revokeAccess(candidateId: string, userId: string, companyId: string, requestId: string) {
    const grant = await this.prisma.contactAccessGrant.findUnique({ where: { candidateId_companyId: { candidateId, companyId } } });
    if (!grant) throw notFound('GRANT_NOT_FOUND', 'Доступ этой компании не выдавался');
    if (!grant.revokedAt) {
      await this.prisma.contactAccessGrant.updateMany({ where: { id: grant.id, revokedAt: null }, data: { revokedAt: this.clock.now() } });
      await this.audit.record({ actorUserId: userId, action: 'contact_access.revoked', objectType: 'ContactAccessGrant', objectId: grant.id, requestId, metadata: { companyId } });
    }
    return this.contactAccess(candidateId);
  }

  // ───────────────────────────── Вспомогательное ─────────────────────────────

  private baseView(inv: Invitation) {
    const snapshot = inv.companySnapshot as unknown as CompanySnapshot;
    return {
      id: inv.id,
      status: inv.status,
      title: inv.title,
      companyName: snapshot.name,
      companyIndustry: snapshot.industryTitle,
      salaryFrom: inv.salaryFrom,
      salaryTo: inv.salaryTo,
      salaryType: 'GROSS' as const,
      workFormat: inv.workFormat,
      createdAt: inv.createdAt.toISOString(),
      expiresAt: inv.expiresAt.toISOString(),
      viewedAt: inv.viewedAt?.toISOString() ?? null,
      respondedAt: inv.respondedAt?.toISOString() ?? null,
    };
  }

  /** Условный переход: применяется, только если текущий статус входит в from. Возвращает, был ли переход. */
  private async transition(
    invitationId: string,
    from: InvitationStatus[],
    to: InvitationStatusCode,
    actorUserId: string | null,
    data: Prisma.InvitationUpdateManyMutationInput = {},
    metadata?: Prisma.InputJsonValue,
  ): Promise<boolean> {
    const now = this.clock.now();
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.invitation.findUnique({ where: { id: invitationId }, select: { status: true } });
      const updated = await tx.invitation.updateMany({
        where: { id: invitationId, status: { in: from }, ...(to === 'EXPIRED' ? {} : { expiresAt: { gt: now } }) },
        data: { ...data, status: to },
      });
      if (updated.count === 0) return false;
      await tx.invitationEvent.create({
        data: { invitationId, actorUserId, fromStatus: before?.status ?? null, toStatus: to, occurredAt: now, metadata },
      });
      return true;
    });
  }

  /** Ленивое истечение: сервер — источник истины, браузерный таймер не используется. */
  async expireStale(scope: { companyId?: string; candidateId?: string; ids?: string[] }) {
    const now = this.clock.now();
    const stale = await this.prisma.invitation.findMany({
      where: {
        status: { in: ACTIVE_INVITATION_STATUSES as InvitationStatus[] },
        expiresAt: { lte: now },
        ...(scope.companyId ? { companyId: scope.companyId } : {}),
        ...(scope.candidateId ? { candidateId: scope.candidateId } : {}),
        ...(scope.ids ? { id: { in: scope.ids } } : {}),
      },
      select: { id: true },
    });
    for (const inv of stale) await this.expireOne(inv.id);
  }

  private async expireOne(invitationId: string) {
    await this.prisma.$transaction(async (tx: Tx) => {
      const before = await tx.invitation.findUnique({ where: { id: invitationId }, select: { status: true } });
      const updated = await tx.invitation.updateMany({
        where: { id: invitationId, status: { in: ACTIVE }, expiresAt: { lte: this.clock.now() } },
        data: { status: 'EXPIRED' },
      });
      if (updated.count) {
        await tx.invitationEvent.create({
          data: { invitationId, actorUserId: null, fromStatus: before?.status ?? null, toStatus: 'EXPIRED', occurredAt: this.clock.now() },
        });
      }
    });
  }
}

const STATUS_TEXT: Record<InvitationStatus, string> = {
  SENT: 'Отправлено',
  VIEWED: 'Просмотрено',
  ACCEPTED: 'Принято',
  DECLINED: 'Отклонено',
  WITHDRAWN: 'Отозвано',
  EXPIRED: 'Истёк срок',
};
