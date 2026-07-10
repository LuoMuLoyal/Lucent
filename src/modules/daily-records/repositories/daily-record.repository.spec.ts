/* eslint-disable @typescript-eslint/no-unsafe-call */
import { DailyRecordRepository } from './daily-record.repository';
import type { PrismaService } from '../../../prisma/prisma.service';

describe('DailyRecordRepository', () => {
  let repository: DailyRecordRepository;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(() => {
    prisma = {
      userDailyRecord: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn(),
    } as unknown as jest.Mocked<PrismaService>;

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
        select: { userId: true, kind: true, payload: true },
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

  describe('create', () => {
    it('creates with provided data and includes attachments', async () => {
      const data = { userId: 'user-1', kind: 'water', occurredAt: new Date() };
      const created = { id: 'rec-1', ...data };
      prisma.userDailyRecord.create.mockResolvedValue(created as never);

      const result = await repository.create(data as never);

      expect(result).toBe(created);
      expect(prisma.userDailyRecord.create).toHaveBeenCalledWith({
        data,
        include: expect.anything(),
      });
    });
  });

  describe('update', () => {
    it('updates by id with provided data', async () => {
      const data = { title: 'updated' };
      const updated = { id: 'rec-1' };
      prisma.userDailyRecord.update.mockResolvedValue(updated as never);

      const result = await repository.update('rec-1', data as never);

      expect(result).toBe(updated);
      expect(prisma.userDailyRecord.update).toHaveBeenCalledWith({
        where: { id: 'rec-1' },
        data,
        include: expect.anything(),
      });
    });
  });

  describe('softDelete', () => {
    it('updates deletedAt without deleting the record', async () => {
      prisma.userDailyRecord.update.mockResolvedValue(undefined as never);

      const deletedAt = new Date('2026-07-10T12:00:00.000Z');
      await repository.softDelete('rec-1', deletedAt);

      expect(prisma.userDailyRecord.update).toHaveBeenCalledWith({
        where: { id: 'rec-1' },
        data: { deletedAt },
      });
    });
  });

  describe('transaction', () => {
    it('delegates to prisma.$transaction', async () => {
      const txFn = jest.fn().mockResolvedValue('result');
      prisma.$transaction.mockImplementation(
        (_fn: never) => txFn() as Promise<string>,
      );

      const result = await repository.transaction(txFn as never);

      expect(result).toBe('result');
      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });
});
