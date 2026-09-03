import { createDomainFailure, type DomainFailure } from './domain-failure.js';
import { DomainFailureException } from './domain-failure.exception.js';

/**
 * Maps an unknown error to a `DomainFailure` without losing the original cause.
 * If the error is already a `DomainFailureException`, its wrapped failure is
 * returned unchanged so that imperative "throw to short-circuit" patterns keep
 * working when lifted into a `ResultAsync`.
 */
export function mapUnknownToInternalFailure(
  error: unknown,
  context?: string,
): DomainFailure {
  if (error instanceof DomainFailureException) {
    return error.failure;
  }
  return createDomainFailure({
    kind: 'internal',
    code: 'INTERNAL_ERROR',
    ...(context ? { detail: context } : {}),
    cause: error,
  });
}

/**
 * Same as {@link mapUnknownToInternalFailure} but categorizes the failure as a
 * dependency outage (503, retryable). Use this for DB/network/infra failures
 * where the caller should treat the operation as externally unavailable.
 */
export function mapUnknownToDependencyFailure(
  error: unknown,
  context?: string,
): DomainFailure {
  if (error instanceof DomainFailureException) {
    return error.failure;
  }
  return createDomainFailure({
    kind: 'dependency',
    code: 'DEPENDENCY_UNAVAILABLE',
    ...(context ? { detail: context } : {}),
    cause: error,
  });
}
