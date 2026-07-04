/**
 * Shared retry helpers for outbound HTTP calls and other async operations.
 *
 * These utilities keep providers on the native `fetch` API while avoiding
 * duplicated manual `for` loops and magic retry constants.
 */

const DEFAULT_ATTEMPTS = 2;
const DEFAULT_DELAY_MS = 200;

/** Options for {@link withRetry} and {@link fetchWithRetry}. */
export interface RetryOptions {
  /** Maximum number of attempts (default: 2). */
  attempts?: number;
  /** Delay before the first retry, in milliseconds (default: 200). */
  delayMs?: number;
  /** Backoff strategy: fixed or exponential (default: 'fixed'). */
  backoff?: 'fixed' | 'exponential';
  /** Optional callback invoked before each retry. */
  onRetry?: (error: unknown, attempt: number) => void;
}

function calculateDelay(
  attempt: number,
  delayMs: number,
  backoff: RetryOptions['backoff'],
): number {
  if (backoff === 'exponential') {
    return delayMs * 2 ** attempt;
  }
  return delayMs;
}

/**
 * Retries an async operation until it succeeds or the attempt budget is
 * exhausted.
 *
 * @param operation - The async operation to retry.
 * @param options - Retry behavior options.
 * @returns The operation result.
 * @throws The last encountered error when all attempts fail.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const attempts = Math.max(1, options?.attempts ?? DEFAULT_ATTEMPTS);
  const delayMs = options?.delayMs ?? DEFAULT_DELAY_MS;
  const backoff = options?.backoff ?? 'fixed';

  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      const isLastAttempt = attempt === attempts - 1;
      if (!isLastAttempt) {
        options?.onRetry?.(error, attempt + 1);
        const waitMs = calculateDelay(attempt, delayMs, backoff);
        await new Promise((resolve) => {
          setTimeout(resolve, waitMs);
        });
      }
    }
  }

  throw lastError;
}

/**
 * Fetches a URL with automatic retries on network failures or non-2xx
 * responses.
 *
 * @param url - The URL to fetch.
 * @param init - Standard `fetch` init options plus retry options.
 * @returns The successful response.
 * @throws The last encountered error when all attempts fail.
 */
export async function fetchWithRetry(
  url: string,
  init?: RequestInit & RetryOptions,
): Promise<Response> {
  const { attempts, delayMs, backoff, onRetry, ...fetchInit } = init ?? {};

  const retryOptions: RetryOptions = {};
  if (attempts !== undefined) retryOptions.attempts = attempts;
  if (delayMs !== undefined) retryOptions.delayMs = delayMs;
  if (backoff !== undefined) retryOptions.backoff = backoff;
  if (onRetry !== undefined) retryOptions.onRetry = onRetry;

  return withRetry(async () => {
    const response = await fetch(url, fetchInit);
    if (!response.ok) {
      throw new Error(`HTTP ${String(response.status)}`);
    }
    return response;
  }, retryOptions);
}
