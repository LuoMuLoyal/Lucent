import { Test, type TestingModule } from '@nestjs/testing';
import type {
  DomainFailure,
  ResultAsync,
} from '../../../common/result/index.js';

import { MedicineReminderRepositoryPort } from '../repositories/reminder.repository.js';
import { MedicineRemindersOwnershipService } from './ownership.service.js';

async function collectResult<T>(
  result: ResultAsync<T, DomainFailure>,
): Promise<{ ok: true; value: T } | { ok: false; error: DomainFailure }> {
  return result.match(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );
}

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
      ],
    }).compile();

    service = module.get(MedicineRemindersOwnershipService);
  });

  // ── ensureCurrentMedicineOwnedByUser ──────────────────────────────────

  describe('ensureCurrentMedicineOwnedByUser', () => {
    it('does nothing when currentMedicineId is null', async () => {
      const result = await collectResult(
        service.ensureCurrentMedicineOwnedByUser('user-1', null),
      );

      expect(result.ok).toBe(true);
      expect(repository.findCurrentMedicine).not.toHaveBeenCalled();
    });

    it('does nothing when currentMedicineId is undefined', async () => {
      const result = await collectResult(
        service.ensureCurrentMedicineOwnedByUser('user-1', undefined),
      );

      expect(result.ok).toBe(true);
      expect(repository.findCurrentMedicine).not.toHaveBeenCalled();
    });

    it('succeeds when the medicine belongs to the user', async () => {
      repository.findCurrentMedicine.mockResolvedValue({
        id: 'med-1',
        userId: 'user-1',
      });

      const result = await collectResult(
        service.ensureCurrentMedicineOwnedByUser('user-1', 'med-1'),
      );

      expect(result.ok).toBe(true);
      expect(repository.findCurrentMedicine).toHaveBeenCalledWith(
        'med-1',
        'user-1',
      );
    });

    it('maps a missing medicine to RESOURCE_NOT_FOUND', async () => {
      repository.findCurrentMedicine.mockResolvedValue(null);

      const result = await collectResult(
        service.ensureCurrentMedicineOwnedByUser('user-1', 'missing-med'),
      );

      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'not_found', code: 'RESOURCE_NOT_FOUND' },
      });
    });

    it('maps a medicine owned by another user to RESOURCE_NOT_FOUND', async () => {
      repository.findCurrentMedicine.mockResolvedValue({
        id: 'med-1',
        userId: 'other-user',
      });

      const result = await collectResult(
        service.ensureCurrentMedicineOwnedByUser('user-1', 'med-1'),
      );

      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'not_found', code: 'RESOURCE_NOT_FOUND' },
      });
    });

    it('rethrows unknown database errors', async () => {
      repository.findCurrentMedicine.mockRejectedValue(
        new Error('connection lost'),
      );

      await expect(
        service.ensureCurrentMedicineOwnedByUser('user-1', 'med-1'),
      ).rejects.toThrow('connection lost');
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

      const result = await collectResult(
        service.ensureOwnedByUser('user-1', 'reminder-1'),
      );

      expect(result).toMatchObject({ ok: true, value: existing });
      expect(repository.findReminderById).toHaveBeenCalledWith('reminder-1', {
        userId: true,
        startDate: true,
        endDate: true,
      });
    });

    it('maps a missing reminder to RESOURCE_NOT_FOUND', async () => {
      repository.findReminderById.mockResolvedValue(null);

      const result = await collectResult(
        service.ensureOwnedByUser('user-1', 'missing-reminder'),
      );

      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'not_found', code: 'RESOURCE_NOT_FOUND' },
      });
    });

    it('maps a foreign reminder to FORBIDDEN', async () => {
      repository.findReminderById.mockResolvedValue({
        userId: 'other-user',
        startDate: null,
        endDate: null,
      });

      const result = await collectResult(
        service.ensureOwnedByUser('user-1', 'reminder-1'),
      );

      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'authorization', code: 'FORBIDDEN' },
      });
    });

    it('rethrows unknown database errors', async () => {
      repository.findReminderById.mockRejectedValue(
        new Error('connection lost'),
      );

      await expect(
        service.ensureOwnedByUser('user-1', 'reminder-1'),
      ).rejects.toThrow('connection lost');
    });
  });
});
