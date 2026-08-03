import { parseRedisUrl } from './redis-url';

describe('parseRedisUrl', () => {
  it('parses host and default port', () => {
    expect(parseRedisUrl('redis://127.0.0.1')).toEqual({
      host: '127.0.0.1',
      port: 6379,
      db: 0,
    });
  });

  it('parses custom port', () => {
    expect(parseRedisUrl('redis://cache.internal:6380')).toEqual({
      host: 'cache.internal',
      port: 6380,
      db: 0,
    });
  });

  it('parses db index from pathname', () => {
    expect(parseRedisUrl('redis://cache.internal:6380/2')).toEqual({
      host: 'cache.internal',
      port: 6380,
      db: 2,
    });
  });

  it('parses username and password credentials', () => {
    expect(parseRedisUrl('redis://user:secret@cache.internal/1')).toEqual({
      host: 'cache.internal',
      port: 6379,
      db: 1,
      username: 'user',
      password: 'secret',
    });
  });

  it('enables tls for rediss scheme', () => {
    expect(parseRedisUrl('rediss://secure-cache.internal')).toEqual({
      host: 'secure-cache.internal',
      port: 6379,
      db: 0,
      tls: {},
    });
  });

  it('supports family query param (AWS ElastiCache)', () => {
    expect(parseRedisUrl('redis://cache.internal?family=0')).toEqual({
      host: 'cache.internal',
      port: 6379,
      db: 0,
      family: 0,
    });
  });

  it('db query param overrides pathname db', () => {
    expect(parseRedisUrl('redis://cache.internal/1?db=3')).toEqual({
      host: 'cache.internal',
      port: 6379,
      db: 3,
    });
  });
});
