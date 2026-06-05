import type { Request } from 'express';
import { getClientIp } from 'request-ip';

export function getRequestClientIp(request: Request): string {
  return (
    getClientIp(request) ??
    request.ip ??
    request.socket.remoteAddress ??
    'unknown-client'
  );
}
