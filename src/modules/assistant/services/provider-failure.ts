import type { DomainFailureCode } from '../../../common/result/domain-failure.js';

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

  if (status === 429) {
    return {
      code: 'DEPENDENCY_UNAVAILABLE',
      detail: 'The assistant model is rate limited. Please try again shortly.',
      retryable: true,
    };
  }
  if (status === 408 || status === 504) {
    return {
      code: 'DEPENDENCY_TIMEOUT',
      detail: 'The assistant model did not respond in time.',
      retryable: true,
    };
  }
  if (status >= 500) {
    return {
      code: 'DEPENDENCY_BAD_GATEWAY',
      detail: 'The assistant model is temporarily unavailable.',
      retryable: true,
    };
  }
  if (status === 400 || status === 404 || status === 422) {
    // Model id retired, or the request is rejected as permanently invalid.
    // Retrying an identical request cannot help.
    return {
      code: 'DEPENDENCY_UNAVAILABLE',
      detail:
        'The assistant model rejected the request. It may be misconfigured or no longer available.',
      retryable: false,
    };
  }
  if (status === 401 || status === 403) {
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
