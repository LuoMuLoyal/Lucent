import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { DoseLogStatus } from '#generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MedicineDoseLogsService } from './services/medicine-dose-logs.service';

describe('MedicineDoseLogsService', () => {
  let service: MedicineDoseLogsService;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    const m = await Test.createTestingModule({
      providers: [
        {
          provide: I18nService,
          useValue: { t: jest.fn().mockImplementation((key: string) => key) },
        },
        MedicineDoseLogsService,
        {
          provide: PrismaService,
          useValue: {
            userMedicineDoseLog: {
              findMany: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              findUnique: jest.fn(),
              findFirst: jest.fn(),
            },
            userCurrentMedicine: { findUnique: jest.fn() },
            userMedicineReminder: {
              findUnique: jest.fn(),
              findFirst: jest.fn(),
            },
          },
        },
      ],
    }).compile();
    service = m.get(MedicineDoseLogsService);
    prisma = m.get(PrismaService);
  });

  it('should create and list dose logs', async () => {
    (prisma.userMedicineDoseLog.create as jest.Mock).mockResolvedValue({
      id: 'd1',
      userId: 'u1',
      currentMedicineId: null,
      status: 'taken',
      scheduledFor: new Date('2026-06-04'),
      reminderId: null,
      scheduledTime: null,
      doseText: null,
      note: null,
      source: 'manual',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    (prisma.userMedicineDoseLog.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'd1',
        userId: 'u1',
        currentMedicineId: null,
        status: 'taken',
        scheduledFor: new Date('2026-06-04'),
        reminderId: null,
        scheduledTime: null,
        doseText: null,
        note: null,
        source: 'manual',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    await service.create('u1', {
      status: DoseLogStatus.taken,
      scheduledFor: '2026-06-04',
    });
    const list = await service.list('u1', '2026-06-04');
    expect(list.items).toHaveLength(1);
  });

  it('should enforce medicine ownership on create', async () => {
    (prisma.userCurrentMedicine.findUnique as jest.Mock).mockResolvedValue({
      userId: 'other',
    });
    await expect(
      service.create('u1', {
        status: DoseLogStatus.taken,
        scheduledFor: '2026-06-04',
        currentMedicineId: 'm1',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('should soft-delete', async () => {
    (prisma.userMedicineDoseLog.findFirst as jest.Mock).mockResolvedValue({
      userId: 'u1',
    });
    await service.delete('u1', 'd1');
    expect(prisma.userMedicineDoseLog.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { deletedAt: expect.any(Date) } }),
    );
  });

  it('should update omitted fields without clearing nullable values', async () => {
    (prisma.userMedicineDoseLog.findFirst as jest.Mock).mockResolvedValue({
      userId: 'u1',
    });
    (prisma.userMedicineDoseLog.update as jest.Mock).mockResolvedValue({
      id: 'd1',
      userId: 'u1',
      currentMedicineId: null,
      status: DoseLogStatus.skipped,
      scheduledFor: new Date('2026-06-04'),
      reminderId: null,
      scheduledTime: null,
      doseText: '1 tablet',
      note: 'with food',
      source: 'manual',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await service.update('u1', 'd1', { status: DoseLogStatus.skipped });

    expect(prisma.userMedicineDoseLog.update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { status: DoseLogStatus.skipped, takenAt: null },
    });
  });

  it('should clear nullable dose fields when null is provided', async () => {
    (prisma.userMedicineDoseLog.findFirst as jest.Mock).mockResolvedValue({
      userId: 'u1',
    });
    (prisma.userMedicineDoseLog.update as jest.Mock).mockResolvedValue({
      id: 'd1',
      userId: 'u1',
      currentMedicineId: null,
      status: DoseLogStatus.taken,
      scheduledFor: new Date('2026-06-04'),
      reminderId: null,
      scheduledTime: null,
      doseText: null,
      note: null,
      source: 'manual',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await service.update('u1', 'd1', { doseText: null, note: null });

    expect(prisma.userMedicineDoseLog.update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { doseText: null, note: null },
    });
  });

  it('should reject foreign dose-log updates', async () => {
    (prisma.userMedicineDoseLog.findFirst as jest.Mock).mockResolvedValue({
      userId: 'other',
    });

    await expect(
      service.update('u1', 'd1', { status: DoseLogStatus.taken }),
    ).rejects.toThrow(NotFoundException);
  });

  it('should upsert an existing reminder slot dose log when mark is called', async () => {
    (prisma.userMedicineReminder.findFirst as jest.Mock).mockResolvedValue({
      id: 'reminder-1',
      userId: 'u1',
      currentMedicineId: 'medicine-1',
    });
    (prisma.userCurrentMedicine.findUnique as jest.Mock).mockResolvedValue({
      userId: 'u1',
    });
    (prisma.userMedicineDoseLog.findFirst as jest.Mock).mockResolvedValue({
      id: 'dose-1',
      userId: 'u1',
      currentMedicineId: 'medicine-1',
      reminderId: 'reminder-1',
      status: DoseLogStatus.planned,
      scheduledFor: new Date('2026-07-08T00:00:00.000Z'),
      scheduledTime: '08:30',
      doseText: null,
      note: null,
      source: 'manual',
      createdAt: new Date('2026-07-08T01:00:00.000Z'),
      updatedAt: new Date('2026-07-08T01:00:00.000Z'),
      takenAt: null,
    });
    (prisma.userMedicineDoseLog.update as jest.Mock).mockResolvedValue({
      id: 'dose-1',
      userId: 'u1',
      currentMedicineId: 'medicine-1',
      reminderId: 'reminder-1',
      status: DoseLogStatus.taken,
      scheduledFor: new Date('2026-07-08T00:00:00.000Z'),
      scheduledTime: '08:30',
      doseText: null,
      note: 'after breakfast',
      source: 'manual',
      createdAt: new Date('2026-07-08T01:00:00.000Z'),
      updatedAt: new Date('2026-07-08T02:00:00.000Z'),
      takenAt: new Date('2026-07-08T02:00:00.000Z'),
    });

    const result = await service.mark('u1', {
      currentMedicineId: 'medicine-1',
      reminderId: 'reminder-1',
      status: DoseLogStatus.taken,
      scheduledFor: '2026-07-08',
      scheduledTime: '08:30',
      note: 'after breakfast',
    });

    expect(prisma.userMedicineDoseLog.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'u1',
        reminderId: 'reminder-1',
        scheduledFor: new Date('2026-07-08T00:00:00.000Z'),
        deletedAt: null,
      },
      orderBy: [{ updatedAt: 'desc' }],
    });
    expect(prisma.userMedicineDoseLog.update).toHaveBeenCalledWith({
      where: { id: 'dose-1' },
      data: expect.objectContaining({
        currentMedicineId: 'medicine-1',
        reminderId: 'reminder-1',
        status: DoseLogStatus.taken,
        scheduledTime: '08:30',
        note: 'after breakfast',
      }),
    });
    expect(result.reminderId).toBe('reminder-1');
    expect(result.scheduledTime).toBe('08:30');
  });

  it('should reject foreign reminder slots on mark', async () => {
    (prisma.userMedicineReminder.findFirst as jest.Mock).mockResolvedValue({
      id: 'reminder-1',
      userId: 'other',
      currentMedicineId: 'medicine-1',
    });

    await expect(
      service.mark('u1', {
        currentMedicineId: 'medicine-1',
        reminderId: 'reminder-1',
        status: DoseLogStatus.taken,
        scheduledFor: '2026-07-08',
        scheduledTime: '08:30',
      }),
    ).rejects.toThrow(NotFoundException);
  });
});
