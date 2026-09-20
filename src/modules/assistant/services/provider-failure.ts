import type { DomainFailureCode } from '../../../common/result/domain-failure.js';
import {
  HTTP_STATUS_BAD_REQUEST,
  HTTP_STATUS_FORBIDDEN,
  HTTP_STATUS_GATEWAY_TIMEOUT,
  HTTP_STATUS_INTERNAL_SERVER_ERROR,
  HTTP_STATUS_NOT_FOUND,
  HTTP_STATUS_REQUEST_TIMEOUT,
  HTTP_STATUS_TOO_MANY_REQUESTS,
  HTTP_STATUS_UNAUTHORIZED,
  HTTP_STATUS_UNPROCESSABLE_ENTITY,
} from '../../../common/constants/http-status.js';

/** A provider failure normalized into a domain-level dependency failure. */
export interface ProviderFailure {
  code: DomainFailureCode;
  detail: string;
  retryable: boolean;
}

/**
 * Classifies an exception raised by an upstream LLM provider.
 *
 * The assistant talks to a model gateway through LangChain, so a model that
 * has been retired or exhausted its quota arrives as an ordinary thrown error
 * carrying an HTTP `status` — indistinguishable, at the transport boundary,
 * from a bug in our own code. Normalizing it here is what lets the client show
 * "the model is unavailable" instead of a blanket "this reply did not
 * complete", which is the difference between a diagnosable outage and an
 * unexplained one.
 *
 * Returns null for anything that is not recognizably a provider error, so
 * unrelated exceptions keep propagating to the generic handler.
 *
 * Only the HTTP status is surfaced (never the provider's response body, which
 * can echo request content); status `401`/`403` are treated as retryable
 * because they mean *our* credentials/quota need attention, not that replaying
 * the user's request could fix it — the client should offer a retry once the
 * operator resolves it.
 */
export function classifyProviderFailure(
  error: unknown,
): ProviderFailure | null {
  if (error == null || typeof error !== 'object') return null;

  const status = extractStatus(error);
  if (status == null) return null;

  if (status === HTTP_STATUS_TOO_MANY_REQUESTS) {
    return {
      code: 'DEPENDENCY_UNAVAILABLE',
      detail: 'The assistant model is rate limited. Please try again shortly.',
      retryable: true,
    };
  }
  if (
    status === HTTP_STATUS_REQUEST_TIMEOUT ||
    status === HTTP_STATUS_GATEWAY_TIMEOUT
  ) {
    return {
      code: 'DEPENDENCY_TIMEOUT',
      detail: 'The assistant model did not respond in time.',
      retryable: true,
    };
  }
  if (status >= HTTP_STATUS_INTERNAL_SERVER_ERROR) {
    return {
      code: 'DEPENDENCY_BAD_GATEWAY',
      detail: 'The assistant model is temporarily unavailable.',
      retryable: true,
    };
  }
  if (
    status === HTTP_STATUS_BAD_REQUEST ||
    status === HTTP_STATUS_NOT_FOUND ||
    status === HTTP_STATUS_UNPROCESSABLE_ENTITY
  ) {
    // Model id retired, or the request is rejected as permanently invalid.
    // Retrying an identical request cannot help.
    return {
      code: 'DEPENDENCY_UNAVAILABLE',
      detail:
        'The assistant model rejected the request. It may be misconfigured or no longer available.',
      retryable: false,
    };
  }
  if (status === HTTP_STATUS_UNAUTHORIZED || status === HTTP_STATUS_FORBIDDEN) {
    // Credentials or quota: an operator problem, not a transport blip. Kept
    // retryable so the user is offered recovery, and reported distinctly from
    // a generic server error so the cause is visible in diagnostics.
    return {
      code: 'DEPENDENCY_UNAVAILABLE',
      detail:
        'The assistant model rejected our credentials or exhausted its quota.',
      retryable: true,
    };
  }

  return null;
}

/** Reads the HTTP status off the shapes LangChain/OpenAI clients throw. */
function extractStatus(error: object): number | null {
  const direct = (error as { status?: unknown }).status;
  if (typeof direct === 'number') return direct;

  const fromResponse = (error as { response?: { status?: unknown } }).response
    ?.status;
  if (typeof fromResponse === 'number') return fromResponse;

  const statusCode = (error as { statusCode?: unknown }).statusCode;
  if (typeof statusCode === 'number') return statusCode;

  return null;
}
