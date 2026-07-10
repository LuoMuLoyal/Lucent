/* eslint-disable @typescript-eslint/no-unsafe-call */
import { MedicineDoseLogRepository } from './dose-log.repository';
import type { PrismaService } from '../../../prisma/prisma.service';

describe('MedicineDoseLogRepository', () => {
  let repository: MedicineDoseLogRepository;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(() => {
    prisma = {
      userMedicineDoseLog: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      userMedicineReminder: {
        findFirst: jest.fn(),
      },
      userCurrentMedicine: {
        findUnique: jest.fn(),
      },
    } as unknown as jest.Mocked<PrismaService>;

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
    it('queries reminder with ownership fields', async () => {
      prisma.userMedicineReminder.findFirst.mockResolvedValue({
        userId: 'user-1',
        currentMedicineId: 'med-1',
        scheduledHour: 8,
        scheduledMinute: 30,
      } as never);

      const result = await repository.findReminderById('rem-1');

      expect(result).toMatchObject({
        userId: 'user-1',
        currentMedicineId: 'med-1',
        scheduledHour: 8,
        scheduledMinute: 30,
      });
      expect(prisma.userMedicineReminder.findFirst).toHaveBeenCalledWith({
        where: { id: 'rem-1', deletedAt: null },
        select: {
          userId: true,
          currentMedicineId: true,
          scheduledHour: true,
          scheduledMinute: true,
        },
      });
    });

    it('returns null when not found', async () => {
      prisma.userMedicineReminder.findFirst.mockResolvedValue(null);
      expect(await repository.findReminderById('missing')).toBeNull();
    });
  });

  describe('findCurrentMedicineById', () => {
    it('queries by id and selects userId', async () => {
      prisma.userCurrentMedicine.findUnique.mockResolvedValue({
        userId: 'user-1',
      } as never);

      const result = await repository.findCurrentMedicineById('med-1');

      expect(result).toMatchObject({ userId: 'user-1' });
      expect(prisma.userCurrentMedicine.findUnique).toHaveBeenCalledWith({
        where: { id: 'med-1' },
        select: { userId: true },
      });
    });

    it('returns null when not found', async () => {
      prisma.userCurrentMedicine.findUnique.mockResolvedValue(null);
      expect(await repository.findCurrentMedicineById('missing')).toBeNull();
    });
  });
});
