import { Injectable, Logger } from '@nestjs/common';
import { Clock } from '../../common/clock';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService, type Tx } from '../../prisma/prisma.service';

export interface AuditInput {
  actorUserId?: string | null;
  action: string;
  objectType: string;
  objectId?: string | null;
  requestId?: string | null;
  /** Только безопасные метаданные: идентификаторы, статусы, версии. Без ФИО, email, телефонов. */
  metadata?: Prisma.InputJsonValue;
}

/** Журнал значимых действий. Ошибка записи аудита не прерывает бизнес-операцию вне транзакции. */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  /** Запись в рамках транзакции бизнес-операции. */
  async recordTx(tx: Tx, input: AuditInput): Promise<void> {
    await tx.auditEvent.create({ data: this.toData(input) });
  }

  async record(input: AuditInput): Promise<void> {
    try {
      await this.prisma.auditEvent.create({ data: this.toData(input) });
    } catch (error) {
      this.logger.warn(`Не удалось записать событие аудита ${input.action}: ${(error as Error).message}`);
    }
  }

  private toData(input: AuditInput): Prisma.AuditEventUncheckedCreateInput {
    return {
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      objectType: input.objectType,
      objectId: input.objectId ?? null,
      requestId: input.requestId ?? null,
      metadata: input.metadata,
      occurredAt: this.clock.now(),
    };
  }
}
