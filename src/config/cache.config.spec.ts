import type { ConfigService } from '@nestjs/config';
import { KeyvAdapter } from 'cache-manager';
import { redisStore } from 'cache-manager-ioredis-yet';
import Keyv from 'keyv';
import { CacheConfigService } from './cache.config';

type RedisStoreMock = Awaited<ReturnType<typeof redisStore>>;

function createRedisStoreMock(): RedisStoreMock {
  return {
    get: vi.fn(),
    mget: vi.fn(),
    set: vi.fn(),
    mset: vi.fn(),
    del: vi.fn(),
    mdel: vi.fn(),
    ttl: vi.fn(),
    keys: vi.fn(),
    disconnect: vi.fn(),
    isCacheable: vi.fn().mockReturnValue(true),
    client: {
      disconnect: vi.fn(),
    },
  } as unknown as RedisStoreMock;
}

vi.mock('cache-manager-ioredis-yet', () => ({
  redisStore: vi.fn(),
}));

describe('CacheConfigService', () => {
  const REDIS_DEFAULT_PORT = 6379;
  const REDIS_CUSTOM_PORT = 6380;

  const redisStoreMock = redisStore as vi.MockedFunction<typeof redisStore>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('falls back to memory cache when REDIS_URL is missing', async () => {
    const service = new CacheConfigService({
      get: vi.fn().mockReturnValue(undefined),
    } as unknown as ConfigService);

    await expect(service.createCacheOptions()).resolves.toEqual({
      ttl: 300_000,
    });
    expect(redisStoreMock).not.toHaveBeenCalled();
  });

  it('builds a redis-backed Keyv store from REDIS_URL', async () => {
    const mockStore = createRedisStoreMock();
    redisStoreMock.mockResolvedValue(mockStore);

    const service = new CacheConfigService({
      get: vi.fn().mockImplementation((key: string) => {
        if (key === 'REDIS_URL') {
          return `redis://:secret@cache.internal:${REDIS_CUSTOM_PORT}/2`;
        }

        return undefined;
      }),
    } as unknown as ConfigService);

    const options = await service.createCacheOptions();

    expect(redisStoreMock).toHaveBeenCalledWith({
      host: 'cache.internal',
      port: REDIS_CUSTOM_PORT,
      password: 'secret',
      db: 2,
      tls: undefined,
    });
    expect(options.ttl).toBe(300_000);
    expect(Array.isArray(options.stores)).toBe(true);
    if (!Array.isArray(options.stores)) {
      throw new Error('Expected redis cache options to include a stores array');
    }

    expect(options.stores).toHaveLength(1);
    expect(options.stores[0]).toBeInstanceOf(Keyv);
    if (!(options.stores[0] instanceof Keyv)) {
      throw new Error('Expected redis cache store to be a Keyv instance');
    }

    const firstStore: Keyv<unknown> = options.stores[0];
    expect(firstStore.opts.store).toBeInstanceOf(KeyvAdapter);
  });

  it('enables tls for rediss URLs', async () => {
    redisStoreMock.mockResolvedValue(createRedisStoreMock());

    const service = new CacheConfigService({
      get: vi.fn().mockReturnValue('rediss://secure-cache.internal'),
    } as unknown as ConfigService);

    await service.createCacheOptions();

    expect(redisStoreMock).toHaveBeenCalledWith({
      host: 'secure-cache.internal',
      port: REDIS_DEFAULT_PORT,
      password: undefined,
      db: 0,
      tls: {},
    });
  });
});
