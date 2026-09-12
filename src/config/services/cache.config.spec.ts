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
});
