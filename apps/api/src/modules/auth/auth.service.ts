import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { addHours, Clock } from '../../common/clock';
import { badRequest, conflict, unauthorized } from '../../common/errors';
import { RATE_LIMITS, RateLimitService } from '../../common/rate-limit.service';
import { APP_ENV, type AppEnv } from '../../config/env';
import { CONSENT_POLICY_VERSIONS } from '../../config/policies';
import type { Role } from '../../generated/prisma/client';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { dummyPasswordHash, generateToken, hashPassword, normalizeEmail, sha256, verifyPassword } from './crypto';
import { SessionService } from './session.service';

export interface RegisterInput {
  email: string;
  password: string;
  role: Role;
  acceptPrivacyPolicy: boolean;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly rateLimit: RateLimitService,
    private readonly clock: Clock,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  async register(input: RegisterInput, ip: string, requestId: string) {
    this.rateLimit.consume(`register:${ip}`, RATE_LIMITS.registerPerIp);
    const normalizedEmail = normalizeEmail(input.email);
    if (input.password.toLowerCase().includes(normalizedEmail.split('@')[0]) && normalizedEmail.split('@')[0].length >= 4) {
      throw badRequest('WEAK_PASSWORD', 'Пароль не должен содержать имя почтового ящика');
    }
    const existing = await this.prisma.user.findUnique({ where: { normalizedEmail } });
    if (existing) throw conflict('EMAIL_ALREADY_REGISTERED', 'Пользователь с таким email уже зарегистрирован');

    const passwordHash = await hashPassword(input.password);
    const now = this.clock.now();
    const verificationToken = generateToken(32);

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { email: input.email.trim(), normalizedEmail, passwordHash, role: input.role, createdAt: now },
      });
      await tx.consentRecord.create({
        data: {
          userId: created.id,
          type: 'DATA_PROCESSING',
          policyVersion: CONSENT_POLICY_VERSIONS.DATA_PROCESSING,
          acceptedAt: now,
        },
      });
      if (input.role === 'CANDIDATE') {
        await tx.candidateProfile.create({
          data: { userId: created.id, alias: await this.uniqueAlias(tx), contactEmail: input.email.trim() },
        });
      }
      await tx.emailVerificationToken.create({
        data: {
          userId: created.id,
          tokenHash: sha256(verificationToken),
          createdAt: now,
          expiresAt: addHours(now, this.env.EMAIL_VERIFICATION_TTL_HOURS),
        },
      });
      await this.audit.recordTx(tx, {
        actorUserId: created.id,
        action: 'auth.registered',
        objectType: 'User',
        objectId: created.id,
        requestId,
        metadata: { role: input.role, privacyPolicyVersion: CONSENT_POLICY_VERSIONS.DATA_PROCESSING },
      });
      return created;
    });

    let verificationEmailSent = true;
    try {
      await this.mail.sendEmailVerification(user.email, verificationToken);
    } catch {
      // Аккаунт создан; письмо можно запросить повторно с экрана подтверждения.
      verificationEmailSent = false;
    }
    const session = await this.sessions.create(user.id);
    return { user, session, verificationEmailSent };
  }

  async login(email: string, password: string, ip: string, requestId: string) {
    const normalizedEmail = normalizeEmail(email);
    this.rateLimit.consume(`login-ip:${ip}`, RATE_LIMITS.loginPerIp);
    this.rateLimit.consume(`login:${ip}:${normalizedEmail}`, RATE_LIMITS.loginPerIpAndEmail);

    const user = await this.prisma.user.findUnique({ where: { normalizedEmail } });
    // Проверка выполняется и для несуществующего пользователя, чтобы время ответа не раскрывало наличие аккаунта.
    const valid = await verifyPassword(user?.passwordHash ?? (await dummyPasswordHash()), password);
    if (!user || !valid) {
      await this.audit.record({ action: 'auth.login_failed', objectType: 'User', objectId: user?.id, requestId });
      throw unauthorized('INVALID_CREDENTIALS', 'Неверный email или пароль');
    }
    this.rateLimit.reset(`login:${ip}:${normalizedEmail}`);
    const session = await this.sessions.create(user.id);
    await this.audit.record({ actorUserId: user.id, action: 'auth.login', objectType: 'User', objectId: user.id, requestId });
    return { user, session };
  }

  async logout(sessionId: string, userId: string, requestId: string): Promise<void> {
    await this.sessions.revoke(sessionId);
    await this.audit.record({ actorUserId: userId, action: 'auth.logout', objectType: 'Session', objectId: sessionId, requestId });
  }

  /** Подтверждение email одноразовым токеном. Выполняется POST-запросом с экрана подтверждения. */
  async verifyEmail(token: string, ip: string, requestId: string): Promise<{ userId: string }> {
    this.rateLimit.consume(`verify:${ip}`, RATE_LIMITS.verifyPerIp);
    const now = this.clock.now();
    return this.prisma.$transaction(async (tx) => {
      const record = await tx.emailVerificationToken.findUnique({ where: { tokenHash: sha256(token) } });
      if (!record || record.expiresAt <= now) {
        throw badRequest('VERIFICATION_TOKEN_INVALID', 'Ссылка подтверждения недействительна или устарела. Запросите новое письмо.');
      }
      if (record.usedAt) {
        const user = await tx.user.findUniqueOrThrow({ where: { id: record.userId } });
        if (user.emailVerifiedAt) return { userId: user.id };
        throw badRequest('VERIFICATION_TOKEN_INVALID', 'Ссылка подтверждения уже использована. Запросите новое письмо.');
      }
      const consumed = await tx.emailVerificationToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: now },
      });
      if (consumed.count === 0) throw conflict('VERIFICATION_TOKEN_USED', 'Ссылка уже использована');
      await tx.user.updateMany({ where: { id: record.userId, emailVerifiedAt: null }, data: { emailVerifiedAt: now } });
      await this.audit.recordTx(tx, {
        actorUserId: record.userId,
        action: 'auth.email_verified',
        objectType: 'User',
        objectId: record.userId,
        requestId,
      });
      return { userId: record.userId };
    });
  }

  async resendVerification(userId: string, requestId: string): Promise<void> {
    this.rateLimit.consume(`resend-short:${userId}`, RATE_LIMITS.resendPerUserShort);
    this.rateLimit.consume(`resend-long:${userId}`, RATE_LIMITS.resendPerUserLong);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.emailVerifiedAt) throw conflict('EMAIL_ALREADY_VERIFIED', 'Адрес электронной почты уже подтверждён');
    const now = this.clock.now();
    const token = generateToken(32);
    await this.prisma.emailVerificationToken.create({
      data: {
        userId,
        tokenHash: sha256(token),
        createdAt: now,
        expiresAt: addHours(now, this.env.EMAIL_VERIFICATION_TTL_HOURS),
      },
    });
    await this.mail.sendEmailVerification(user.email, token);
    await this.audit.record({ actorUserId: userId, action: 'auth.verification_resent', objectType: 'User', objectId: userId, requestId });
  }

  /** Псевдоним вида «A17F» для обезличенной карточки. */
  private async uniqueAlias(tx: Tx): Promise<string> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const alias = randomBytes(attempt < 10 ? 2 : 3).toString('hex').toUpperCase();
      const taken = await tx.candidateProfile.findUnique({ where: { alias } });
      if (!taken) return alias;
    }
    return randomBytes(4).toString('hex').toUpperCase();
  }
}
