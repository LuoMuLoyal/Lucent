import type { DeepMocked } from '../../../common/types/deep-mocked';

import { MedicineDoseLogRepository } from './dose-log.repository';
import type { PrismaService } from '../../../prisma';

describe('MedicineDoseLogRepository', () => {
  let repository: MedicineDoseLogRepository;
  let prisma: DeepMocked<PrismaService>;

  beforeEach(() => {
    prisma = {
      userMedicineDoseLog: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        count: vi.fn(),
      },
      userMedicineReminder: {
        findFirst: vi.fn(),
      },
      nonDeleted: {
        userMedicineReminder: {
          findFirst: vi.fn(),
        },
      },
      userCurrentMedicine: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
      },
    } as unknown as DeepMocked<PrismaService>;

    repository = new MedicineDoseLogRepository(prisma);
  });

  describe('findMany', () => {
    it('queries with where clause', async () => {
      prisma.userMedicineDoseLog.findMany.mockResolvedValue([] as never);

      await repository.findMany({ userId: 'user-1' } as never);

      expect(prisma.userMedicineDoseLog.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
    });

    it('includes orderBy when provided', async () => {
      prisma.userMedicineDoseLog.findMany.mockResolvedValue([] as never);

      await repository.findMany({ userId: 'user-1' } as never, [
        { scheduledFor: 'desc' as const },
      ]);

      expect(prisma.userMedicineDoseLog.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: [{ scheduledFor: 'desc' }],
      });
    });
  });

  describe('listFactsInRange (MedicineDoseLogReaderPort)', () => {
    it('queries non-deleted dose logs in range with canonical order', async () => {
      const from = new Date('2026-07-01');
      const to = new Date('2026-07-07');
      prisma.userMedicineDoseLog.findMany.mockResolvedValue([] as never);

      await repository.listFactsInRange('user-1', from, to);

      expect(prisma.userMedicineDoseLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: 'user-1',
            deletedAt: null,
            scheduledFor: { gte: from, lte: to },
          },
          select: {
            currentMedicineId: true,
            reminderId: true,
            status: true,
            scheduledTime: true,
            scheduledFor: true,
          },
          orderBy: [{ scheduledFor: 'asc' }],
        }),
      );
    });
  });

  describe('findManyWithCount', () => {
    it('queries with pagination and returns total', async () => {
      prisma.userMedicineDoseLog.findMany.mockResolvedValue([
        { id: 'log-1' } as never,
      ]);
      prisma.userMedicineDoseLog.count.mockResolvedValue(1 as never);

      const result = await repository.findManyWithCount(
        { userId: 'user-1' } as never,
        [{ scheduledFor: 'desc' as const }],
        { page: 1, pageSize: 50 },
      );

      expect(result).toEqual({ items: [{ id: 'log-1' }], total: 1 });
      expect(prisma.userMedicineDoseLog.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: [{ scheduledFor: 'desc' }],
        skip: 0,
        take: 50,
      });
      expect(prisma.userMedicineDoseLog.count).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
    });

    it('calculates skip for page 2', async () => {
      prisma.userMedicineDoseLog.findMany.mockResolvedValue([] as never);
      prisma.userMedicineDoseLog.count.mockResolvedValue(0 as never);

      await repository.findManyWithCount(
        { userId: 'user-1' } as never,
        [{ scheduledFor: 'desc' as const }],
        { page: 2, pageSize: 20 },
      );

      expect(prisma.userMedicineDoseLog.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: [{ scheduledFor: 'desc' }],
        skip: 20,
        take: 20,
      });
    });
  });

  describe('findFirst', () => {
    it('queries with where clause only', async () => {
      prisma.userMedicineDoseLog.findFirst.mockResolvedValue(null);

      await repository.findFirst({ userId: 'user-1' } as never);

      expect(prisma.userMedicineDoseLog.findFirst).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
    });

    it('includes select and orderBy when provided', async () => {
      prisma.userMedicineDoseLog.findFirst.mockResolvedValue(null);

      await repository.findFirst({ userId: 'user-1' } as never, {
        select: { id: true } as never,
        orderBy: [{ createdAt: 'desc' as const }],
      });

      expect(prisma.userMedicineDoseLog.findFirst).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        select: { id: true },
        orderBy: [{ createdAt: 'desc' }],
      });
    });
  });

  describe('create', () => {
    it('creates with provided data', async () => {
      const data = { userId: 'user-1', status: 'taken' };
      prisma.userMedicineDoseLog.create.mockResolvedValue({
        id: 'log-1',
        ...data,
      } as never);

      const result = await repository.create(data as never);

      expect(result).toMatchObject({ id: 'log-1', status: 'taken' });
      expect(prisma.userMedicineDoseLog.create).toHaveBeenCalledWith({ data });
    });
  });

  describe('update', () => {
    it('updates with where and data', async () => {
      const where = { id: 'log-1' };
      const data = { status: 'taken' };
      prisma.userMedicineDoseLog.update.mockResolvedValue({
        id: 'log-1',
        status: 'taken',
      } as never);

      const result = await repository.update(where as never, data as never);

      expect(result).toMatchObject({ id: 'log-1', status: 'taken' });
      expect(prisma.userMedicineDoseLog.update).toHaveBeenCalledWith({
        where,
        data,
      });
    });
  });

  describe('findReminderById', () => {
    it('queries reminder by id+userId with ownership fields', async () => {
      prisma.nonDeleted.userMedicineReminder.findFirst.mockResolvedValue({
        userId: 'user-1',
        currentMedicineId: 'med-1',
        scheduledHour: 8,
        scheduledMinute: 30,
      } as never);

      const result = await repository.findReminderById('user-1', 'rem-1');

      expect(result).toMatchObject({
        userId: 'user-1',
        currentMedicineId: 'med-1',
        scheduledHour: 8,
        scheduledMinute: 30,
      });
      expect(
        prisma.nonDeleted.userMedicineReminder.findFirst,
      ).toHaveBeenCalledWith({
        where: { id: 'rem-1', userId: 'user-1' },
        select: {
          userId: true,
          currentMedicineId: true,
          scheduledHour: true,
          scheduledMinute: true,
        },
      });
    });

    it('returns null when not found', async () => {
      prisma.nonDeleted.userMedicineReminder.findFirst.mockResolvedValue(null);
      expect(await repository.findReminderById('user-1', 'missing')).toBeNull();
    });
  });

  describe('findCurrentMedicineById', () => {
    it('queries by id+userId and selects userId', async () => {
      prisma.userCurrentMedicine.findFirst.mockResolvedValue({
        userId: 'user-1',
      } as never);

      const result = await repository.findCurrentMedicineById(
        'user-1',
        'med-1',
      );

      expect(result).toMatchObject({ userId: 'user-1' });
      expect(prisma.userCurrentMedicine.findFirst).toHaveBeenCalledWith({
        where: { id: 'med-1', userId: 'user-1' },
        select: { userId: true },
      });
    });

    it('returns null when not found', async () => {
      prisma.userCurrentMedicine.findFirst.mockResolvedValue(null);
      expect(
        await repository.findCurrentMedicineById('user-1', 'missing'),
      ).toBeNull();
    });
  });
});
