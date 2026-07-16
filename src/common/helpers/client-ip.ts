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

/**
 * Builds an `AuthRequestContext` (IP + User-Agent) from a Fastify request.
 *
 * Shared by all auth controllers to eliminate duplicated `getAuthRequestContext`
 * private methods.
 */
export function extractAuthRequestContext(request: FastifyRequest): {
  ipAddress: string;
  userAgent?: string;
} {
  const userAgent = request.headers['user-agent'];
  return {
    ipAddress: getRequestClientIp(request),
    ...(userAgent !== undefined && { userAgent }),
  };
}
