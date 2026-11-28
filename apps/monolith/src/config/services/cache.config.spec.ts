import type { ConfigService } from '@nestjs/config';
import { createKeyv } from '@keyv/redis';
import { CacheConfigService } from './cache.config.js';

vi.mock('@keyv/redis', () => ({
  createKeyv: vi.fn(),
}));

describe('CacheConfigService', () => {
  const createKeyvMock = createKeyv as vi.MockedFunction<typeof createKeyv>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function configWith(values: Record<string, string | undefined>): ConfigService {
    return {
      get: vi.fn().mockImplementation((key: string) => values[key]),
    } as unknown as ConfigService;
  }

  it('falls back to memory cache when no Redis is configured', () => {
    const service = new CacheConfigService(configWith({}));

    expect(service.createCacheOptions()).toEqual({ ttl: 300_000 });
    expect(createKeyvMock).not.toHaveBeenCalled();
  });

  it('builds a node-redis client from REDIS_URL', () => {
    const mockStore = { name: 'redis' };
    createKeyvMock.mockReturnValue(mockStore as never);

    const service = new CacheConfigService(
      configWith({ REDIS_URL: 'redis://:secret@cache.internal:6380/2' }),
    );

    const options = service.createCacheOptions();

    // node-redis 用 `database`（不是 ioredis 的 `db`），口令单独给 `password`。
    expect(createKeyvMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'cache.internal',
        port: 6380,
        database: 2,
        password: 'secret',
        disableOfflineQueue: true,
        commandsQueueMaxLength: 1000,
      }),
    );
    expect(options.ttl).toBe(300_000);
    expect(options.stores).toEqual([mockStore]);
  });

  it('enables tls for rediss URLs', () => {
    createKeyvMock.mockReturnValue({ name: 'redis' } as never);

    const service = new CacheConfigService(
      configWith({ REDIS_URL: 'rediss://secure-cache.internal' }),
    );

    service.createCacheOptions();

    expect(createKeyvMock).toHaveBeenCalledWith(
      expect.objectContaining({ tls: {} }),
    );
  });

  it('uses sentinel discovery instead of a direct host when REDIS_SENTINELS is set', () => {
    createKeyvMock.mockReturnValue({ name: 'redis' } as never);

    const service = new CacheConfigService(
      configWith({
        REDIS_SENTINELS: '10.0.0.1:26379,10.0.0.2:26379',
        REDIS_MASTER_NAME: 'lucent-master',
        REDIS_PASSWORD: 'pw',
        REDIS_SENTINEL_PASSWORD: 'spw',
      }),
    );

    service.createCacheOptions();

    const arg = createKeyvMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg).toMatchObject({
      name: 'lucent-master',
      password: 'pw',
      sentinelPassword: 'spw',
      sentinels: [
        { host: '10.0.0.1', port: 26379 },
        { host: '10.0.0.2', port: 26379 },
      ],
    });
    // Sentinel 模式下不应再出现直连的 host。
    expect(arg).not.toHaveProperty('host');
  });

  it('skips redis when OPENAPI_EXPORT_SKIP_REDIS is true', () => {
    // OpenAPI 导出在无 Redis 的 CI 里跑:此时即使配了 REDIS_URL 也必须退回内存,
    // 否则导出过程会挂在一个连不上的 store 上。
    const service = new CacheConfigService(
      configWith({
        REDIS_URL: 'redis://cache.internal:6379',
        OPENAPI_EXPORT_SKIP_REDIS: 'true',
      }),
    );

    expect(service.createCacheOptions()).toEqual({ ttl: 300_000 });
    expect(createKeyvMock).not.toHaveBeenCalled();
  });

  it('keeps redis when OPENAPI_EXPORT_SKIP_REDIS is any other value', () => {
    // 只有字面量 'true' 才跳过;'false' / 未设置都照常走 Redis。
    createKeyvMock.mockReturnValue({ name: 'redis' } as never);

    const service = new CacheConfigService(
      configWith({
        REDIS_URL: 'redis://cache.internal:6379',
        OPENAPI_EXPORT_SKIP_REDIS: 'false',
      }),
    );

    expect(service.createCacheOptions().stores).toHaveLength(1);
    expect(createKeyvMock).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'cache.internal', port: 6379 }),
    );
  });
});