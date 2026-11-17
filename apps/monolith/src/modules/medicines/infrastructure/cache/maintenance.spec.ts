import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import type { Cache } from 'cache-manager';
import type { CacheManagerStore } from 'cache-manager';
import Keyv from 'keyv';
import { KeyvAdapter } from 'cache-manager';
import { MedicinesCacheMaintenanceService } from './maintenance.js';

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

describe('MedicinesCacheMaintenanceService', () => {
  let service: MedicinesCacheMaintenanceService;
  let cache: vi.Mocked<Cache>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MedicinesCacheMaintenanceService,
        {
          provide: CACHE_MANAGER,
          useValue: {
            del: vi.fn(),
            stores: [],
          },
        },
      ],
    }).compile();

    service = module.get(MedicinesCacheMaintenanceService);
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

  it('logs a warning when no stores are available', async () => {
    cache.stores = [] as typeof cache.stores;
    const logger = (service as unknown as { logger: { warn: vi.Mock } }).logger;
    const warnSpy = vi.spyOn(logger, 'warn');

    await expect(service.invalidateAll()).resolves.toBe(0);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('no stores available'),
    );
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

  it('scans a @keyv/redis store through its node-redis client', async () => {
    const scan = vi
      .fn()
      .mockResolvedValue([
        'medicines:detail:drugbank:DB01050',
        'auth:verification:test@example.com',
      ]);
    cache.stores = [
      { store: { client: { keys: scan } } },
    ] as unknown as typeof cache.stores;
    cache.del.mockResolvedValue(true);

    await expect(service.invalidateAll()).resolves.toBe(1);
    expect(scan).toHaveBeenCalledWith('medicines:*');
    expect(cache.del).toHaveBeenCalledWith('medicines:detail:drugbank:DB01050');
  });

  it('warns and skips a store exposing neither keys() nor a Redis client', async () => {
    cache.stores = [{ store: {} }] as unknown as typeof cache.stores;
    const logger = (service as unknown as { logger: { warn: vi.Mock } }).logger;
    const warnSpy = vi.spyOn(logger, 'warn');

    await expect(service.invalidateAll()).resolves.toBe(0);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('neither keys() nor a Redis client'),
    );
  });

  it('Redis 客户端已关闭时降级为 warn，不把调用方的写入打成 500', async () => {
    // 生产形态：@keyv/redis 的 node-redis 客户端断开后所有命令都抛
    // `The client is closed`。那是依赖不可用，不是写入失败——曾经让
    // POST /admin/content/safety-tips 变成 500。
    const closed = vi.fn().mockRejectedValue(new Error('The client is closed'));
    cache.stores = [
      { store: { client: { keys: closed } } },
    ] as unknown as typeof cache.stores;
    const logger = (service as unknown as { logger: { warn: vi.Mock } }).logger;
    const warnSpy = vi.spyOn(logger, 'warn');

    await expect(service.invalidateAll()).resolves.toBe(0);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('The client is closed'),
    );
    expect(cache.del).not.toHaveBeenCalled();
  });

  it('个别键删除失败时返回实际删除数，而不是整体失败', async () => {
    cache.stores = [
      {
        store: {
          client: {
            keys: vi
              .fn()
              .mockResolvedValue([
                'medicines:detail:drugbank:DB01050',
                'medicines:detail:cn:cn_ibuprofen_capsule',
              ]),
          },
        },
      },
    ] as unknown as typeof cache.stores;
    cache.del
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('The client is closed'));
    const logger = (service as unknown as { logger: { warn: vi.Mock } }).logger;
    const warnSpy = vi.spyOn(logger, 'warn');

    await expect(service.invalidateAll()).resolves.toBe(1);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('1/2 keys could not be deleted'),
    );
  });
});
