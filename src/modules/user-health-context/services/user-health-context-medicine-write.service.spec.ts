import { Test } from '@nestjs/testing';
import { MedicineSource } from '#generated/prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { UserHealthContextOwnershipService } from './ownership.service';
import { UserHealthContextMapperService } from './user-health-context-mapper.service';
import { UserHealthContextMedicineWriteService } from './user-health-context-medicine-write.service';

describe('UserHealthContextMedicineWriteService', () => {
  let service: UserHealthContextMedicineWriteService;
  let createMed: jest.Mock;
  let updateMed: jest.Mock;
  let findUniqueMed: jest.Mock;
  let ensureActive: jest.Mock;
  let ensureOwned: jest.Mock;

  beforeEach(async () => {
    createMed = jest.fn();
    updateMed = jest.fn();
    findUniqueMed = jest.fn();
    ensureActive = jest.fn();
    ensureOwned = jest.fn();
    const module = await Test.createTestingModule({
      providers: [
        UserHealthContextMedicineWriteService,
        {
          provide: PrismaService,
          useValue: {
            userCurrentMedicine: {
              create: createMed,
              update: updateMed,
              findUnique: findUniqueMed,
            },
          },
        },
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
            dateOnlyStringToUtcDate: jest.fn((v: any) =>
              v ? new Date(v) : null,
            ),
            toUtcDateOnly: jest.fn(() => new Date('2026-06-15T00:00:00Z')),
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
    expect(createMed).toHaveBeenCalledWith({
      data: expect.objectContaining({ sourceRefId: null }),
    });
  });

  it('keeps sourceRefId for non-manual', async () => {
    await service.create('u1', {
      source: MedicineSource.cn,
      sourceRefId: 'ext-1',
      displayName: '阿莫西林',
    });
    expect(createMed).toHaveBeenCalledWith({
      data: expect.objectContaining({ sourceRefId: 'ext-1' }),
    });
  });

  it('updates', async () => {
    await service.update('u1', 'm1', { displayName: '头孢拉定' });
    expect(ensureOwned).toHaveBeenCalledWith('u1', 'm1');
    expect(updateMed).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { displayName: '头孢拉定' },
    });
  });

  it('soft-deletes', async () => {
    findUniqueMed.mockResolvedValue({ endedAt: null });
    await service.softDelete('u1', 'm1');
    expect(updateMed).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: expect.objectContaining({ isCurrent: false }),
    });
  });
});
