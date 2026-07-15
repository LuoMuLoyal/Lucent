import type { FastifyRequest } from 'fastify';
import { getRequestClientIp } from './client-ip';

describe('client-ip', () => {
  const mockSocket = { remoteAddress: '192.168.1.100' };

  function makeRequest(
    overrides: Record<string, unknown> = {},
  ): FastifyRequest {
    return {
      raw: { socket: mockSocket },
      ...overrides,
    } as unknown as FastifyRequest;
  }

  describe('getRequestClientIp', () => {
    it('returns request.ip when available', () => {
      const req = makeRequest({ ip: '10.0.0.1' });
      expect(getRequestClientIp(req)).toBe('10.0.0.1');
    });

    it('falls back to socket.remoteAddress when ip is undefined', () => {
      const req = makeRequest({ ip: undefined });
      expect(getRequestClientIp(req)).toBe('192.168.1.100');
    });

    it('returns unknown-client when both ip and remoteAddress are undefined', () => {
      const req = {
        raw: { socket: { remoteAddress: undefined } },
        ip: undefined,
      } as unknown as FastifyRequest;
      expect(getRequestClientIp(req)).toBe('unknown-client');
    });

    it('returns socket.remoteAddress when ip is undefined', () => {
      const req = {
        raw: { socket: { remoteAddress: '127.0.0.1' } },
        ip: undefined,
      } as unknown as FastifyRequest;
      expect(getRequestClientIp(req)).toBe('127.0.0.1');
    });
  });
});
