import type { Request } from 'express';
import { getClientIp } from 'request-ip';

export function getRequestClientIp(
  request: Request,
  trustProxy = false,
): string {
  if (trustProxy) {
    return (
      getClientIp(request) ??
      request.ip ??
      request.socket.remoteAddress ??
      'unknown-client'
    );
  }
  return request.ip ?? request.socket.remoteAddress ?? 'unknown-client';
}
