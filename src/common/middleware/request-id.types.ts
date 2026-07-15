import type { FastifyRequest } from 'fastify';

export const REQUEST_ID_HEADER = 'X-Request-Id';

/**
 * Fastify request augmented with the resolved request ID and optional
 * metrics start timestamp. Both fields are set by `preHandler` hooks
 * registered in `setupApp`.
 */
export interface FastifyRequestWithId extends FastifyRequest {
  requestId: string;
  __metricsStart?: number;
}
