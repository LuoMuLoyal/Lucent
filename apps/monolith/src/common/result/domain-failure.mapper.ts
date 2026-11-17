import type { ProblemCatalog } from '../api/problem-catalog.js';
import type { ProblemDetails } from '../api/problem-details.js';
import { isDomainFailure, type DomainFailure } from './domain-failure.js';

export interface DomainFailureProblemOptions {
  catalog: ProblemCatalog;
  lang: string;
  traceId?: string;
}

export function toProblemDetails(
  failure: DomainFailure,
  options: DomainFailureProblemOptions,
): ProblemDetails {
  if (!isDomainFailure(failure) || !options.catalog.isKnown(failure.code)) {
    // eslint-disable-next-line error-handling/no-bare-throw-error -- invariant violation in pure helper, not a domain failure path
    throw new Error(
      `Invalid or undocumented DomainFailure code: ${JSON.stringify({ code: failure.code, kind: failure.kind })}`,
    );
  }

  return options.catalog.build(failure.code, {
    lang: options.lang,
    ...(failure.detail == null ? {} : { detail: failure.detail }),
    ...(failure.args == null ? {} : { args: { ...failure.args } }),
    ...(failure.errors == null ? {} : { errors: { ...failure.errors } }),
    ...(failure.retryable == null ? {} : { retryable: failure.retryable }),
    ...(failure.retryAfter == null ? {} : { retryAfter: failure.retryAfter }),
    ...(options.traceId == null ? {} : { traceId: options.traceId }),
  });
}
