import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import type { Cache } from 'cache-manager';
import type { CacheManagerStore } from 'cache-manager';
import Keyv from 'keyv';
import { KeyvAdapter } from 'cache-manager';
import { MedicinesCacheAdminService } from './cache-admin.service';

function createCacheStoreMock(overrides?: {
  keys?: () => Promise<string[]>;
}): CacheManagerStore {
  const store: CacheManagerStore = {
    name: 'mock-store',
    get: vi.fn(),
    mget: vi.fn(),
    set: vi.fn(),
    mset: vi.fn(),
    del: vi.fn(),
    mdel: vi.fn(),
    ttl: vi.fn(),
    keys: vi.fn().mockResolvedValue([]),
    disconnect: vi.fn(),
    reset: vi.fn(),
  };
  if (overrides?.keys) {
    store.keys = overrides.keys;
  }
  return store;
}

describe('MedicinesCacheAdminService', () => {
  let service: MedicinesCacheAdminService;
  let cache: vi.Mocked<Cache>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MedicinesCacheAdminService,
        {
          provide: CACHE_MANAGER,
          useValue: {
            del: vi.fn(),
            stores: [],
          },
        },
      ],
    }).compile();

    service = module.get(MedicinesCacheAdminService);
    cache = module.get(CACHE_MANAGER);
  });

  it('removes all medicines cache keys from Keyv-backed stores', async () => {
    const firstRawStore = createCacheStoreMock({
      keys: vi
        .fn()
        .mockResolvedValue([
          'keyv:medicines:search:drugbank:ibuprofen:1:20',
          'keyv:medicines:detail:drugbank:DB01050',
          'keyv:auth:verification:test@example.com',
        ]),
    });
    const secondRawStore = createCacheStoreMock({
      keys: vi
        .fn()
        .mockResolvedValue(['keyv:medicines:detail:cn:cn_ibuprofen_capsule']),
    });
    cache.stores = [
      new Keyv({ store: new KeyvAdapter(firstRawStore) }),
      new Keyv({ store: new KeyvAdapter(secondRawStore) }),
    ] as typeof cache.stores;
    cache.del.mockResolvedValue(true);

    await expect(service.invalidateAll()).resolves.toBe(3);
    expect(cache.del).toHaveBeenCalledTimes(3);
    expect(cache.del).toHaveBeenNthCalledWith(
      1,
      'medicines:search:drugbank:ibuprofen:1:20',
    );
    expect(cache.del).toHaveBeenNthCalledWith(
      2,
      'medicines:detail:drugbank:DB01050',
    );
    expect(cache.del).toHaveBeenNthCalledWith(
      3,
      'medicines:detail:cn:cn_ibuprofen_capsule',
    );
  });

  it('returns zero when the wrapped store does not expose keys', async () => {
    cache.stores = [
      new Keyv({
        store: new KeyvAdapter(createCacheStoreMock()),
      }),
    ] as typeof cache.stores;

    await expect(service.invalidateAll()).resolves.toBe(0);
    expect(cache.del).not.toHaveBeenCalled();
  });

  it('keeps working when the raw store returns unprefixed keys', async () => {
    cache.stores = [
      new Keyv({
        store: new KeyvAdapter(
          createCacheStoreMock({
            keys: vi
              .fn()
              .mockResolvedValue([
                'medicines:search:cn:%E5%B8%83%E6%B4%9B%E8%8A%AC:1:20',
              ]),
          }),
        ),
      }),
    ] as typeof cache.stores;
    cache.del.mockResolvedValue(true);

    await expect(service.invalidateAll()).resolves.toBe(1);
    expect(cache.del).toHaveBeenCalledWith(
      'medicines:search:cn:%E5%B8%83%E6%B4%9B%E8%8A%AC:1:20',
    );
  });
});
