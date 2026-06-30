/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Test } from '@nestjs/testing';
import { MedicineSource } from '../../../generated/prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { UserHealthContextOwnershipService } from './ownership.service';
import { UserHealthContextMapperService } from './user-health-context-mapper.service';
import { UserHealthContextMedicineWriteService } from './user-health-context-medicine-write.service';
import type { CreateCurrentMedicineDto } from '../dto';

describe('UserHealthContextMedicineWriteService', () => {
  let service: UserHealthContextMedicineWriteService;
  let createMedicine: jest.Mock;
  let updateMedicine: jest.Mock;
  let findUniqueMedicine: jest.Mock;
  let ensureActiveUserExists: jest.Mock;
  let ensureMedicineOwned: jest.Mock;
  let dateOnlyStringToUtcDate: jest.Mock;
  let toUtcDateOnly: jest.Mock;

  beforeEach(async () => {
    createMedicine = jest.fn();
    updateMedicine = jest.fn();
    findUniqueMedicine = jest.fn();
    ensureActiveUserExists = jest.fn();
    ensureMedicineOwned = jest.fn();
    dateOnlyStringToUtcDate = jest.fn((v: string | null) =>
      v ? new Date(v) : null,
    );
    toUtcDateOnly = jest.fn(() => new Date('2026-06-15T00:00:00Z'));

    const module = await Test.createTestingModule({
      providers: [
        UserHealthContextMedicineWriteService,
        {
          provide: PrismaService,
          useValue: {
            userCurrentMedicine: {
              create: createMedicine,
              update: updateMedicine,
              findUnique: findUniqueMedicine,
            },
          },
        },
        {
          provide: UserHealthContextOwnershipService,
          useValue: {
            ensureActiveUserExists,
            ensureCurrentMedicineOwnedByUser: ensureMedicineOwned,
          },
        },
        {
          provide: UserHealthContextMapperService,
          useValue: { dateOnlyStringToUtcDate, toUtcDateOnly },
        },
      ],
    }).compile();

    service = module.get(UserHealthContextMedicineWriteService);
  });

  const baseDto: CreateCurrentMedicineDto = {
    source: MedicineSource.manual,
    sourceRefId: 'ext-1',
    displayName: '阿莫西林',
    strengthText: '500mg',
    doseText: '每日三次',
    route: '口服',
    startedAt: '2025-01-01',
    endedAt: null,
    note: null,
  };

  describe('create', () => {
    it('creates a medicine with full fields', async () => {
      await service.create('u1', baseDto);

      expect(ensureActiveUserExists).toHaveBeenCalledWith('u1');
      expect(createMedicine).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'u1',
          source: MedicineSource.manual,
          displayName: '阿莫西林',
        }),
      });
    });

    it('forces sourceRefId to null for manual source', async () => {
      await service.create('u1', baseDto);
      expect(createMedicine).toHaveBeenCalledWith({
        data: expect.objectContaining({ sourceRefId: null }),
      });
    });

    it('keeps sourceRefId for non-manual source', async () => {
      const nonManualDto: CreateCurrentMedicineDto = {
        source: MedicineSource.cn_drug_database,
        sourceRefId: 'ext-1',
        displayName: '阿莫西林',
        strengthText: '500mg',
        doseText: '每日三次',
        route: '口服',
        startedAt: '2025-01-01',
        endedAt: null,
        note: null,
      };
      await service.create('u1', nonManualDto);
      expect(createMedicine).toHaveBeenCalledWith({
        data: expect.objectContaining({ sourceRefId: 'ext-1' }),
      });
    });
  });

  describe('update', () => {
    it('verifies ownership then updates with partial fields', async () => {
      await service.update('u1', 'm1', {
        displayName: '头孢拉定',
      });

      expect(ensureMedicineOwned).toHaveBeenCalledWith('u1', 'm1');
      expect(updateMedicine).toHaveBeenCalledWith({
        where: { id: 'm1' },
        data: { displayName: '头孢拉定' },
      });
    });
  });

  describe('softDelete', () => {
    it('preserves existing endedAt when already set', async () => {
      const existingDate = new Date('2025-06-01');
      findUniqueMedicine.mockResolvedValue({ endedAt: existingDate });

      await service.softDelete('u1', 'm1');

      expect(updateMedicine).toHaveBeenCalledWith({
        where: { id: 'm1' },
        data: { isCurrent: false, endedAt: existingDate },
      });
    });

    it('sets endedAt to current date when not previously ended', async () => {
      findUniqueMedicine.mockResolvedValue({ endedAt: null });

      await service.softDelete('u1', 'm1');

      expect(updateMedicine).toHaveBeenCalledWith({
        where: { id: 'm1' },
        data: expect.objectContaining({ isCurrent: false }),
      });
    });
  });
});
