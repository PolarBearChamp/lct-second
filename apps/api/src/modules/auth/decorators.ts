import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Role } from '../../generated/prisma/client';
import { unauthorized } from '../../common/errors';
import type { AppRequest, AuthContext } from '../../common/request-context';

export const IS_PUBLIC = 'auth:isPublic';
export const ALLOW_UNVERIFIED = 'auth:allowUnverified';
export const ROLES = 'auth:roles';

/** Маршрут доступен без сессии. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Маршрут доступен пользователю с неподтверждённым email (подтверждение, повторная отправка, выход, /me). */
export const AllowUnverified = () => SetMetadata(ALLOW_UNVERIFIED, true);

/** Маршрут доступен только указанным ролям. Проверка выполняется на backend. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

/** Контекст аутентифицированного пользователя. */
export const CurrentAuth = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthContext => {
  const req = ctx.switchToHttp().getRequest<AppRequest>();
  if (!req.auth) throw unauthorized();
  return req.auth;
});

export const RequestId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  return ctx.switchToHttp().getRequest<AppRequest>().requestId;
});
