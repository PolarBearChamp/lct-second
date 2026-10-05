import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { AppError, isUniqueViolation } from './errors';
import type { AppRequest } from './request-context';

interface ErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  requestId: string;
}

const STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'VALIDATION_FAILED',
  429: 'RATE_LIMITED',
};

const DEFAULT_MESSAGES: Record<number, string> = {
  400: 'Некорректный запрос',
  401: 'Требуется вход в систему',
  403: 'Недостаточно прав',
  404: 'Объект не найден или недоступен',
  409: 'Конфликт состояния',
  413: 'Слишком большой запрос',
  415: 'Неподдерживаемый формат запроса',
  422: 'Проверьте введённые данные',
  429: 'Слишком много запросов',
};

/**
 * Единый формат ошибок `{ code, message, details?, requestId }`.
 * Stack trace, тексты исключений БД и персональные данные наружу не передаются.
 */
@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<AppRequest>();
    const res = http.getResponse<Response>();
    const requestId = req.requestId ?? 'unknown';

    const { status, body, headers } = this.toResponse(exception, requestId);
    if (status >= 500) {
      this.logger.error(
        `${req.method} ${req.path} -> ${status} [${requestId}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }
    if (res.headersSent) return;
    for (const [name, value] of Object.entries(headers ?? {})) res.setHeader(name, value);
    res.setHeader('Cache-Control', 'private, no-store');
    res.status(status).json(body);
  }

  private toResponse(exception: unknown, requestId: string): {
    status: number;
    body: ErrorBody;
    headers?: Record<string, string>;
  } {
    if (exception instanceof AppError) {
      return {
        status: exception.status,
        body: { code: exception.code, message: exception.message, details: exception.details, requestId },
        headers: exception.headers,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const message =
        status < 500 && typeof response === 'object' && response && 'message' in response && typeof response.message === 'string'
          ? response.message
          : DEFAULT_MESSAGES[status] ?? 'Ошибка запроса';
      return {
        status,
        body: { code: STATUS_CODES[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'HTTP_ERROR'), message, requestId },
      };
    }

    // Ошибки body-parser (некорректный JSON, слишком большое тело).
    if (exception && typeof exception === 'object' && 'type' in exception && 'status' in exception) {
      const typed = exception as { type?: string; status?: number };
      if (typed.type === 'entity.parse.failed') {
        return { status: 400, body: { code: 'MALFORMED_JSON', message: 'Тело запроса не является корректным JSON', requestId } };
      }
      if (typed.type === 'entity.too.large') {
        return { status: 413, body: { code: 'PAYLOAD_TOO_LARGE', message: DEFAULT_MESSAGES[413], requestId } };
      }
    }

    if (isUniqueViolation(exception)) {
      return { status: HttpStatus.CONFLICT, body: { code: 'CONFLICT', message: 'Объект уже существует или изменён параллельно', requestId } };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: { code: 'INTERNAL_ERROR', message: 'Внутренняя ошибка сервера. Попробуйте позже.', requestId },
    };
  }
}
