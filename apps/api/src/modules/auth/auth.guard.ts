import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { forbidden, unauthorized } from '../../common/errors';
import type { AppRequest } from '../../common/request-context';
import type { Role } from '../../generated/prisma/client';
import { ALLOW_UNVERIFIED, IS_PUBLIC, ROLES } from './decorators';
import { SessionService } from './session.service';

/**
 * Глобальная проверка сессии, подтверждения email и роли.
 * Клиентское скрытие меню не заменяет эту проверку: каждый маршрут API защищён здесь.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AppRequest>();
    const targets = [context.getHandler(), context.getClass()];

    const token: unknown = req.cookies?.[this.sessions.cookieName];
    if (typeof token === 'string' && token) {
      const session = await this.sessions.resolve(token);
      if (session) {
        req.auth = {
          userId: session.userId,
          sessionId: session.id,
          role: session.user.role,
          emailVerified: Boolean(session.user.emailVerifiedAt),
          isDemo: session.user.isDemo,
        };
      }
    }

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    if (!req.auth) throw unauthorized();

    if (!req.auth.emailVerified && !this.reflector.getAllAndOverride<boolean>(ALLOW_UNVERIFIED, targets)) {
      throw forbidden('EMAIL_NOT_VERIFIED', 'Подтвердите адрес электронной почты, чтобы продолжить');
    }

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, targets);
    if (roles?.length && !roles.includes(req.auth.role)) {
      throw forbidden('FORBIDDEN_ROLE', 'Раздел недоступен для вашей роли');
    }
    return true;
  }
}
