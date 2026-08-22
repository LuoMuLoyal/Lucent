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
import { I18nContext, I18nService } from 'nestjs-i18n';
import { ProblemCatalog, type ProblemCode } from '../api/problem-catalog';
import type { ProblemDetails } from '../api/problem-details';
import { getActiveTraceIds } from '../logger/trace-context.utils';
import { toProblemDetails } from '../result';
import { DomainFailureException } from '../result/unwrap-result';

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
  private readonly catalog: ProblemCatalog;

  constructor(i18n: I18nService) {
    this.catalog = new ProblemCatalog(i18n);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();
    const status = this.resolveStatus(exception);
    const body = this.resolveBody(exception, status, host);

    this.logException(exception, request, status, body.detail);

    if (body.retryAfter != null) {
      response.header('Retry-After', String(body.retryAfter));
    }
    response.status(status).type('application/problem+json').send(body);
  }

  private resolveStatus(exception: unknown): number {
    if (exception instanceof DomainFailureException) {
      return this.catalog.statusFor(exception.failure.code);
    }
    if (exception instanceof HttpException) {
      return exception.getStatus();
    }
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private resolveBody(
    exception: unknown,
    status: number,
    host: ArgumentsHost,
  ): ProblemDetails {
    const traceId = getActiveTraceIds().traceId;
    const lang = this.resolveLanguage(host);
    if (exception instanceof DomainFailureException) {
      return toProblemDetails(exception.failure, {
        catalog: this.catalog,
        lang,
        ...(traceId == null ? {} : { traceId }),
      });
    }
    if (!(exception instanceof HttpException)) {
      return this.catalog.build('INTERNAL_ERROR', {
        lang,
        ...(traceId == null ? {} : { traceId }),
      });
    }

    const response = exception.getResponse();
    const raw = this.isErrorResponse(response)
      ? response
      : typeof response === 'string'
        ? { message: response }
        : {};
    const code = this.resolveCode(raw.code, status);
    const message = raw.message;
    const validationErrors = this.resolveErrors(raw.errors, message);
    const detail = this.resolveDetail(raw);
    const explicitTitle = this.stringValue(raw.title);
    const retryable =
      typeof raw.retryable === 'boolean' ? raw.retryable : undefined;
    const retryAfter = this.nonNegativeNumber(raw.retryAfter);
    const responseTraceId = this.stringValue(raw.traceId);

    return this.catalog.build(code, {
      lang,
      ...(explicitTitle == null ? {} : { title: explicitTitle }),
      ...(detail == null ? {} : { detail }),
      ...(validationErrors == null ? {} : { errors: validationErrors }),
      ...(retryable == null ? {} : { retryable }),
      ...(retryAfter == null ? {} : { retryAfter }),
      ...((responseTraceId ?? traceId) == null
        ? {}
        : { traceId: responseTraceId ?? traceId }),
    });
  }

  private resolveCode(rawCode: unknown, status: number): ProblemCode {
    if (typeof rawCode === 'string') {
      const candidate = rawCode.trim();
      if (this.catalog.matchesStatus(candidate, status)) return candidate;
    }
    return this.defaultCode(status);
  }

  private defaultCode(status: number): ProblemCode {
    switch (status) {
      case 400:
        return 'VALIDATION_FAILED';
      case 401:
        return 'AUTH_REQUIRED';
      case 403:
        return 'FORBIDDEN';
      case 404:
        return 'RESOURCE_NOT_FOUND';
      case 409:
        return 'RESOURCE_CONFLICT';
      case 429:
        return 'RATE_LIMITED';
      case 502:
        return 'DEPENDENCY_BAD_GATEWAY';
      case 503:
        return 'DEPENDENCY_UNAVAILABLE';
      case 504:
        return 'DEPENDENCY_TIMEOUT';
      default:
        return 'INTERNAL_ERROR';
    }
  }

  private resolveDetail(raw: HttpErrorResponse): string | undefined {
    const candidates = [raw.detail, raw.message, raw.error];
    for (const candidate of candidates) {
      if (typeof candidate !== 'string' || candidate.trim().length === 0) {
        continue;
      }
      if (!this.isGenericNestMessage(candidate)) return candidate;
    }
    return undefined;
  }

  private isGenericNestMessage(message: string): boolean {
    return new Set([
      'Bad Request',
      'Unauthorized',
      'Forbidden',
      'Not Found',
      'Conflict',
      'Too Many Requests',
      'Internal Server Error',
    ]).has(message.trim());
  }

  private resolveLanguage(host: ArgumentsHost): string {
    return (
      I18nContext.current(host)?.lang ?? I18nContext.current()?.lang ?? 'en'
    );
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

  private isErrorResponse(value: unknown): value is HttpErrorResponse {
    return this.isRecord(value);
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
