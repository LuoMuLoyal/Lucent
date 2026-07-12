import { Test } from '@nestjs/testing';
import { MedicineSource } from '#generated/prisma/client';
import { UserHealthContextRepositoryPort } from '../repositories';
import { UserHealthContextOwnershipService } from './ownership.service';
import { UserHealthContextMapperService } from './mapper.service';
import { UserHealthContextMedicineWriteService } from './medicine-write.service';

describe('UserHealthContextMedicineWriteService', () => {
  let service: UserHealthContextMedicineWriteService;

  let repository: any;
  let ensureActive: vi.Mock;
  let ensureOwned: vi.Mock;

  beforeEach(async () => {
    repository = {
      createCurrentMedicine: vi.fn(),
      updateCurrentMedicine: vi.fn(),
      softDeleteCurrentMedicine: vi.fn(),
      findCurrentMedicineById: vi.fn(),
    };
    ensureActive = vi.fn();
    ensureOwned = vi.fn();
    const module = await Test.createTestingModule({
      providers: [
        UserHealthContextMedicineWriteService,
        { provide: UserHealthContextRepositoryPort, useValue: repository },
        {
          provide: UserHealthContextOwnershipService,
          useValue: {
            ensureActiveUserExists: ensureActive,
            ensureCurrentMedicineOwnedByUser: ensureOwned,
          },
        },
        {
          provide: UserHealthContextMapperService,
          useValue: {
            dateOnlyStringToUtcDate: vi.fn((v: any) =>
              v ? new Date(v) : null,
            ),
            toUtcDateOnly: vi.fn(() => new Date('2026-06-15T00:00:00Z')),
          },
        },
      ],
    }).compile();
    service = module.get(UserHealthContextMedicineWriteService);
  });

  it('creates manual medicine forces sourceRefId null', async () => {
    await service.create('u1', {
      source: MedicineSource.manual,
      sourceRefId: 'ext-1',
      displayName: '阿莫西林',
    });
    expect(repository.createCurrentMedicine).toHaveBeenCalledWith(
      expect.objectContaining({ sourceRefId: null }),
    );
  });

  it('keeps sourceRefId for non-manual', async () => {
    await service.create('u1', {
      source: MedicineSource.cn,
      sourceRefId: 'ext-1',
      displayName: '阿莫西林',
    });
    expect(repository.createCurrentMedicine).toHaveBeenCalledWith(
      expect.objectContaining({ sourceRefId: 'ext-1' }),
    );
  });

  it('updates', async () => {
    await service.update('u1', 'm1', { displayName: '头孢拉定' });
    expect(ensureOwned).toHaveBeenCalledWith('u1', 'm1');
    expect(repository.updateCurrentMedicine).toHaveBeenCalledWith('m1', {
      displayName: '头孢拉定',
    });
  });

  it('soft-deletes', async () => {
    await service.softDelete('u1', 'm1');
    expect(repository.softDeleteCurrentMedicine).toHaveBeenCalledWith(
      'm1',
      expect.any(Date),
    );
  });
});
