import type { DeepMocked } from '../../../common/types/deep-mocked';
import { Prisma } from '#generated/prisma/client';
import type { DomainFailure, ResultAsync } from '../../../common/result';

import { MedicineReminderRepository } from './reminder.repository';
import type { PrismaService } from '../../../prisma';

function prismaError(code: string): Prisma.PrismaClientKnownRequestError {
  const error = Object.create(
    Prisma.PrismaClientKnownRequestError.prototype,
  ) as Prisma.PrismaClientKnownRequestError;
  error.code = code;
  return error;
}

async function collectResult<T>(
  result: ResultAsync<T, DomainFailure>,
): Promise<{ ok: true; value: T } | { ok: false; error: DomainFailure }> {
  return result.match(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );
}

describe('MedicineReminderRepository', () => {
  let repository: MedicineReminderRepository;
  let prisma: DeepMocked<PrismaService>;

  beforeEach(() => {
    prisma = {
      userMedicineReminder: {
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        findFirst: vi.fn(),
      },
      nonDeleted: {
        userMedicineReminder: {
          findFirst: vi.fn(),
        },
      },
      userReminderDelivery: {
        findMany: vi.fn(),
      },
      userCurrentMedicine: {
        findFirst: vi.fn(),
      },
      $transaction: vi.fn(),
    } as unknown as DeepMocked<PrismaService>;

    repository = new MedicineReminderRepository(prisma);
  });

  describe('findManyReminders', () => {
    it('queries with where clause', async () => {
      prisma.userMedicineReminder.findMany.mockResolvedValue([] as never);

      await repository.findManyReminders({ userId: 'user-1' } as never);

      expect(prisma.userMedicineReminder.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
    });

    it('includes orderBy when provided', async () => {
      prisma.userMedicineReminder.findMany.mockResolvedValue([] as never);

      const orderBy = [{ scheduledHour: 'asc' as const }];
      await repository.findManyReminders(
        { userId: 'user-1' } as never,
        orderBy,
      );

      expect(prisma.userMedicineReminder.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy,
      });
    });
  });

  describe('createReminder', () => {
    it('creates with provided data', async () => {
      const data = { userId: 'user-1', label: 'Morning', scheduledHour: 8 };
      prisma.userMedicineReminder.create.mockResolvedValue({
        id: 'rem-1',
        ...data,
      } as never);

      const result = await collectResult(
        repository.createReminder(data as never),
      );

      expect(result).toMatchObject({
        ok: true,
        value: { id: 'rem-1', label: 'Morning' },
      });
      expect(prisma.userMedicineReminder.create).toHaveBeenCalledWith({ data });
    });

    it('maps a unique constraint violation to RESOURCE_CONFLICT', async () => {
      prisma.userMedicineReminder.create.mockRejectedValue(
        prismaError('P2002'),
      );

      const result = await collectResult(
        repository.createReminder({ userId: 'user-1' } as never),
      );

      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'conflict', code: 'RESOURCE_CONFLICT' },
      });
    });

    it('rethrows unknown database errors', async () => {
      prisma.userMedicineReminder.create.mockRejectedValue(
        new Error('connection lost'),
      );

      await expect(
        repository.createReminder({ userId: 'user-1' } as never),
      ).rejects.toThrow('connection lost');
    });
  });

  describe('updateReminder', () => {
    it('updates with where and data', async () => {
      const where = { id: 'rem-1' };
      const data = { label: 'Updated' };
      prisma.userMedicineReminder.update.mockResolvedValue({
        id: 'rem-1',
        label: 'Updated',
      } as never);

      const result = await collectResult(
        repository.updateReminder(where as never, data as never),
      );

      expect(result).toMatchObject({
        ok: true,
        value: { id: 'rem-1', label: 'Updated' },
      });
      expect(prisma.userMedicineReminder.update).toHaveBeenCalledWith({
        where,
        data,
      });
    });

    it('maps a missing record to RESOURCE_NOT_FOUND', async () => {
      prisma.userMedicineReminder.update.mockRejectedValue(
        prismaError('P2025'),
      );

      const result = await collectResult(
        repository.updateReminder({ id: 'missing' } as never, {} as never),
      );

      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'not_found', code: 'RESOURCE_NOT_FOUND' },
      });
    });

    it('rethrows unknown database errors', async () => {
      prisma.userMedicineReminder.update.mockRejectedValue(
        new Error('connection lost'),
      );

      await expect(
        repository.updateReminder({ id: 'rem-1' } as never, {} as never),
      ).rejects.toThrow('connection lost');
    });
  });

  describe('findManyDeliveries', () => {
    it('queries with where clause', async () => {
      prisma.userReminderDelivery.findMany.mockResolvedValue([] as never);

      await repository.findManyDeliveries({ reminderId: 'rem-1' } as never);

      expect(prisma.userReminderDelivery.findMany).toHaveBeenCalledWith({
        where: { reminderId: 'rem-1' },
      });
    });

    it('includes orderBy and take when provided', async () => {
      prisma.userReminderDelivery.findMany.mockResolvedValue([] as never);

      await repository.findManyDeliveries(
        { reminderId: 'rem-1' } as never,
        [{ deliveredAt: 'desc' as const }],
        10,
      );

      expect(prisma.userReminderDelivery.findMany).toHaveBeenCalledWith({
        where: { reminderId: 'rem-1' },
        orderBy: [{ deliveredAt: 'desc' }],
        take: 10,
      });
    });
  });

  describe('findReminderById', () => {
    it('queries with id and nonDeleted filter', async () => {
      prisma.nonDeleted.userMedicineReminder.findFirst.mockResolvedValue(null);

      await repository.findReminderById('rem-1', { id: true } as never);

      expect(
        prisma.nonDeleted.userMedicineReminder.findFirst,
      ).toHaveBeenCalledWith({
        where: { id: 'rem-1' },
        select: { id: true },
      });
    });
  });

  describe('findCurrentMedicine', () => {
    it('queries by id, userId, and isCurrent', async () => {
      prisma.userCurrentMedicine.findFirst.mockResolvedValue({
        id: 'med-1',
        userId: 'user-1',
      } as never);

      const result = await repository.findCurrentMedicine('med-1', 'user-1');

      expect(result).toMatchObject({ id: 'med-1', userId: 'user-1' });
      expect(prisma.userCurrentMedicine.findFirst).toHaveBeenCalledWith({
        where: { id: 'med-1', userId: 'user-1', isCurrent: true },
        select: { id: true, userId: true },
      });
    });

    it('returns null when not found', async () => {
      prisma.userCurrentMedicine.findFirst.mockResolvedValue(null);
      expect(
        await repository.findCurrentMedicine('missing', 'user-1'),
      ).toBeNull();
    });
  });

  describe('transaction', () => {
    it('delegates to prisma.$transaction', async () => {
      const txFn = vi.fn().mockResolvedValue('result');
      prisma.$transaction.mockImplementation(
        (_fn: never) => txFn() as Promise<string>,
      );

      const result = await repository.transaction(txFn as never);

      expect(result).toBe('result');
      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });
});
