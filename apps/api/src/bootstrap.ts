import { HttpStatus, type INestApplication, Logger, ValidationPipe, type ValidationError } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { json, type NextFunction, type Response, urlencoded } from 'express';
import helmet from 'helmet';
import { AppError, badRequest, unprocessable } from './common/errors';
import { AppExceptionFilter } from './common/http-exception.filter';
import type { AppRequest } from './common/request-context';
import { noStoreMiddleware, requestIdMiddleware } from './common/request-id.middleware';
import { APP_ENV, type AppEnv } from './config/env';

export const API_PREFIX = 'api/v1';

function flattenValidationErrors(errors: ValidationError[], parent = ''): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const error of errors) {
    const path = parent ? `${parent}.${error.property}` : error.property;
    if (error.constraints) result[path] = Object.values(error.constraints);
    if (error.children?.length) Object.assign(result, flattenValidationErrors(error.children, path));
  }
  return result;
}

/**
 * Ошибки разбора тела запроса (body-parser) приводятся к единому формату ошибок до того, как Nest превратит
 * SyntaxError в общий BadRequestException с внутренним текстом парсера.
 */
function bodyParserErrors(error: unknown, _req: unknown, _res: unknown, next: NextFunction): void {
  const type = (error as { type?: string } | null)?.type;
  if (type === 'entity.parse.failed') return next(badRequest('MALFORMED_JSON', 'Тело запроса не является корректным JSON'));
  if (type === 'entity.too.large') return next(new AppError(HttpStatus.PAYLOAD_TOO_LARGE, 'PAYLOAD_TOO_LARGE', 'Слишком большой запрос'));
  if (type === 'encoding.unsupported' || type === 'charset.unsupported') {
    return next(new AppError(HttpStatus.UNSUPPORTED_MEDIA_TYPE, 'UNSUPPORTED_MEDIA_TYPE', 'Неподдерживаемая кодировка запроса'));
  }
  next(error);
}

/** Общая настройка приложения: используется в main.ts, интеграционных тестах и экспорте OpenAPI. */
export function configureApp(app: NestExpressApplication): void {
  const env = app.get<AppEnv>(APP_ENV);
  app.set('trust proxy', env.TRUST_PROXY.split(',').map((value) => value.trim()));
  app.disable('x-powered-by');
  app.setGlobalPrefix(API_PREFIX);
  app.use(requestIdMiddleware);
  // API отдаёт только JSON и PDF; CSP для HTML-страниц задаёт веб-приложение.
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-origin' } }));
  app.use(json({ limit: '256kb' }));
  app.use(urlencoded({ extended: false, limit: '64kb' }));
  app.use(bodyParserErrors);
  app.use(cookieParser());
  app.use(`/${API_PREFIX}`, noStoreMiddleware);
  app.use(`/${API_PREFIX}`, requestLogger());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      exceptionFactory: (errors) =>
        unprocessable('VALIDATION_FAILED', 'Проверьте введённые данные', { fields: flattenValidationErrors(errors) }),
    }),
  );
  app.useGlobalFilters(new AppExceptionFilter());
  app.enableShutdownHooks();
}

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('ФСП Таланты — API платформы обратного подбора')
    .setDescription(
      [
        'REST API MVP. Аутентификация — серверная сессия в HttpOnly cookie `fsp_session`.',
        'Изменяющие запросы требуют заголовок `X-CSRF-Token` со значением cookie `fsp_csrf` (выдаётся `GET /auth/csrf`).',
        'Формат ошибок: `{ code, message, details?, requestId }`. Коды: 400/422 — некорректный ввод, 401 — нет сессии,',
        '403 — запрещено для роли, 404 — объект не найден или недоступен, 409 — конфликт состояния, 429 — ограничение частоты.',
      ].join('\n'),
    )
    .setVersion('1.0.0')
    .addCookieAuth('fsp_session')
    .addServer('/')
    .build();
  return SwaggerModule.createDocument(app, config, {
    operationIdFactory: (controllerKey: string, methodKey: string) => `${controllerKey.replace(/Controller$/, '')}_${methodKey}`,
  });
}

export function setupSwagger(app: NestExpressApplication): void {
  const env = app.get<AppEnv>(APP_ENV);
  if (!env.SWAGGER_ENABLED) return;
  SwaggerModule.setup('api/docs', app, () => buildOpenApiDocument(app), {
    jsonDocumentUrl: 'api/docs/openapi.json',
    swaggerOptions: { withCredentials: true },
  });
}

/** Журнал запросов без тел, cookie и персональных данных. */
function requestLogger() {
  const logger = new Logger('HTTP');
  return (req: AppRequest, res: Response, next: NextFunction) => {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      const user = req.auth ? ` user=${req.auth.userId}` : '';
      logger.log(`${req.method} ${req.baseUrl}${req.path} ${res.statusCode} ${ms.toFixed(1)}ms rid=${req.requestId}${user}`);
    });
    next();
  };
}
