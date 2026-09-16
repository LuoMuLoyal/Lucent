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

  it('falls back to memory cache when REDIS_URL is missing', () => {
    const service = new CacheConfigService({
      get: vi.fn().mockReturnValue(undefined),
    } as unknown as ConfigService);

    // createCacheOptions is synchronous; assert the returned object directly.
    expect(service.createCacheOptions()).toEqual({
      ttl: 300_000,
    });
    expect(createKeyvMock).not.toHaveBeenCalled();
  });

  it('builds a redis-backed Keyv store from REDIS_URL', () => {
    const mockStore = { name: 'redis' };
    createKeyvMock.mockReturnValue(mockStore as never);

    const service = new CacheConfigService({
      get: vi.fn().mockImplementation((key: string) => {
        if (key === 'REDIS_URL') {
          return 'redis://:secret@cache.internal:6380/2';
        }

        return undefined;
      }),
    } as unknown as ConfigService);

    const options = service.createCacheOptions();

    expect(createKeyvMock).toHaveBeenCalledWith(
      'redis://:secret@cache.internal:6380/2',
    );
    expect(options.ttl).toBe(300_000);
    expect(options.stores).toEqual([mockStore]);
  });

  it('enables tls for rediss URLs', () => {
    createKeyvMock.mockReturnValue({ name: 'redis' } as never);

    const service = new CacheConfigService({
      get: vi.fn().mockReturnValue('rediss://secure-cache.internal'),
    } as unknown as ConfigService);

    service.createCacheOptions();

    expect(createKeyvMock).toHaveBeenCalledWith(
      'rediss://secure-cache.internal',
    );
  });

  it('skips redis when OPENAPI_EXPORT_SKIP_REDIS is true', () => {
    // OpenAPI 导出在无 Redis 的 CI 里跑:此时即使配了 REDIS_URL 也必须退回内存,
    // 否则导出过程会挂在一个连不上的 store 上。
    const service = new CacheConfigService({
      get: vi.fn().mockImplementation((key: string) => {
        if (key === 'REDIS_URL') return 'redis://cache.internal:6379';
        if (key === 'OPENAPI_EXPORT_SKIP_REDIS') return 'true';

        return undefined;
      }),
    } as unknown as ConfigService);

    expect(service.createCacheOptions()).toEqual({ ttl: 300_000 });
    expect(createKeyvMock).not.toHaveBeenCalled();
  });

  it('keeps redis when OPENAPI_EXPORT_SKIP_REDIS is any other value', () => {
    // 只有字面量 'true' 才跳过;'false' / 未设置都照常走 Redis。
    createKeyvMock.mockReturnValue({ name: 'redis' } as never);

    const service = new CacheConfigService({
      get: vi.fn().mockImplementation((key: string) => {
        if (key === 'REDIS_URL') return 'redis://cache.internal:6379';
        if (key === 'OPENAPI_EXPORT_SKIP_REDIS') return 'false';

        return undefined;
      }),
    } as unknown as ConfigService);

    expect(service.createCacheOptions().stores).toHaveLength(1);
    expect(createKeyvMock).toHaveBeenCalledWith('redis://cache.internal:6379');
  });
});
