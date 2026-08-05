import { Logger } from '@nestjs/common';

/** Errno codes that indicate network/connection failures. */
const CONNECTION_ERRNO_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

/**
 * Message patterns that specifically indicate a connection-level failure.
 * Kept narrow to avoid matching business errors that happen to mention
 * "Redis", "connection", "socket", or "timeout" in a non-connection context.
 */
const CONNECTION_MESSAGE_PATTERNS = [
  /connection (?:refused|reset|lost|closed|terminated|timed out|ended|dropped)/i,
  /socket (?:hang up|closed|destroyed|ended)/i,
];

/**
 * Connection-related error signatures we are willing to swallow and fall back
 * from. Programming errors (TypeError / ReferenceError / SyntaxError) and
 * unrelated runtime failures must bubble up so they are not hidden behind a
 * silent fallback path.
 */
function isQueueConnectionError(error: unknown): boolean {
  if (
    error instanceof TypeError ||
    error instanceof ReferenceError ||
    error instanceof SyntaxError
  ) {
    return false;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  // Precise errno-code match (preferred).
  const code = (error as NodeJS.ErrnoException).code;
  if (code != null && CONNECTION_ERRNO_CODES.has(code)) {
    return true;
  }

  // Narrow message-pattern fallback for wrapped errors without a code.
  const haystack = `${error.name} ${error.message}`;
  return CONNECTION_MESSAGE_PATTERNS.some((pattern) => pattern.test(haystack));
}

/**
 * Shared helper for the async-queue-or-sync-fallback pattern used by
 * controllers that support both BullMQ-backed async processing and
 * direct synchronous execution when Redis is unavailable.
 *
 * @param isConfigured Whether the queue is available.
 * @param queueName    Queue name used in the error log when enqueue throws.
 * @param enqueue      Function that enqueues the job and returns a job ID
 *                     (or `null` if enqueue failed despite being configured).
 * @param fallback     Synchronous fallback that produces the result.
 * @param fallbackKey  The envelope key under which the fallback result is
 *                     returned (e.g. `'result'` or `'pdfBase64'`).
 * @param logger       Optional injected Logger instance for testability.
 *                     When omitted, falls back to the static Logger.
 * @returns Either `{ jobId }` when the queue accepted the job, or
 *          `{ [fallbackKey]: result }` from the synchronous fallback.
 */
export async function enqueueOrFallback<T>(
  isConfigured: boolean,
  queueName: string,
  enqueue: () => Promise<string | null>,
  fallback: () => Promise<T>,
  fallbackKey: string,
  logger?: Logger,
): Promise<Record<string, unknown>> {
  if (isConfigured) {
    try {
      const jobId = await enqueue();
      if (jobId != null) {
        return { jobId };
      }
    } catch (error) {
      if (!isQueueConnectionError(error)) {
        throw error;
      }

      // Redis 配置但断连等运行时异常：记日志后走同步回退，避免请求直接 500。
      const message = `Enqueue failed for queue "${queueName}", falling back to synchronous processing: ${
        error instanceof Error ? error.message : String(error)
      }`;
      const stack = error instanceof Error ? error.stack : undefined;

      if (logger != null) {
        logger.error(message, stack);
      } else {
        Logger.error(message, stack, 'enqueueOrFallback');
      }
    }
  }

  const result = await fallback();
  return { [fallbackKey]: result };
}
