/**
 * Shared helper for the async-queue-or-sync-fallback pattern used by
 * controllers that support both BullMQ-backed async processing and
 * direct synchronous execution when Redis is unavailable.
 *
 * @param isConfigured Whether the queue is available.
 * @param enqueue      Function that enqueues the job and returns a job ID
 *                     (or `null` if enqueue failed despite being configured).
 * @param fallback     Synchronous fallback that produces the result.
 * @param fallbackKey  The envelope key under which the fallback result is
 *                     returned (e.g. `'result'` or `'pdfBase64'`).
 * @returns Either `{ jobId }` when the queue accepted the job, or
 *          `{ [fallbackKey]: result }` from the synchronous fallback.
 */
export async function enqueueOrFallback<T>(
  isConfigured: boolean,
  enqueue: () => Promise<string | null>,
  fallback: () => Promise<T>,
  fallbackKey: string,
): Promise<Record<string, unknown>> {
  if (isConfigured) {
    const jobId = await enqueue();
    if (jobId != null) {
      return { jobId };
    }
  }

  const result = await fallback();
  return { [fallbackKey]: result };
}
