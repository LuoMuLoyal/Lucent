import type { FastifyRequest } from 'fastify';

/**
 * Fastify request augmented with the optional metrics start timestamp,
 * set by the `preHandler` hook registered in `setupApp`.
 */
export interface FastifyRequestWithMetrics extends FastifyRequest {
  __metricsStart?: number;
}
