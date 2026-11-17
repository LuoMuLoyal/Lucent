/**
 * LLM-specific retry helpers.
 *
 * Uses the shared `withRetry` utility but adds LLM-aware error classification
 * so that non-retryable errors (e.g. 400 Bad Request, 401 Unauthorized) are
 * not retried, while transient errors (429, 500, 502, 503, timeouts, network)
 * are retried with exponential backoff.
 */
import {
  withRetry,
  type RetryOptions,
} from '../../helpers/infra/retry.utils.js';

/**
 * Returns `true` when the error looks transient enough to warrant a retry.
 *
 * Checks for:
 * - HTTP 429 (rate limit)
 * - HTTP 5xx (server errors)
 * - Network / timeout errors (ECONNRESET, ETIMEDOUT, abort, timeout)
 */
export function isRetryableLlmError(error: unknown): boolean {
  if (error == null || typeof error !== 'object') {
    return false;
  }

  // LangChain/OpenAI errors often carry a `status` or `response.status` property
  const status =
    (error as { status?: number }).status ??
    (error as { response?: { status?: number } }).response?.status;
  if (typeof status === 'number') {
    return status === 429 || (status >= 500 && status < 600);
  }

  // Network / timeout patterns
  const message =
    typeof (error as { message?: string }).message === 'string'
      ? (error as { message: string }).message.toLowerCase()
      : '';
  return (
    message.includes('timeout') ||
    message.includes('econnreset') ||
    message.includes('etimedout') ||
    message.includes('socket hang up') ||
    message.includes('network error') ||
    message.includes('aborted') ||
    message.includes('fetch failed')
  );
}

/**
 * Retries an LLM operation with exponential backoff.
 *
 * Non-retryable errors are thrown immediately without consuming the retry budget.
 */
export function withLlmRetry<T>(
  operation: () => Promise<T>,
  options?: Pick<RetryOptions, 'onRetry'>,
): Promise<T> {
  const retryOptions: RetryOptions = {
    attempts: 3, // 1 initial + 2 retries
    delayMs: 800,
    backoff: 'exponential',
  };
  if (options?.onRetry != null) {
    retryOptions.onRetry = options.onRetry;
  }
  return withRetry(operation, retryOptions);
}
