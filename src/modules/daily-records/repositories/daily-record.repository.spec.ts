import type { DeepMocked } from '../../../common/types/deep-mocked';
import { Prisma } from '#generated/prisma/client';
import type { DomainFailure, ResultAsync } from '../../../common/result';

import { DailyRecordRepository } from './daily-record.repository';
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

describe('DailyRecordRepository', () => {
  let repository: DailyRecordRepository;
  let prisma: DeepMocked<PrismaService>;

  beforeEach(() => {
    prisma = {
      userDailyRecord: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      $transaction: vi.fn(),
    } as unknown as DeepMocked<PrismaService>;

    repository = new DailyRecordRepository(prisma);
  });

  describe('findManyWithAttachments', () => {
    it('returns paginated items with total count', async () => {
      const items = [{ id: 'rec-1' }];
      prisma.userDailyRecord.findMany.mockResolvedValue(items as never);
      prisma.userDailyRecord.count.mockResolvedValue(1);

      const result = await repository.findManyWithAttachments(
        { userId: 'user-1', occurredAt: new Date('2026-07-10') },
        { page: 1, pageSize: 20 },
      );

      expect(result.items).toEqual(items);
      expect(result.total).toBe(1);
    });

    it('includes kind filter when provided', async () => {
      prisma.userDailyRecord.findMany.mockResolvedValue([] as never);
      prisma.userDailyRecord.count.mockResolvedValue(0);

      await repository.findManyWithAttachments(
        { userId: 'user-1', occurredAt: new Date('2026-07-10'), kind: 'water' },
        { page: 1, pageSize: 10 },
      );

      const findManyCall = prisma.userDailyRecord.findMany.mock.calls[0]?.[0];
      expect(findManyCall?.where).toHaveProperty('kind', 'water');
    });

    it('calculates skip correctly', async () => {
      prisma.userDailyRecord.findMany.mockResolvedValue([] as never);
      prisma.userDailyRecord.count.mockResolvedValue(0);

      await repository.findManyWithAttachments(
        { userId: 'user-1', occurredAt: new Date('2026-07-10') },
        { page: 3, pageSize: 20 },
      );

      const findManyCall = prisma.userDailyRecord.findMany.mock.calls[0]?.[0];
      expect(findManyCall?.skip).toBe(40);
      expect(findManyCall?.take).toBe(20);
    });

    it('filters out deleted records', async () => {
      prisma.userDailyRecord.findMany.mockResolvedValue([] as never);
      prisma.userDailyRecord.count.mockResolvedValue(0);

      await repository.findManyWithAttachments(
        { userId: 'user-1', occurredAt: new Date('2026-07-10') },
        { page: 1, pageSize: 10 },
      );

      const findManyCall = prisma.userDailyRecord.findMany.mock.calls[0]?.[0];
      expect(findManyCall?.where).toHaveProperty('deletedAt', null);
    });
  });

  describe('findByIdWithAttachments', () => {
    it('queries by id and userId', async () => {
      const record = { id: 'rec-1' };
      prisma.userDailyRecord.findFirst.mockResolvedValue(record as never);

      const result = await repository.findByIdWithAttachments(
        'user-1',
        'rec-1',
      );

      expect(result).toBe(record);
      expect(prisma.userDailyRecord.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'rec-1', userId: 'user-1', deletedAt: null },
        }),
      );
    });

    it('returns null when not found', async () => {
      prisma.userDailyRecord.findFirst.mockResolvedValue(null);

      const result = await repository.findByIdWithAttachments(
        'user-1',
        'missing',
      );
      expect(result).toBeNull();
    });
  });

  describe('findOwnershipData', () => {
    it('selects userId, kind, and payload', async () => {
      prisma.userDailyRecord.findFirst.mockResolvedValue({
        userId: 'user-1',
        kind: 'water',
        payload: {},
      } as never);

      const result = await repository.findOwnershipData('rec-1');

      expect(result).not.toBeNull();
      expect(prisma.userDailyRecord.findFirst).toHaveBeenCalledWith({
        where: { id: 'rec-1', deletedAt: null },
        select: { userId: true, kind: true, payload: true, occurredAt: true },
      });
    });

    it('returns null when not found', async () => {
      prisma.userDailyRecord.findFirst.mockResolvedValue(null);
      expect(await repository.findOwnershipData('missing')).toBeNull();
    });
  });

  describe('findManyByDateWithAttachments', () => {
    it('queries by userId and occurredAt', async () => {
      prisma.userDailyRecord.findMany.mockResolvedValue([] as never);

      await repository.findManyByDateWithAttachments(
        'user-1',
        new Date('2026-07-10'),
      );

      const call = prisma.userDailyRecord.findMany.mock.calls[0]?.[0];
      expect(call?.where).toMatchObject({
        userId: 'user-1',
        occurredAt: new Date('2026-07-10'),
        deletedAt: null,
      });
    });
  });

  describe('listFactsInRange (DailyRecordReaderPort)', () => {
    it('queries non-deleted records in range with canonical order', async () => {
      const from = new Date('2026-07-01');
      const to = new Date('2026-07-07');
      prisma.userDailyRecord.findMany.mockResolvedValue([] as never);

      await repository.listFactsInRange('user-1', from, to);

      expect(prisma.userDailyRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: 'user-1',
            deletedAt: null,
            occurredAt: { gte: from, lte: to },
          },
          orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
        }),
      );
    });

    it('adds kind IN filter when kinds are provided', async () => {
      prisma.userDailyRecord.findMany.mockResolvedValue([] as never);

      await repository.listFactsInRange(
        'user-1',
        new Date('2026-07-01'),
        new Date('2026-07-07'),
        ['water'],
      );

      const call = prisma.userDailyRecord.findMany.mock.calls[0]?.[0];
      expect(call?.where).toHaveProperty('kind', { in: ['water'] });
    });

    it('omits kind filter when kinds is empty', async () => {
      prisma.userDailyRecord.findMany.mockResolvedValue([] as never);

      await repository.listFactsInRange(
        'user-1',
        new Date('2026-07-01'),
        new Date('2026-07-07'),
        [],
      );

      const call = prisma.userDailyRecord.findMany.mock.calls[0]?.[0];
      expect(call?.where).not.toHaveProperty('kind');
    });
  });

  describe('countFactsInRange (DailyRecordReaderPort)', () => {
    it('counts non-deleted records in range', async () => {
      const from = new Date('2026-07-01');
      const to = new Date('2026-07-07');
      prisma.userDailyRecord.count.mockResolvedValue(4);

      await expect(
        repository.countFactsInRange('user-1', from, to),
      ).resolves.toBe(4);

      expect(prisma.userDailyRecord.count).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          deletedAt: null,
          occurredAt: { gte: from, lte: to },
        },
      });
    });

    it('adds kind IN filter when kinds are provided', async () => {
      prisma.userDailyRecord.count.mockResolvedValue(2);

      await repository.countFactsInRange(
        'user-1',
        new Date('2026-07-01'),
        new Date('2026-07-07'),
        ['symptom'],
      );

      const call = prisma.userDailyRecord.count.mock.calls[0]?.[0];
      expect(call?.where).toHaveProperty('kind', { in: ['symptom'] });
    });
  });

  describe('findLatestCreatedAtInRange (DailyRecordReaderPort)', () => {
    it('returns the latest createdAt in range', async () => {
      const createdAt = new Date('2026-07-05T08:00:00.000Z');
      prisma.userDailyRecord.findFirst.mockResolvedValue({
        createdAt,
      } as never);

      await expect(
        repository.findLatestCreatedAtInRange(
          'user-1',
          new Date('2026-07-01'),
          new Date('2026-07-07'),
        ),
      ).resolves.toEqual(createdAt);

      expect(prisma.userDailyRecord.findFirst).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          deletedAt: null,
          occurredAt: {
            gte: new Date('2026-07-01'),
            lte: new Date('2026-07-07'),
          },
        },
        select: { createdAt: true },
        orderBy: [{ createdAt: 'desc' }],
      });
    });

    it('returns null when no records exist', async () => {
      prisma.userDailyRecord.findFirst.mockResolvedValue(null as never);

      await expect(
        repository.findLatestCreatedAtInRange(
          'user-1',
          new Date('2026-07-01'),
          new Date('2026-07-07'),
        ),
      ).resolves.toBeNull();
    });
  });

  describe('create', () => {
    it('creates with provided data and includes attachments', async () => {
      const data = { userId: 'user-1', kind: 'water', occurredAt: new Date() };
      const created = { id: 'rec-1', ...data };
      prisma.userDailyRecord.create.mockResolvedValue(created as never);

      const result = await collectResult(repository.create(data as never));

      expect(result).toEqual({ ok: true, value: created });
      expect(prisma.userDailyRecord.create).toHaveBeenCalledWith({
        data,
        include: expect.anything(),
      });
    });

    it('maps a unique constraint violation to RESOURCE_CONFLICT', async () => {
      prisma.userDailyRecord.create.mockRejectedValue(prismaError('P2002'));

      const result = await collectResult(repository.create({} as never));

      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'conflict', code: 'RESOURCE_CONFLICT' },
      });
    });
  });

  describe('update', () => {
    it('updates by id with provided data', async () => {
      const data = { title: 'updated' };
      const updated = { id: 'rec-1' };
      prisma.userDailyRecord.update.mockResolvedValue(updated as never);

      const result = await collectResult(
        repository.update('rec-1', data as never),
      );

      expect(result).toEqual({ ok: true, value: updated });
      expect(prisma.userDailyRecord.update).toHaveBeenCalledWith({
        where: { id: 'rec-1' },
        data,
        include: expect.anything(),
      });
    });

    it('maps a missing row to RESOURCE_NOT_FOUND', async () => {
      prisma.userDailyRecord.update.mockRejectedValue(prismaError('P2025'));

      const result = await collectResult(
        repository.update('missing', {} as never),
      );

      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'not_found', code: 'RESOURCE_NOT_FOUND' },
      });
    });
  });

  describe('softDelete', () => {
    it('updates deletedAt without deleting the record', async () => {
      prisma.userDailyRecord.update.mockResolvedValue(undefined as never);

      const deletedAt = new Date('2026-07-10T12:00:00.000Z');
      const result = await collectResult(
        repository.softDelete('rec-1', deletedAt),
      );

      expect(result).toEqual({ ok: true, value: undefined });
      expect(prisma.userDailyRecord.update).toHaveBeenCalledWith({
        where: { id: 'rec-1' },
        data: { deletedAt },
      });
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
