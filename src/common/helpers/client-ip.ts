import type { FastifyRequest } from 'fastify';

/**
 * Extracts the client IP address from a Fastify request.
 *
 * Relies on Fastify's `trustProxy` adapter setting (configured in `main.ts`)
 * to correctly resolve `request.ip` from `X-Forwarded-For` when behind a
 * reverse proxy. Falls back to `request.raw.socket.remoteAddress` and finally
 * `unknown-client`.
 */
export function getRequestClientIp(request: FastifyRequest): string {
  return request.ip || request.raw.socket.remoteAddress || 'unknown-client';
}
