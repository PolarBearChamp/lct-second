import { Inject, Injectable } from '@nestjs/common';
import type { CookieOptions, Response } from 'express';
import { addHours, Clock } from '../../common/clock';
import { APP_ENV, type AppEnv } from '../../config/env';
import type { Session, User } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { createCsrfToken, generateToken, sha256 } from './crypto';

export const CSRF_COOKIE = 'fsp_csrf';
export const CSRF_HEADER = 'x-csrf-token';
const LAST_USED_UPDATE_INTERVAL_MS = 5 * 60_000;

/**
 * Серверные сессии в PostgreSQL. Клиент хранит только непрозрачный случайный токен в HttpOnly cookie;
 * в БД — SHA-256 токена, срок действия и дата отзыва.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  async create(userId: string): Promise<{ token: string; expiresAt: Date }> {
    const token = generateToken(32);
    const now = this.clock.now();
    const expiresAt = addHours(now, this.env.SESSION_TTL_HOURS);
    await this.prisma.session.create({
      data: { userId, tokenHash: sha256(token), createdAt: now, lastUsedAt: now, expiresAt },
    });
    return { token, expiresAt };
  }

  /** Возвращает действующую сессию: не отозвана и не истекла. */
  async resolve(token: string): Promise<(Session & { user: User }) | null> {
    if (!token || token.length > 128) return null;
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true },
    });
    const now = this.clock.now();
    if (!session || session.revokedAt || session.expiresAt <= now) return null;
    if (now.getTime() - session.lastUsedAt.getTime() > LAST_USED_UPDATE_INTERVAL_MS) {
      await this.prisma.session.update({ where: { id: session.id }, data: { lastUsedAt: now } });
    }
    return session;
  }

  async revoke(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: this.clock.now() },
    });
  }

  private baseCookie(): CookieOptions {
    return {
      path: '/',
      sameSite: 'lax',
      secure: this.env.SESSION_COOKIE_SECURE,
    };
  }

  setSessionCookie(res: Response, token: string, expiresAt: Date): void {
    res.cookie(this.env.SESSION_COOKIE_NAME, token, { ...this.baseCookie(), httpOnly: true, expires: expiresAt });
  }

  clearSessionCookie(res: Response): void {
    res.clearCookie(this.env.SESSION_COOKIE_NAME, { ...this.baseCookie(), httpOnly: true });
  }

  /** Выдаёт CSRF-токен (cookie доступна JS, чтобы клиент продублировал её в заголовке). */
  issueCsrfToken(res: Response): string {
    const token = createCsrfToken(this.env.SESSION_SECRET);
    res.cookie(CSRF_COOKIE, token, { ...this.baseCookie(), httpOnly: false });
    return token;
  }

  get cookieName(): string {
    return this.env.SESSION_COOKIE_NAME;
  }
}
