import {
  parseRedisUrl,
  parseSentinelAddresses,
  resolveRedisConnection,
  toIoredisOptions,
  toNodeRedisOptions,
} from './redis-url.js';

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

  it('strips brackets from IPv6 hostnames', () => {
    expect(parseRedisUrl('redis://[::1]:6379')).toEqual({
      host: '::1',
      port: 6379,
      db: 0,
    });
  });

  it('throws a contextual error for invalid URLs', () => {
    expect(() => parseRedisUrl('not a redis url')).toThrow(
      'Invalid Redis URL: "not a redis url"',
    );
  });

  it('throws a contextual error for empty input', () => {
    expect(() => parseRedisUrl('')).toThrow(
      'Redis URL is required but received an empty value.',
    );
  });

  it('throws a contextual error for unsupported schemes', () => {
    expect(() => parseRedisUrl('http://cache.internal')).toThrow(
      'Invalid Redis URL scheme: "http:"',
    );
  });
});

describe('parseSentinelAddresses', () => {
  it('parses host:port pairs', () => {
    expect(parseSentinelAddresses('10.0.0.1:26379,10.0.0.2:26380')).toEqual([
      { host: '10.0.0.1', port: 26379 },
      { host: '10.0.0.2', port: 26380 },
    ]);
  });

  it('defaults to port 26379 when omitted', () => {
    expect(parseSentinelAddresses('sentinel.internal')).toEqual([
      { host: 'sentinel.internal', port: 26379 },
    ]);
  });

  it('ignores blank entries and empty input', () => {
    expect(parseSentinelAddresses(' , 10.0.0.1:26379 , ')).toEqual([
      { host: '10.0.0.1', port: 26379 },
    ]);
    expect(parseSentinelAddresses('')).toEqual([]);
    expect(parseSentinelAddresses(undefined)).toEqual([]);
  });

  it('rejects a non-numeric port', () => {
    expect(() => parseSentinelAddresses('10.0.0.1:abc')).toThrow(
      'port must be a positive integer',
    );
  });
});

describe('resolveRedisConnection', () => {
  it('returns null with no configuration', () => {
    expect(resolveRedisConnection({})).toBeNull();
  });

  it('returns standalone for a plain URL', () => {
    expect(
      resolveRedisConnection({ REDIS_URL: 'redis://h:6380/2' }),
    ).toEqual({
      mode: 'standalone',
      options: { host: 'h', port: 6380, db: 2 },
    });
  });

  it('prefers sentinel when the address list is set', () => {
    const result = resolveRedisConnection({
      REDIS_URL: 'redis://ignored:6379/3',
      REDIS_SENTINELS: '10.0.0.1:26379,10.0.0.2:26379',
      REDIS_MASTER_NAME: 'lucent-master',
      REDIS_PASSWORD: 'secret',
    });
    expect(result).toEqual({
      mode: 'sentinel',
      options: {
        sentinels: [
          { host: '10.0.0.1', port: 26379 },
          { host: '10.0.0.2', port: 26379 },
        ],
        name: 'lucent-master',
        db: 3,
        password: 'secret',
      },
    });
  });

  it('defaults the master name to mymaster', () => {
    const result = resolveRedisConnection({
      REDIS_SENTINELS: '10.0.0.1:26379',
    });
    expect(result).toMatchObject({
      mode: 'sentinel',
      options: { name: 'mymaster', db: 0 },
    });
  });
});

describe('toIoredisOptions / toNodeRedisOptions', () => {
  const sentinel = resolveRedisConnection({
    REDIS_SENTINELS: '10.0.0.1:26379',
    REDIS_MASTER_NAME: 'm',
    REDIS_PASSWORD: 'p',
  })!;

  it('ioredis uses sentinels + name (not host/port)', () => {
    const options = toIoredisOptions(sentinel, { maxRetriesPerRequest: 1 });
    expect(options).toMatchObject({
      name: 'm',
      password: 'p',
      maxRetriesPerRequest: 1,
    });
    expect(options).not.toHaveProperty('host');
  });

  it('node-redis uses database instead of db', () => {
    const options = toNodeRedisOptions(sentinel);
    expect(options).toHaveProperty('database', 0);
    expect(options).not.toHaveProperty('db');
  });

  it('standalone node-redis maps db -> database', () => {
    const standalone = resolveRedisConnection({
      REDIS_URL: 'redis://h:6380/5',
    })!;
    expect(toNodeRedisOptions(standalone)).toMatchObject({
      database: 5,
      host: 'h',
      port: 6380,
    });
  });
});
