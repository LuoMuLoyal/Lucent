import { trace } from '@opentelemetry/api';

export interface ActiveTraceIds {
  traceId?: string;
  spanId?: string;
}

/**
 * Returns the active OTel span's trace ids, or nothing when tracing is
 * disabled or we are outside a span (bootstrap, cron, queue workers).
 */
export function getActiveTraceIds(): ActiveTraceIds {
  const span = trace.getActiveSpan();
  const ctx = span?.spanContext();
  if (ctx == null) {
    return {};
  }
  return { traceId: ctx.traceId, spanId: ctx.spanId };
}

/** Returns only the active trace id (used by Prisma slow-query logging). */
export function getActiveTraceId(): string | undefined {
  return getActiveTraceIds().traceId;
}
