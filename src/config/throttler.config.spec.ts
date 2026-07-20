import type { ConfigService } from '@nestjs/config';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import { ThrottlerConfigService } from './throttler.config';

/** Extract the object variant of ThrottlerModuleOptions for property access. */
type ObjectThrottlerOptions = Extract<
  ThrottlerModuleOptions,
  { throttlers: unknown }
>;

// Mock ioredis so we can intercept the Redis constructor call
const mockRedisInstance = {
  pttl: vi.fn(),
  incr: vi.fn(),
  pexpire: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
};

vi.mock('ioredis', () => {
  // Must use a class (not arrow fn) so `new Redis(url)` works
  class MockRedis {
    pttl = mockRedisInstance.pttl;
    incr = mockRedisInstance.incr;
    pexpire = mockRedisInstance.pexpire;
    set = mockRedisInstance.set;
    del = mockRedisInstance.del;
  }
  return { default: MockRedis };
});

describe('ThrottlerConfigService', () => {
  function createConfigService(
    redisUrl: string | undefined,
  ): ThrottlerConfigService {
    const mockConfig = {
      get: vi.fn((key: string) => {
        if (key === 'REDIS_URL') return redisUrl;
        return undefined;
      }),
    } as unknown as ConfigService;
    return new ThrottlerConfigService(mockConfig);
  }

  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ── createThrottlerOptions without REDIS_URL ───────────────────────────

  it('falls back to in-memory storage when REDIS_URL is missing', async () => {
    const service = createConfigService(undefined);
    const options =
      (await service.createThrottlerOptions()) as ObjectThrottlerOptions;

    expect(options.throttlers).toEqual([{ ttl: 60_000, limit: 100 }]);
    expect(options.storage).toBeUndefined();
  });

  // ── createThrottlerOptions with REDIS_URL ──────────────────────────────

  it('creates a Redis-backed storage when REDIS_URL is set', async () => {
    const service = createConfigService('redis://127.0.0.1:6379');
    const options =
      (await service.createThrottlerOptions()) as ObjectThrottlerOptions;

    expect(options.throttlers).toEqual([{ ttl: 60_000, limit: 100 }]);
    expect(options.storage).toBeDefined();
    expect(typeof options.storage?.increment).toBe('function');
  });

  // ── RedisThrottlerStorage.increment ─────────────────────────────────────

  describe('RedisThrottlerStorage.increment', () => {
    it('returns blocked record when block key is active', async () => {
      // pttl(blockKey) returns positive → still blocked
      mockRedisInstance.pttl.mockResolvedValueOnce(5000);

      const service = createConfigService('redis://127.0.0.1:6379');
      const options =
        (await service.createThrottlerOptions()) as ObjectThrottlerOptions;
      const storage = options.storage!;

      const result = await storage.increment(
        'key-1',
        60_000,
        100,
        10_000,
        'default',
      );

      expect(result.isBlocked).toBe(true);
      expect(result.totalHits).toBe(100);
      expect(result.timeToBlockExpire).toBe(5000);
      expect(mockRedisInstance.incr).not.toHaveBeenCalled();
    });

    it('creates and increments a new counter on first hit', async () => {
      // 1st pttl: block check → not blocked; 2nd pttl: timeToExpire
      mockRedisInstance.pttl
        .mockResolvedValueOnce(-1)
        .mockResolvedValueOnce(60_000);
      mockRedisInstance.incr.mockResolvedValueOnce(1);
      mockRedisInstance.pexpire.mockResolvedValueOnce(1);

      const service = createConfigService('redis://127.0.0.1:6379');
      const options =
        (await service.createThrottlerOptions()) as ObjectThrottlerOptions;
      const storage = options.storage!;

      const result = await storage.increment(
        'key-2',
        60_000,
        100,
        10_000,
        'default',
      );

      expect(result.totalHits).toBe(1);
      expect(result.isBlocked).toBe(false);
      expect(result.timeToExpire).toBe(60_000);
      expect(mockRedisInstance.pexpire).toHaveBeenCalledWith(
        'throttler:default:key-2',
        60_000,
      );
    });

    it('does not call pexpire on subsequent hits', async () => {
      // 1st pttl: block check → not blocked; 2nd pttl: remaining TTL
      mockRedisInstance.pttl
        .mockResolvedValueOnce(-1)
        .mockResolvedValueOnce(45_000);
      mockRedisInstance.incr.mockResolvedValueOnce(5);

      const service = createConfigService('redis://127.0.0.1:6379');
      const options =
        (await service.createThrottlerOptions()) as ObjectThrottlerOptions;
      const storage = options.storage!;

      const result = await storage.increment(
        'key-3',
        60_000,
        100,
        10_000,
        'default',
      );

      expect(result.totalHits).toBe(5);
      expect(result.isBlocked).toBe(false);
      expect(result.timeToExpire).toBe(45_000);
      expect(mockRedisInstance.pexpire).not.toHaveBeenCalled();
    });

    it('blocks when counter exceeds limit', async () => {
      // pttl: block check → not blocked
      mockRedisInstance.pttl.mockResolvedValueOnce(-1);
      mockRedisInstance.incr.mockResolvedValueOnce(101); // over limit
      mockRedisInstance.set.mockResolvedValueOnce('OK');
      mockRedisInstance.del.mockResolvedValueOnce(1);

      const service = createConfigService('redis://127.0.0.1:6379');
      const options =
        (await service.createThrottlerOptions()) as ObjectThrottlerOptions;
      const storage = options.storage!;

      const result = await storage.increment(
        'key-4',
        60_000,
        100,
        10_000,
        'default',
      );

      expect(result.isBlocked).toBe(true);
      expect(result.totalHits).toBe(101);
      expect(result.timeToExpire).toBe(0);
      expect(result.timeToBlockExpire).toBe(10_000);
      expect(mockRedisInstance.set).toHaveBeenCalledWith(
        'throttler:default:key-4:blocked',
        '1',
        'PX',
        10_000,
      );
      expect(mockRedisInstance.del).toHaveBeenCalledWith(
        'throttler:default:key-4',
      );
    });

    it('falls back to ttl when pttl returns non-positive on first hit', async () => {
      // 1st pttl: block check → not blocked; 2nd pttl: non-positive → fallback to ttl
      mockRedisInstance.pttl
        .mockResolvedValueOnce(-1)
        .mockResolvedValueOnce(-1);
      mockRedisInstance.incr.mockResolvedValueOnce(1);
      mockRedisInstance.pexpire.mockResolvedValueOnce(1);

      const service = createConfigService('redis://127.0.0.1:6379');
      const options =
        (await service.createThrottlerOptions()) as ObjectThrottlerOptions;
      const storage = options.storage!;

      const result = await storage.increment(
        'key-5',
        30_000,
        100,
        10_000,
        'default',
      );

      // pttl returns -1 → falls back to ttl (30_000)
      expect(result.timeToExpire).toBe(30_000);
    });
  });
});
