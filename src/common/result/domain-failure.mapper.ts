import type { ProblemCatalog } from '../api/problem-catalog';
import type { ProblemDetails } from '../api/problem-details';
import { isDomainFailure, type DomainFailure } from './domain-failure';
import { DomainFailureException } from './domain-failure.exception';

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
    throw new DomainFailureException({
      _tag: 'DomainFailure',
      kind: 'internal',
      code: 'INTERNAL_ERROR',
      detail: 'Invalid or undocumented DomainFailure code',
      cause: failure,
    });
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
