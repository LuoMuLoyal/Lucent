import { buildAccessLogEntry } from './access-log.utils.js';

describe('buildAccessLogEntry', () => {
  it('prefers the route pattern over the raw URL', () => {
    const entry = buildAccessLogEntry({
      method: 'GET',
      routeUrl: '/api/v1/user/daily-records/:id',
      rawUrl: '/api/v1/user/daily-records/123?verbose=true',
      statusCode: 200,
      elapsedMs: 12.4,
    });

    expect(entry).toEqual({
      level: 'info',
      message: 'HTTP request completed',
      method: 'GET',
      url: '/api/v1/user/daily-records/:id',
      statusCode: 200,
      durationMs: 12,
    });
  });

  it('falls back to the raw URL when no route pattern exists (404)', () => {
    const entry = buildAccessLogEntry({
      method: 'GET',
      routeUrl: undefined,
      rawUrl: '/no/such/route',
      statusCode: 404,
      elapsedMs: 1.2,
    });

    expect(entry.url).toBe('/no/such/route');
    expect(entry.level).toBe('info');
  });

  it('uses error level for 5xx responses', () => {
    const entry = buildAccessLogEntry({
      method: 'POST',
      routeUrl: '/api/v1/user/assistant/messages/stream',
      rawUrl: '/api/v1/user/assistant/messages/stream',
      statusCode: 500,
      elapsedMs: 250.6,
    });

    expect(entry.level).toBe('error');
    expect(entry.durationMs).toBe(251);
  });
});
