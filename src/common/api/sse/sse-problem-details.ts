import { HttpException, Injectable } from '@nestjs/common';
import { ProblemCatalog, type ProblemCode } from '../problem-catalog.js';
import type { SseErrorStatus, SseProblemDetails } from '../problem-details.js';
import { DomainFailureException } from '../../result/domain-failure.exception.js';
import {
  isDomainFailure,
  type DomainFailure,
  type DomainFailureKind,
} from '../../result/index.js';

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
}

/**
 * Builds the safe Problem Details payload of an SSE `event: error` frame.
 *
 * After the SSE headers are sent the HTTP status is fixed, so this mapper
 * never re-sends an HTTP status code. Only the stable, client-contract fields
 * are emitted: type, title, detail, code, optional retryable/retryAfter, and
 * `status` (the stream termination reason). Internal fields such as HTTP
 * statusCode, traceId, cause and stack never leave this boundary.
 *
 * Expected business failures arrive either as a `DomainFailure` (from a
 * `ResultAsync` Err) or as a `DomainFailureException` (from an internal
 * `unwrapResult` fold / transport bridge). Unknown exceptions are mapped to a
 * safe `INTERNAL_ERROR`/`server_error` payload, never to raw error text.
 */
@Injectable()
export class SseProblemDetailsMapper {
  constructor(private readonly catalog: ProblemCatalog) {}

  build(error: unknown, options: SseProblemDetailsOptions): SseProblemDetails {
    if (error instanceof DomainFailureException) {
      return this.buildFromFailure(error.failure, options);
    }
    if (isDomainFailure(error)) {
      return this.buildFromFailure(error, options);
    }

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
    const base = this.catalog.build(code, {
      lang: options.lang,
      ...(title == null ? {} : { title }),
      ...(detail == null ? {} : { detail }),
      ...(typeof raw.retryable === 'boolean'
        ? { retryable: raw.retryable }
        : {}),
      ...(retryAfter == null ? {} : { retryAfter }),
    });

    return {
      ...base,
      status: options.status ?? this.resolveStatus(error),
    };
  }

  private buildFromFailure(
    failure: DomainFailure,
    options: SseProblemDetailsOptions,
  ): SseProblemDetails {
    const base = this.catalog.build(failure.code, {
      lang: options.lang,
      ...(failure.detail == null ? {} : { detail: failure.detail }),
      ...(failure.args == null ? {} : { args: { ...failure.args } }),
      ...(failure.retryable == null ? {} : { retryable: failure.retryable }),
      ...(failure.retryAfter == null ? {} : { retryAfter: failure.retryAfter }),
    });

    return {
      ...base,
      status: options.status ?? this.statusForKind(failure.kind),
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

  private statusForKind(kind: DomainFailureKind): SseErrorStatus {
    return kind === 'dependency' || kind === 'internal'
      ? 'server_error'
      : 'client_error';
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
