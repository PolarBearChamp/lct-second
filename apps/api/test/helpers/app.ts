import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { Clock, FakeClock } from '../../src/common/clock';
import { RateLimitService } from '../../src/common/rate-limit.service';
import { FSP_PROVIDER } from '../../src/modules/fsp/fsp-provider';
import { MailService } from '../../src/modules/mail/mail.service';
import { PrismaService } from '../../src/prisma/prisma.service';

/** Перехват исходящих писем: интеграционные тесты не ходят в SMTP. */
export class MailCapture {
  readonly sent: Array<{ to: string; token: string }> = [];

  async sendEmailVerification(to: string, token: string): Promise<void> {
    this.sent.push({ to, token });
  }

  async send(): Promise<void> {
    /* письма общего вида в тестах не нужны */
  }

  tokenFor(email: string): string {
    const mail = [...this.sent].reverse().find((m) => m.to.toLowerCase() === email.toLowerCase());
    if (!mail) throw new Error(`Письмо для ${email} не отправлялось`);
    return mail.token;
  }
}

export interface TestContext {
  app: NestExpressApplication;
  clock: FakeClock;
  mail: MailCapture;
  prisma: PrismaService;
  close: () => Promise<void>;
}

export const START = new Date('2026-10-05T09:00:00.000Z');

/** Приложение целиком (все модули, guards, фильтры, валидация) на тестовой БД с управляемыми часами. */
export async function createTestApp(options: { realRateLimit?: boolean; fspProvider?: unknown } = {}): Promise<TestContext> {
  const clock = new FakeClock(START);
  const mail = new MailCapture();
  let builder = Test.createTestingModule({ imports: [AppModule] }).overrideProvider(Clock).useValue(clock).overrideProvider(MailService).useValue(mail);
  if (!options.realRateLimit) builder = builder.overrideProvider(RateLimitService).useValue({ consume: () => undefined, reset: () => undefined });
  if (options.fspProvider) builder = builder.overrideProvider(FSP_PROVIDER).useValue(options.fspProvider);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  await app.init();
  const prisma = app.get(PrismaService);
  await resetDatabase(prisma);
  clock.set(START);
  return { app, clock, mail, prisma, close: () => app.close() };
}

/** Очищает пользовательские данные; справочники (специализации, навыки) сохраняются. */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe('TRUNCATE "User", "FspLinkCodeRedemption", "AuditEvent" CASCADE');
}
