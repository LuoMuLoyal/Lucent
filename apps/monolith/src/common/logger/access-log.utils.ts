/**
 * Structured fields for the per-request completion (access) log emitted by
 * the Fastify `onResponse` hook in `setupApp`.
 */
export interface AccessLogEntry {
  level: 'info' | 'error';
  message: string;
  method: string;
  url: string;
  statusCode: number;
  durationMs: number;
}

/**
 * Builds one access-log entry per completed request. The Fastify route
 * pattern (e.g. `/api/v1/user/reports/summary/stream`) is preferred over the
 * raw URL so entries aggregate cleanly; the raw URL is the fallback for
 * unmatched routes (404s), where Fastify reports no route pattern.
 * 5xx responses are logged at `error` level, everything else at `info`.
 */
export function buildAccessLogEntry(input: {
  method: string;
  routeUrl: string | undefined;
  rawUrl: string;
  statusCode: number;
  elapsedMs: number;
}): AccessLogEntry {
  return {
    level: input.statusCode >= 500 ? 'error' : 'info',
    message: 'HTTP request completed',
    method: input.method,
    url: input.routeUrl ?? input.rawUrl,
    statusCode: input.statusCode,
    durationMs: Math.round(input.elapsedMs),
  };
}
