import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { forbidden } from '../../common/errors';
import type { AppRequest } from '../../common/request-context';
import { APP_ENV, type AppEnv } from '../../config/env';
import { isValidCsrfToken, safeEqual } from './crypto';
import { CSRF_COOKIE, CSRF_HEADER } from './session.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Защита изменяющих запросов: проверка Origin/Referer и signed double-submit CSRF-токена.
 * Вместе с SameSite=Lax для cookie сессии закрывает межсайтовую подделку запросов.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AppRequest>();
    if (SAFE_METHODS.has(req.method)) return true;

    const origin = req.header('origin');
    if (origin) {
      if (origin !== this.env.APP_ORIGIN) throw forbidden('CSRF_ORIGIN_MISMATCH', 'Запрос отправлен с недоверенного источника');
    } else {
      const referer = req.header('referer');
      if (referer && this.originOf(referer) !== this.env.APP_ORIGIN) {
        throw forbidden('CSRF_ORIGIN_MISMATCH', 'Запрос отправлен с недоверенного источника');
      }
    }

    const headerToken = req.header(CSRF_HEADER);
    const cookieToken: unknown = req.cookies?.[CSRF_COOKIE];
    if (
      !headerToken ||
      typeof cookieToken !== 'string' ||
      !safeEqual(headerToken, cookieToken) ||
      !isValidCsrfToken(this.env.SESSION_SECRET, headerToken)
    ) {
      throw forbidden('CSRF_TOKEN_INVALID', 'Сессия формы устарела. Обновите страницу и повторите действие');
    }
    return true;
  }

  private originOf(url: string): string | null {
    try {
      return new URL(url).origin;
    } catch {
      return null;
    }
  }
}
