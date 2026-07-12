/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { DoseLogStatus } from '#generated/prisma/client';
import { MedicineDoseLogRepositoryPort } from '../repositories';
import { MedicineDoseLogsService } from './dose-logs.service';
import { SuggestionCacheService } from '../../today-suggestion/services/cache/suggestion-cache.service';

describe('MedicineDoseLogsService', () => {
  let service: MedicineDoseLogsService;

  let repository: any;

  beforeEach(async () => {
    const m = await Test.createTestingModule({
      providers: [
        {
          provide: I18nService,
          useValue: { t: vi.fn().mockImplementation((key: string) => key) },
        },
        MedicineDoseLogsService,
        {
          provide: SuggestionCacheService,
          useValue: {
            invalidateSignals: vi.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: MedicineDoseLogRepositoryPort,
          useValue: {
            findMany: vi.fn(),
            create: vi.fn(),
            update: vi.fn(),
            findFirst: vi.fn(),
            findReminderById: vi.fn(),
            findCurrentMedicineById: vi.fn(),
          },
        },
      ],
    }).compile();
    service = m.get(MedicineDoseLogsService);
    repository = m.get(MedicineDoseLogRepositoryPort);
  });

  it('should create and list dose logs', async () => {
    repository.create.mockResolvedValue({
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
    repository.findMany.mockResolvedValue([
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
    repository.findCurrentMedicineById.mockResolvedValue({
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
    repository.findFirst.mockResolvedValue({ userId: 'u1' });
    await service.delete('u1', 'd1');
    expect(repository.update).toHaveBeenCalledWith(
      { id: 'd1' },
      { deletedAt: expect.any(Date) },
    );
  });

  it('should update omitted fields without clearing nullable values', async () => {
    repository.findFirst.mockResolvedValue({ userId: 'u1' });
    repository.update.mockResolvedValue({
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

    expect(repository.update).toHaveBeenCalledWith(
      { id: 'd1' },
      { status: DoseLogStatus.skipped, takenAt: null },
    );
  });

  it('should clear nullable dose fields when null is provided', async () => {
    repository.findFirst.mockResolvedValue({ userId: 'u1' });
    repository.update.mockResolvedValue({
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

    expect(repository.update).toHaveBeenCalledWith(
      { id: 'd1' },
      { doseText: null, note: null },
    );
  });

  it('should reject foreign dose-log updates', async () => {
    repository.findFirst.mockResolvedValue({ userId: 'other' });

    await expect(
      service.update('u1', 'd1', { status: DoseLogStatus.taken }),
    ).rejects.toThrow(NotFoundException);
  });

  it('should upsert an existing reminder slot dose log when mark is called', async () => {
    repository.findReminderById.mockResolvedValue({
      id: 'reminder-1',
      userId: 'u1',
      currentMedicineId: 'medicine-1',
      scheduledHour: 8,
      scheduledMinute: 30,
    });
    repository.findCurrentMedicineById.mockResolvedValue({ userId: 'u1' });
    repository.findFirst.mockResolvedValue({
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
    repository.update.mockResolvedValue({
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

    expect(repository.findFirst).toHaveBeenCalledWith(
      {
        userId: 'u1',
        reminderId: 'reminder-1',
        scheduledFor: new Date('2026-07-08T00:00:00.000Z'),
        deletedAt: null,
      },
      { orderBy: [{ updatedAt: 'desc' }] },
    );
    expect(repository.update).toHaveBeenCalledWith(
      { id: 'dose-1' },
      expect.objectContaining({
        currentMedicineId: 'medicine-1',
        reminderId: 'reminder-1',
        status: DoseLogStatus.taken,
        scheduledTime: '08:30',
        note: 'after breakfast',
      }),
    );
    expect(result.reminderId).toBe('reminder-1');
    expect(result.scheduledTime).toBe('08:30');
  });

  it('should reject foreign reminder slots on mark', async () => {
    repository.findReminderById.mockResolvedValue({
      id: 'reminder-1',
      userId: 'other',
      currentMedicineId: 'medicine-1',
      scheduledHour: 8,
      scheduledMinute: 30,
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

  it('should reject mark when neither reminderId nor currentMedicineId is provided', async () => {
    await expect(
      service.mark('u1', {
        status: DoseLogStatus.taken,
        scheduledFor: '2026-07-08',
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
