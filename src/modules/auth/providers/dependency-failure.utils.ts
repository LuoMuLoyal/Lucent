import { createDomainFailure } from '../../../common/result';
import type { DomainFailure } from '../../../common/result';

/**
 * Shared dependency-failure classification for OAuth providers.
 *
 * Outbound provider calls fail in three distinguishable ways, mapped to
 * existing ProblemCodes:
 * - `DEPENDENCY_TIMEOUT` — the upstream call timed out (TimeoutError/AbortError
 *   or an error message/cause that explicitly reports a timeout).
 * - `DEPENDENCY_UNAVAILABLE` — the upstream could not be reached (network
 *   failure, connection refused, DNS, ...).
 * - `DEPENDENCY_BAD_GATEWAY` — the upstream responded, but with a non-2xx
 *   status or an unusable/rejected payload (token exchange error, malformed
 *   JSON, missing required fields, incomplete profile).
 *
 * Raw upstream responses, tokens and stacks never enter Problem Details:
 * `cause` is only attached for transport errors and is used for logs/OTel.
 */

export function isTimeoutLikeError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'TimeoutError' || error.name === 'AbortError') {
    return true;
  }
  const messages: string[] = [error.message];
  let cause = (error as { cause?: unknown }).cause;
  while (cause instanceof Error && messages.length < 4) {
    messages.push(cause.message);
    cause = (cause as { cause?: unknown }).cause;
  }
  const haystack = messages.join(' ').toLowerCase();
  return haystack.includes('timeout') || haystack.includes('timed out');
}

export function dependencyTimeout(): DomainFailure {
  return createDomainFailure({
    kind: 'dependency',
    code: 'DEPENDENCY_TIMEOUT',
  });
}

export function dependencyUnavailable(cause?: unknown): DomainFailure {
  return createDomainFailure({
    kind: 'dependency',
    code: 'DEPENDENCY_UNAVAILABLE',
    ...(cause !== undefined && { cause }),
  });
}

export function dependencyBadGateway(cause?: unknown): DomainFailure {
  return createDomainFailure({
    kind: 'dependency',
    code: 'DEPENDENCY_BAD_GATEWAY',
    ...(cause !== undefined && { cause }),
  });
}

/** Extracts a numeric HTTP status from an error, when one is attached. */
function httpStatusOf(error: unknown): number | undefined {
  if (!(error instanceof Error)) return undefined;
  const status = (error as { status?: unknown }).status;
  if (
    typeof status === 'number' &&
    Number.isInteger(status) &&
    status >= 100 &&
    status <= 599
  ) {
    return status;
  }
  return undefined;
}

/**
 * Classifies a thrown transport error into a dependency DomainFailure.
 *
 * An error carrying an HTTP status means the upstream responded but with a
 * non-2xx status — that is a `DEPENDENCY_BAD_GATEWAY`, not a connectivity
 * problem. Timeouts (TimeoutError/AbortError or timeout messages) keep their
 * own classification and take precedence over the status.
 */
export function classifyFetchError(error: unknown): DomainFailure {
  if (isTimeoutLikeError(error)) return dependencyTimeout();
  const status = httpStatusOf(error);
  if (status !== undefined && status >= 400) {
    return dependencyBadGateway(error);
  }
  return dependencyUnavailable(error);
}
