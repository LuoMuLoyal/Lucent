import { NotFoundException } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { Test, type TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../../prisma/prisma.service';
import { MedicineRemindersOwnershipService } from './ownership.service';

describe('MedicineRemindersOwnershipService', () => {
  let service: MedicineRemindersOwnershipService;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: I18nService,
          useValue: {
            t: jest.fn().mockImplementation((key: string) => key),
          },
        },
        MedicineRemindersOwnershipService,
        {
          provide: PrismaService,
          useValue: {
            userCurrentMedicine: { findFirst: jest.fn() },
            userMedicineReminder: { findFirst: jest.fn() },
          },
        },
      ],
    }).compile();

    service = module.get(MedicineRemindersOwnershipService);
    prisma = module.get(PrismaService);
  });

  // ── ensureCurrentMedicineOwnedByUser ──────────────────────────────────

  describe('ensureCurrentMedicineOwnedByUser', () => {
    it('does nothing when currentMedicineId is null', async () => {
      await expect(
        service.ensureCurrentMedicineOwnedByUser('user-1', null),
      ).resolves.toBeUndefined();

      expect(prisma.userCurrentMedicine.findFirst).not.toHaveBeenCalled();
    });

    it('does nothing when currentMedicineId is undefined', async () => {
      await expect(
        service.ensureCurrentMedicineOwnedByUser('user-1', undefined),
      ).resolves.toBeUndefined();

      expect(prisma.userCurrentMedicine.findFirst).not.toHaveBeenCalled();
    });

    it('does not throw when the medicine belongs to the user', async () => {
      (prisma.userCurrentMedicine.findFirst as jest.Mock).mockResolvedValue({
        id: 'med-1',
        userId: 'user-1',
      });

      await expect(
        service.ensureCurrentMedicineOwnedByUser('user-1', 'med-1'),
      ).resolves.toBeUndefined();

      expect(prisma.userCurrentMedicine.findFirst).toHaveBeenCalledWith({
        where: { id: 'med-1', userId: 'user-1', isCurrent: true },
        select: { id: true, userId: true },
      });
    });

    it('throws NotFoundException when the medicine does not exist', async () => {
      (prisma.userCurrentMedicine.findFirst as jest.Mock).mockResolvedValue(
        null,
      );

      await expect(
        service.ensureCurrentMedicineOwnedByUser('user-1', 'missing-med'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the medicine belongs to another user', async () => {
      (prisma.userCurrentMedicine.findFirst as jest.Mock).mockResolvedValue({
        id: 'med-1',
        userId: 'other-user',
      });

      await expect(
        service.ensureCurrentMedicineOwnedByUser('user-1', 'med-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── ensureOwnedByUser ─────────────────────────────────────────────────

  describe('ensureOwnedByUser', () => {
    it('returns the reminder when it belongs to the user', async () => {
      const existing = {
        userId: 'user-1',
        startDate: null,
        endDate: null,
      };
      (prisma.userMedicineReminder.findFirst as jest.Mock).mockResolvedValue(
        existing,
      );

      const result = await service.ensureOwnedByUser('user-1', 'reminder-1');

      expect(result).toEqual(existing);
      expect(prisma.userMedicineReminder.findFirst).toHaveBeenCalledWith({
        where: { id: 'reminder-1', deletedAt: null },
        select: { userId: true, startDate: true, endDate: true },
      });
    });

    it('throws NotFoundException when the reminder does not exist', async () => {
      (prisma.userMedicineReminder.findFirst as jest.Mock).mockResolvedValue(
        null,
      );

      await expect(
        service.ensureOwnedByUser('user-1', 'missing-reminder'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the reminder belongs to another user', async () => {
      (prisma.userMedicineReminder.findFirst as jest.Mock).mockResolvedValue({
        userId: 'other-user',
        startDate: null,
        endDate: null,
      });

      await expect(
        service.ensureOwnedByUser('user-1', 'reminder-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
