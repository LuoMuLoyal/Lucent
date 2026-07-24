import { NotFoundException } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { Test, type TestingModule } from '@nestjs/testing';

import { MedicineReminderRepositoryPort } from '../repositories/reminder.repository';
import { MedicineRemindersOwnershipService } from './ownership.service';

describe('MedicineRemindersOwnershipService', () => {
  let service: MedicineRemindersOwnershipService;
  let repository: {
    findCurrentMedicine: vi.Mock;
    findReminderById: vi.Mock;
  };

  beforeEach(async () => {
    repository = {
      findCurrentMedicine: vi.fn(),
      findReminderById: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MedicineRemindersOwnershipService,
        {
          provide: MedicineReminderRepositoryPort,
          useValue: repository,
        },
        {
          provide: I18nService,
          useValue: {
            t: vi.fn().mockImplementation((key: string) => key),
          },
        },
      ],
    }).compile();

    service = module.get(MedicineRemindersOwnershipService);
  });

  // ── ensureCurrentMedicineOwnedByUser ──────────────────────────────────

  describe('ensureCurrentMedicineOwnedByUser', () => {
    it('does nothing when currentMedicineId is null', async () => {
      await expect(
        service.ensureCurrentMedicineOwnedByUser('user-1', null),
      ).resolves.toBeUndefined();

      expect(repository.findCurrentMedicine).not.toHaveBeenCalled();
    });

    it('does nothing when currentMedicineId is undefined', async () => {
      await expect(
        service.ensureCurrentMedicineOwnedByUser('user-1', undefined),
      ).resolves.toBeUndefined();

      expect(repository.findCurrentMedicine).not.toHaveBeenCalled();
    });

    it('does not throw when the medicine belongs to the user', async () => {
      repository.findCurrentMedicine.mockResolvedValue({
        id: 'med-1',
        userId: 'user-1',
      });

      await expect(
        service.ensureCurrentMedicineOwnedByUser('user-1', 'med-1'),
      ).resolves.toBeUndefined();

      expect(repository.findCurrentMedicine).toHaveBeenCalledWith(
        'med-1',
        'user-1',
      );
    });

    it('throws NotFoundException when the medicine does not exist', async () => {
      repository.findCurrentMedicine.mockResolvedValue(null);

      await expect(
        service.ensureCurrentMedicineOwnedByUser('user-1', 'missing-med'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the medicine belongs to another user', async () => {
      repository.findCurrentMedicine.mockResolvedValue({
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
      repository.findReminderById.mockResolvedValue(existing);

      const result = await service.ensureOwnedByUser('user-1', 'reminder-1');

      expect(result).toEqual(existing);
      expect(repository.findReminderById).toHaveBeenCalledWith('reminder-1', {
        userId: true,
        startDate: true,
        endDate: true,
      });
    });

    it('throws NotFoundException when the reminder does not exist', async () => {
      repository.findReminderById.mockResolvedValue(null);

      await expect(
        service.ensureOwnedByUser('user-1', 'missing-reminder'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the reminder belongs to another user', async () => {
      repository.findReminderById.mockResolvedValue({
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
