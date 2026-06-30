/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { DoseLogStatus } from '../../generated/prisma/client';
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
            },
            userCurrentMedicine: { findUnique: jest.fn() },
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
    (prisma.userMedicineDoseLog.findUnique as jest.Mock).mockResolvedValue({
      userId: 'u1',
    });
    await service.delete('u1', 'd1');
    expect(prisma.userMedicineDoseLog.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { deletedAt: expect.any(Date) } }),
    );
  });

  it('should update omitted fields without clearing nullable values', async () => {
    (prisma.userMedicineDoseLog.findUnique as jest.Mock).mockResolvedValue({
      userId: 'u1',
    });
    (prisma.userMedicineDoseLog.update as jest.Mock).mockResolvedValue({
      id: 'd1',
      userId: 'u1',
      currentMedicineId: null,
      status: DoseLogStatus.skipped,
      scheduledFor: new Date('2026-06-04'),
      doseText: '1 tablet',
      note: 'with food',
      source: 'manual',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await service.update('u1', 'd1', { status: DoseLogStatus.skipped });

    expect(prisma.userMedicineDoseLog.update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { status: DoseLogStatus.skipped },
    });
  });

  it('should clear nullable dose fields when null is provided', async () => {
    (prisma.userMedicineDoseLog.findUnique as jest.Mock).mockResolvedValue({
      userId: 'u1',
    });
    (prisma.userMedicineDoseLog.update as jest.Mock).mockResolvedValue({
      id: 'd1',
      userId: 'u1',
      currentMedicineId: null,
      status: DoseLogStatus.taken,
      scheduledFor: new Date('2026-06-04'),
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
    (prisma.userMedicineDoseLog.findUnique as jest.Mock).mockResolvedValue({
      userId: 'other',
    });

    await expect(
      service.update('u1', 'd1', { status: DoseLogStatus.taken }),
    ).rejects.toThrow(NotFoundException);
  });
});
