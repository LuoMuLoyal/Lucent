import type { DeepMocked } from '../../../../common/types/deep-mocked.js';
import { Prisma } from '#generated/prisma/client.js';
import type {
  DomainFailure,
  ResultAsync,
} from '../../../../common/result/index.js';

import { PrismaReminders } from './reminders.js';
import { PrismaTransactionRunner } from '../../../../common/index.js';
import type { PrismaService } from '../../../../prisma/index.js';

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

describe('PrismaReminders', () => {
  let repository: PrismaReminders;
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
        findMany: vi.fn(),
      },
      // Read for the half-life join on `listCurrentMedicines`.
      drugbankDrug: {
        findMany: vi.fn(),
      },
      $transaction: vi.fn(),
    } as unknown as DeepMocked<PrismaService>;

    repository = new PrismaReminders(
      prisma,
      new PrismaTransactionRunner(prisma),
    );
  });

  describe('listActiveFacts (reader port)', () => {
    it('selects the reminder id, which consumers use as the slot key', async () => {
      // Regression guard: `suggestion` keys medication slots by
      // `reminder.id`. Dropping it from the select makes the facts unusable
      // there, and the failure surfaces only at the consumer, not here.
      prisma.userMedicineReminder.findMany.mockResolvedValue([] as never);

      await repository.listActiveFacts('user-1');

      expect(prisma.userMedicineReminder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({ id: true }),
        }),
      );
    });
  });

  describe('listCurrentMedicines (reader port)', () => {
    it('reads only current medicines, oldest-first, capped', async () => {
      prisma.userCurrentMedicine.findMany.mockResolvedValue([] as never);

      await repository.listCurrentMedicines('user-1');

      expect(prisma.userCurrentMedicine.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', isCurrent: true },
        // `source`/`sourceRefId` are selected because the half-life join needs
        // them: only a `drugbank` row's `sourceRefId` is a DrugBank ID.
        select: {
          id: true,
          displayName: true,
          source: true,
          sourceRefId: true,
        },
        orderBy: [{ createdAt: 'asc' }],
        take: 500,
      });
    });

    it('resolves half_life for drugbank entries only', async () => {
      // `sourceRefId` is only a DrugBank ID when `source = 'drugbank'`; a `cn`
      // product id that happens to collide must not inherit its half-life.
      prisma.userCurrentMedicine.findMany.mockResolvedValue([
        {
          id: 'med-1',
          displayName: 'Aspirin',
          source: 'drugbank',
          sourceRefId: 'DB00945',
        },
        {
          id: 'med-2',
          displayName: 'Local product',
          source: 'cn',
          sourceRefId: 'DB00945',
        },
        {
          id: 'med-3',
          displayName: 'Manual entry',
          source: 'manual',
          sourceRefId: null,
        },
      ] as never);
      prisma.drugbankDrug.findMany.mockResolvedValue([
        { drugbankId: 'DB00945', halfLife: '3 hours' },
      ] as never);

      const result = await repository.listCurrentMedicines('user-1');

      expect(result).toEqual([
        { id: 'med-1', displayName: 'Aspirin', halfLife: '3 hours' },
        { id: 'med-2', displayName: 'Local product', halfLife: null },
        { id: 'med-3', displayName: 'Manual entry', halfLife: null },
      ]);
    });

    it('skips the knowledge query when nothing is drugbank-sourced', async () => {
      prisma.userCurrentMedicine.findMany.mockResolvedValue([
        {
          id: 'med-1',
          displayName: 'Manual',
          source: 'manual',
          sourceRefId: null,
        },
      ] as never);

      const result = await repository.listCurrentMedicines('user-1');

      expect(prisma.drugbankDrug.findMany).not.toHaveBeenCalled();
      expect(result).toEqual([
        { id: 'med-1', displayName: 'Manual', halfLife: null },
      ]);
    });

    it('reports null when the catalogued drug records no half-life', async () => {
      prisma.userCurrentMedicine.findMany.mockResolvedValue([
        {
          id: 'med-1',
          displayName: 'Aspirin',
          source: 'drugbank',
          sourceRefId: 'DB00945',
        },
      ] as never);
      prisma.drugbankDrug.findMany.mockResolvedValue([
        { drugbankId: 'DB00945', halfLife: null },
      ] as never);

      const result = await repository.listCurrentMedicines('user-1');

      expect(result[0]?.halfLife).toBeNull();
    });
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
