import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { ResultCode } from '../api/result-code';
import {
  buildProblemDetails,
  problemTypeForCode,
  titleForStatus,
  type ProblemDetails,
} from '../api/problem-details';
import { getActiveTraceIds } from '../logger/trace-context.utils';

const LEGACY_RESULT_CODE_MAP: Readonly<Record<number, string>> = {
  [ResultCode.BAD_REQUEST]: 'BAD_REQUEST',
  [ResultCode.VALIDATION_FAILED]: 'VALIDATION_FAILED',
  [ResultCode.UNAUTHORIZED]: 'AUTH_UNAUTHORIZED',
  [ResultCode.TOKEN_EXPIRED]: 'AUTH_TOKEN_EXPIRED',
  [ResultCode.REFRESH_TOKEN_INVALID]: 'AUTH_REFRESH_TOKEN_INVALID',
  [ResultCode.LOGIN_RATE_LIMITED]: 'AUTH_LOGIN_RATE_LIMITED',
  [ResultCode.WRONG_PASSWORD]: 'AUTH_WRONG_PASSWORD',
  [ResultCode.FORBIDDEN]: 'AUTH_FORBIDDEN',
  [ResultCode.NOT_FOUND]: 'RESOURCE_NOT_FOUND',
  [ResultCode.CONFLICT]: 'CONFLICT',
  [ResultCode.INTERNAL_ERROR]: 'INTERNAL_ERROR',
  [ResultCode.DATABASE_ERROR]: 'DATABASE_ERROR',
  [ResultCode.EXTERNAL_SERVICE_ERROR]: 'EXTERNAL_SERVICE_ERROR',
};

interface HttpErrorResponse {
  type?: unknown;
  title?: unknown;
  detail?: unknown;
  code?: unknown;
  message?: unknown;
  error?: unknown;
  errors?: unknown;
  retryable?: unknown;
  retryAfter?: unknown;
  traceId?: unknown;
}

/** Converts thrown Nest errors into RFC 9457 Problem Details. */
@Catch()
@Injectable()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();
    const status = this.resolveStatus(exception);
    const body = this.resolveBody(exception, status);

    this.logException(exception, request, status, body.detail);

    response.status(status).type('application/problem+json').send(body);
  }

  private resolveStatus(exception: unknown): number {
    if (exception instanceof HttpException) {
      return exception.getStatus();
    }
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private resolveBody(exception: unknown, status: number): ProblemDetails {
    const traceId = getActiveTraceIds().traceId;
    if (!(exception instanceof HttpException)) {
      return buildProblemDetails({
        status,
        code: 'INTERNAL_ERROR',
        title: 'Internal server error',
        detail: 'Internal server error',
        ...(traceId == null ? {} : { traceId }),
      });
    }

    const response = exception.getResponse();
    const raw = response as HttpErrorResponse | undefined;
    const code = this.resolveCode(raw?.code, status);
    const message = raw?.message ?? raw?.detail ?? raw?.error;
    const validationErrors = this.resolveErrors(raw?.errors, message);
    const detail = this.resolveDetail(message, status);
    const explicitType = this.stringValue(raw?.type);
    const explicitTitle = this.stringValue(raw?.title);
    const retryable =
      typeof raw?.retryable === 'boolean' ? raw.retryable : undefined;
    const retryAfter = this.nonNegativeNumber(raw?.retryAfter);
    const responseTraceId = this.stringValue(raw?.traceId);

    return buildProblemDetails({
      status,
      code,
      type: explicitType ?? problemTypeForCode(code),
      title: explicitTitle ?? titleForStatus(status),
      detail,
      ...(validationErrors == null ? {} : { errors: validationErrors }),
      ...(retryable == null ? {} : { retryable }),
      ...(retryAfter == null ? {} : { retryAfter }),
      ...((responseTraceId ?? traceId) == null
        ? {}
        : { traceId: responseTraceId ?? traceId }),
    });
  }

  private resolveCode(rawCode: unknown, status: number): string {
    if (typeof rawCode === 'string' && rawCode.trim().length > 0) {
      return rawCode.trim();
    }
    if (typeof rawCode === 'number') {
      const mapped = LEGACY_RESULT_CODE_MAP[rawCode];
      if (mapped != null) return mapped;
    }
    return this.defaultCode(status);
  }

  private defaultCode(status: number): string {
    switch (status) {
      case 400:
        return 'BAD_REQUEST';
      case 401:
        return 'AUTH_UNAUTHORIZED';
      case 403:
        return 'AUTH_FORBIDDEN';
      case 404:
        return 'RESOURCE_NOT_FOUND';
      case 409:
        return 'CONFLICT';
      case 429:
        return 'RATE_LIMITED';
      default:
        return 'INTERNAL_ERROR';
    }
  }

  private resolveDetail(message: unknown, status: number): string {
    if (Array.isArray(message)) {
      return 'Request validation failed';
    }
    if (typeof message === 'string' && message.trim().length > 0) {
      return message;
    }
    return status >= 500 ? 'Internal server error' : 'Request failed';
  }

  private resolveErrors(
    rawErrors: unknown,
    message: unknown,
  ): Record<string, unknown> | undefined {
    if (this.isRecord(rawErrors)) return rawErrors;
    if (Array.isArray(message)) {
      return {
        general: message.filter(
          (item): item is string => typeof item === 'string',
        ),
      };
    }
    return undefined;
  }

  private stringValue(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : undefined;
  }

  private nonNegativeNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
      ? value
      : undefined;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return value != null && typeof value === 'object' && !Array.isArray(value);
  }

  private logException(
    exception: unknown,
    request: FastifyRequest,
    status: number,
    detail: string,
  ): void {
    const path = request.url;
    if (status >= 500) {
      this.logger.error(
        `Unhandled exception: ${detail} [${request.method} ${path} ${String(status)}]`,
        exception instanceof Error ? exception.stack : undefined,
      );
      return;
    }

    this.logger.warn(
      `Handled exception: ${detail} [${request.method} ${path} ${String(status)}]`,
    );
  }
}
