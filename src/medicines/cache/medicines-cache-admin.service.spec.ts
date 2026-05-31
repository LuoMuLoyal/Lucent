import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import type { Cache } from 'cache-manager';
import { MedicinesCacheAdminService } from './medicines-cache-admin.service';

describe('MedicinesCacheAdminService', () => {
  let service: MedicinesCacheAdminService;
  let cache: jest.Mocked<Cache>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MedicinesCacheAdminService,
        {
          provide: CACHE_MANAGER,
          useValue: {
            del: jest.fn(),
            stores: [],
          },
        },
      ],
    }).compile();

    service = module.get(MedicinesCacheAdminService);
    cache = module.get(CACHE_MANAGER);
  });

  it('removes all medicines cache keys across stores', async () => {
    cache.stores = [
      {
        keys: jest
          .fn()
          .mockResolvedValue([
            'medicines:search:drugbank:ibuprofen:1:20',
            'medicines:detail:drugbank:DB01050',
            'auth:verification:test@example.com',
          ]),
      },
      {
        keys: jest
          .fn()
          .mockResolvedValue(['medicines:detail:cn:cn_ibuprofen_capsule']),
      },
    ] as typeof cache.stores;
    cache.del.mockResolvedValue(true);

    await expect(service.invalidateAll()).resolves.toBe(3);
    expect(cache.del).toHaveBeenCalledTimes(3);
  });

  it('returns zero when cache stores do not expose keys', async () => {
    cache.stores = [{}] as typeof cache.stores;

    await expect(service.invalidateAll()).resolves.toBe(0);
    expect(cache.del).not.toHaveBeenCalled();
  });
});
