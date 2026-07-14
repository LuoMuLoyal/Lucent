import type { Request } from 'express';

/**
 * Extracts the client IP address from an Express request.
 *
 * Relies on Express's native `trust proxy` setting (configured in `setupApp`)
 * to correctly resolve `req.ip` from `X-Forwarded-For` when behind a reverse
 * proxy. Falls back to `socket.remoteAddress` and finally `unknown-client`.
 */
export function getRequestClientIp(request: Request): string {
  return request.ip ?? request.socket.remoteAddress ?? 'unknown-client';
}
