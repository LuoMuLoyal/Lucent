import { HttpException, Injectable } from '@nestjs/common';
import { getActiveTraceIds } from '../../logger/trace-context.utils';
import { ProblemCatalog, type ProblemCode } from '../problem-catalog';
import type { SseErrorStatus, SseProblemDetails } from '../problem-details';

export interface SseProblemDetailsOptions {
  lang: string;
  code?: string;
  status?: SseErrorStatus;
}

interface SseHttpErrorResponse {
  title?: unknown;
  detail?: unknown;
  code?: unknown;
  message?: unknown;
  error?: unknown;
  retryable?: unknown;
  retryAfter?: unknown;
  traceId?: unknown;
}

@Injectable()
export class SseProblemDetailsMapper {
  constructor(private readonly catalog: ProblemCatalog) {}

  build(error: unknown, options: SseProblemDetailsOptions): SseProblemDetails {
    const response =
      error instanceof HttpException ? error.getResponse() : undefined;
    const raw = this.isRecord(response)
      ? (response as SseHttpErrorResponse)
      : {};
    const explicitCode = options.code != null;
    const code = this.resolveCode(
      options.code ?? raw.code,
      error instanceof HttpException ? error.getStatus() : 500,
      explicitCode,
    );
    const title = this.stringValue(raw.title);
    const detail = this.resolveDetail(raw);
    const retryAfter = this.nonNegativeNumber(raw.retryAfter);
    const traceId =
      this.stringValue(raw.traceId) ?? getActiveTraceIds().traceId;
    const base = this.catalog.build(code, {
      lang: options.lang,
      ...(title == null ? {} : { title }),
      ...(detail == null ? {} : { detail }),
      ...(typeof raw.retryable === 'boolean'
        ? { retryable: raw.retryable }
        : {}),
      ...(retryAfter == null ? {} : { retryAfter }),
      ...(traceId == null ? {} : { traceId }),
    });

    return {
      ...base,
      status: options.status ?? this.resolveStatus(error),
    };
  }

  private resolveCode(
    rawCode: unknown,
    statusCode: number,
    explicitCode: boolean,
  ): ProblemCode {
    if (typeof rawCode === 'string') {
      const candidate = rawCode.trim();
      if (explicitCode && this.catalog.isKnown(candidate)) return candidate;
      if (this.catalog.matchesStatus(candidate, statusCode)) return candidate;
    }
    if (statusCode === 401) return 'AUTH_REQUIRED';
    if (statusCode === 403) return 'FORBIDDEN';
    if (statusCode === 404) return 'RESOURCE_NOT_FOUND';
    if (statusCode === 409) return 'RESOURCE_CONFLICT';
    if (statusCode === 429) return 'RATE_LIMITED';
    if (statusCode === 502) return 'DEPENDENCY_BAD_GATEWAY';
    if (statusCode === 503) return 'DEPENDENCY_UNAVAILABLE';
    if (statusCode === 504) return 'DEPENDENCY_TIMEOUT';
    if (statusCode >= 500) return 'INTERNAL_ERROR';
    return 'VALIDATION_FAILED';
  }

  private resolveStatus(error: unknown): SseErrorStatus {
    if (error instanceof HttpException) {
      return error.getStatus() >= 500 ? 'server_error' : 'client_error';
    }
    return 'server_error';
  }

  private resolveDetail(raw: SseHttpErrorResponse): string | undefined {
    for (const candidate of [raw.detail, raw.message, raw.error]) {
      if (typeof candidate !== 'string' || candidate.trim().length === 0) {
        continue;
      }
      if (!this.isGenericMessage(candidate)) return candidate;
    }
    return undefined;
  }

  private isGenericMessage(message: string): boolean {
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
}
