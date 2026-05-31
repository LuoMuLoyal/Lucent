import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import type { Cache } from 'cache-manager';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { MedicinesCacheService } from './medicines-cache.service';

describe('MedicinesCacheService', () => {
  let service: MedicinesCacheService;
  let cache: jest.Mocked<Cache>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MedicinesCacheService,
        {
          provide: CACHE_MANAGER,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(MedicinesCacheService);
    cache = module.get(CACHE_MANAGER);
  });

  it('returns cached search results when present', async () => {
    const cachedValue = {
      items: [{ id: 'DB01050' }],
      pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 },
    };
    const load = jest.fn();
    cache.get.mockResolvedValue(cachedValue);

    const result = await service.getOrSetSearch(
      {
        source: 'drugbank',
        q: 'ibuprofen',
        page: 1,
        pageSize: 10,
      },
      load,
    );

    expect(result).toBe(cachedValue);
    expect(load).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('loads and caches search results on a miss', async () => {
    const loadedValue = {
      items: [{ id: 'cn_ibuprofen_capsule' }],
      pagination: { page: 2, pageSize: 5, total: 7, totalPages: 2 },
    };
    const load = jest.fn().mockResolvedValue(loadedValue);
    cache.get.mockResolvedValue(undefined);
    cache.set.mockResolvedValue(loadedValue);

    const result = await service.getOrSetSearch(
      {
        source: 'cn',
        q: '布洛芬 缓释',
        page: 2,
        pageSize: 5,
      },
      load,
    );

    expect(result).toBe(loadedValue);
    expect(load).toHaveBeenCalledTimes(1);
    expect(cache.get).toHaveBeenCalledWith(
      'medicines:search:cn:%E5%B8%83%E6%B4%9B%E8%8A%AC%20%E7%BC%93%E9%87%8A:2:5',
    );
    expect(cache.set).toHaveBeenCalledWith(
      'medicines:search:cn:%E5%B8%83%E6%B4%9B%E8%8A%AC%20%E7%BC%93%E9%87%8A:2:5',
      loadedValue,
      300_000,
    );
  });

  it('loads and caches detail results on a miss', async () => {
    const loadedValue = {
      id: 'DB01050',
      source: 'drugbank' as const,
      name: 'Ibuprofen',
      subtitle: 'CAS 15687-27-1',
      detail: {
        kind: 'drugbank' as const,
      },
    };
    const load = jest.fn().mockResolvedValue(loadedValue);
    cache.get.mockResolvedValue(undefined);
    cache.set.mockResolvedValue(loadedValue);

    const result = await service.getOrSetDetail('drugbank', 'DB01050', load);

    expect(result).toBe(loadedValue);
    expect(cache.get).toHaveBeenCalledWith('medicines:detail:drugbank:DB01050');
    expect(cache.set).toHaveBeenCalledWith(
      'medicines:detail:drugbank:DB01050',
      loadedValue,
      900_000,
    );
  });
});
