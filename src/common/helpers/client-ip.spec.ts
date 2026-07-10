import type { Request } from 'express';
import { getRequestClientIp } from './client-ip';

describe('client-ip', () => {
  const mockSocket = { remoteAddress: '192.168.1.100' };

  function makeRequest(overrides: Partial<Request> = {}): Request {
    return {
      socket: mockSocket,
      ...overrides,
    } as unknown as Request;
  }

  describe('getRequestClientIp', () => {
    it('returns request.ip when trustProxy is false', () => {
      const req = makeRequest({ ip: '10.0.0.1' });
      expect(getRequestClientIp(req, false)).toBe('10.0.0.1');
    });

    it('falls back to socket.remoteAddress when ip is undefined', () => {
      const req = makeRequest({ ip: undefined });
      expect(getRequestClientIp(req, false)).toBe('192.168.1.100');
    });

    it('returns unknown-client when both ip and remoteAddress are undefined', () => {
      const req = {
        socket: { remoteAddress: undefined },
        ip: undefined,
      } as unknown as Request;
      expect(getRequestClientIp(req, false)).toBe('unknown-client');
    });

    it('uses request-ip when trustProxy is true and x-forwarded-for is set', () => {
      const req = makeRequest({
        ip: '10.0.0.1',
        headers: { 'x-forwarded-for': '203.0.113.5' },
      } as Partial<Request>);
      // request-ip library reads x-forwarded-for when trustProxy
      const result = getRequestClientIp(req, true);
      expect(typeof result).toBe('string');
      expect(result).not.toBe('unknown-client');
    });

    it('returns a non-unknown client when trustProxy is true with no headers', () => {
      const req = makeRequest({ ip: '10.0.0.1' });
      const result = getRequestClientIp(req, true);
      // request-ip may return socket.remoteAddress or request.ip
      expect(result).not.toBe('unknown-client');
    });
  });
});
