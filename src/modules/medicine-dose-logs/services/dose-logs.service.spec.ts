import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { type Mocked } from 'vitest';
import { DoseLogStatus } from '#generated/prisma/client';
import { MedicineDoseLogRepositoryPort } from '../repositories/dose-log.repository';
import { MedicineDoseLogsService } from './dose-logs.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { HealthEventsOwnershipService } from '../../health-events';

describe('MedicineDoseLogsService', () => {
  let service: MedicineDoseLogsService;

  let repository: Mocked<MedicineDoseLogRepositoryPort>;

  let healthEventsOwnership: Mocked<HealthEventsOwnershipService>;

  beforeEach(async () => {
    const m = await Test.createTestingModule({
      providers: [
        {
          provide: I18nService,
          useValue: { t: vi.fn().mockImplementation((key: string) => key) },
        },
        MedicineDoseLogsService,
        {
          provide: EventEmitter2,
          useValue: { emitAsync: vi.fn().mockResolvedValue(undefined) },
        },
        {
          provide: MedicineDoseLogRepositoryPort,
          useValue: {
            findMany: vi.fn(),
            findManyWithCount: vi.fn(),
            create: vi.fn(),
            update: vi.fn(),
            findFirst: vi.fn(),
            findReminderById: vi.fn(),
            findCurrentMedicineById: vi.fn(),
          },
        },
        {
          provide: HealthEventsOwnershipService,
          useValue: {
            ensureActiveOwnedByUser: vi.fn(),
          },
        },
      ],
    }).compile();
    service = m.get(MedicineDoseLogsService);
    repository = m.get(
      MedicineDoseLogRepositoryPort,
    ) as unknown as Mocked<MedicineDoseLogRepositoryPort>;
    healthEventsOwnership = m.get(
      HealthEventsOwnershipService,
    ) as unknown as Mocked<HealthEventsOwnershipService>;
  });

  it('should create and list dose logs', async () => {
    repository.create.mockResolvedValue({
      id: 'd1',
      userId: 'u1',
      healthEventId: null,
      currentMedicineId: null,
      status: 'taken',
      scheduledFor: new Date('2026-06-04'),
      reminderId: null,
      scheduledTime: null,
      doseText: null,
      note: null,
      source: 'manual',
      deletedAt: null,
      takenAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    repository.findManyWithCount.mockResolvedValue({
      items: [
        {
          id: 'd1',
          userId: 'u1',
          healthEventId: null,
          currentMedicineId: null,
          status: 'taken',
          scheduledFor: new Date('2026-06-04'),
          reminderId: null,
          scheduledTime: null,
          doseText: null,
          note: null,
          source: 'manual',
          deletedAt: null,
          takenAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      total: 1,
    });

    await service.create('u1', {
      status: DoseLogStatus.taken,
      scheduledFor: '2026-06-04',
    });
    expect(
      healthEventsOwnership.ensureActiveOwnedByUser,
    ).not.toHaveBeenCalled();
    const list = await service.list('u1', '2026-06-04');
    expect(list.items).toHaveLength(1);
    expect(list.total).toBe(1);
  });

  it('should validate and persist an active health event on create', async () => {
    healthEventsOwnership.ensureActiveOwnedByUser.mockResolvedValue(
      {} as never,
    );
    repository.create.mockResolvedValue({
      id: 'd1',
      userId: 'u1',
      healthEventId: 'event-1',
      currentMedicineId: null,
      status: DoseLogStatus.taken,
      scheduledFor: new Date('2026-06-04'),
      reminderId: null,
      scheduledTime: null,
      doseText: null,
      note: null,
      source: 'manual',
      deletedAt: null,
      takenAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const dto = {
      status: DoseLogStatus.taken,
      scheduledFor: '2026-06-04',
      healthEventId: 'event-1',
    } as Parameters<MedicineDoseLogsService['create']>[1] & {
      healthEventId: string;
    };

    const result = await service.create('u1', dto);

    expect(result.healthEventId).toBe('event-1');
    expect(healthEventsOwnership.ensureActiveOwnedByUser).toHaveBeenCalledWith(
      'u1',
      'event-1',
    );
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ healthEventId: 'event-1' }),
    );
  });

  it('should propagate an ended health event rejection on create', async () => {
    const error = new BadRequestException('health-events.inactive');
    healthEventsOwnership.ensureActiveOwnedByUser.mockRejectedValue(error);

    const dto = {
      status: DoseLogStatus.taken,
      scheduledFor: '2026-06-04',
      healthEventId: 'ended-event',
    } as Parameters<MedicineDoseLogsService['create']>[1] & {
      healthEventId: string;
    };

    await expect(service.create('u1', dto)).rejects.toBe(error);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('should propagate a foreign health event rejection on mark', async () => {
    const error = new NotFoundException('health-events.not_found');
    healthEventsOwnership.ensureActiveOwnedByUser.mockRejectedValue(error);

    const dto = {
      currentMedicineId: 'medicine-1',
      status: DoseLogStatus.taken,
      scheduledFor: '2026-07-08',
      scheduledTime: '08:30',
      healthEventId: 'foreign-event',
    } as Parameters<MedicineDoseLogsService['mark']>[1] & {
      healthEventId: string;
    };

    await expect(service.mark('u1', dto)).rejects.toBe(error);
    expect(repository.findFirst).not.toHaveBeenCalled();
  });

  it('should enforce medicine ownership on create', async () => {
    repository.findCurrentMedicineById.mockResolvedValue(null);
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
      healthEventId: null,
      currentMedicineId: null,
      status: DoseLogStatus.skipped,
      scheduledFor: new Date('2026-06-04'),
      reminderId: null,
      scheduledTime: null,
      doseText: '1 tablet',
      note: 'with food',
      source: 'manual',
      deletedAt: null,
      takenAt: null,
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
      healthEventId: null,
      currentMedicineId: null,
      status: DoseLogStatus.taken,
      scheduledFor: new Date('2026-06-04'),
      reminderId: null,
      scheduledTime: null,
      doseText: null,
      note: null,
      source: 'manual',
      deletedAt: null,
      takenAt: null,
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
    repository.findFirst.mockResolvedValue(null);

    await expect(
      service.update('u1', 'd1', { status: DoseLogStatus.taken }),
    ).rejects.toThrow(NotFoundException);
  });

  it('should upsert an existing reminder slot dose log when mark is called', async () => {
    repository.findReminderById.mockResolvedValue({
      userId: 'u1',
      currentMedicineId: 'medicine-1',
      scheduledHour: 8,
      scheduledMinute: 30,
    });
    repository.findCurrentMedicineById.mockResolvedValue({ userId: 'u1' });
    repository.findFirst.mockResolvedValue({
      id: 'dose-1',
      userId: 'u1',
      healthEventId: null,
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
      healthEventId: null,
      currentMedicineId: 'medicine-1',
      reminderId: 'reminder-1',
      status: DoseLogStatus.taken,
      scheduledFor: new Date('2026-07-08T00:00:00.000Z'),
      scheduledTime: '08:30',
      doseText: null,
      note: 'after breakfast',
      source: 'manual',
      deletedAt: null,
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
        scheduledTime: '08:30',
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

  it('creates each temporary dose log independently', async () => {
    repository.findCurrentMedicineById.mockResolvedValue({ userId: 'u1' });
    repository.findFirst.mockResolvedValue({
      id: 'temporary-dose-1',
      userId: 'u1',
      healthEventId: null,
      currentMedicineId: 'medicine-1',
      reminderId: null,
      status: DoseLogStatus.taken,
      scheduledFor: new Date('2026-07-08T00:00:00.000Z'),
      scheduledTime: '08:30',
      doseText: null,
      note: null,
      source: 'manual',
      deletedAt: null,
      createdAt: new Date('2026-07-08T01:00:00.000Z'),
      updatedAt: new Date('2026-07-08T01:00:00.000Z'),
      takenAt: new Date('2026-07-08T01:00:00.000Z'),
    });
    repository.create.mockResolvedValue({
      id: 'temporary-dose-2',
      userId: 'u1',
      healthEventId: null,
      currentMedicineId: 'medicine-1',
      reminderId: null,
      status: DoseLogStatus.taken,
      scheduledFor: new Date('2026-07-08T00:00:00.000Z'),
      scheduledTime: '08:30',
      doseText: null,
      note: null,
      source: 'manual',
      deletedAt: null,
      createdAt: new Date('2026-07-08T02:00:00.000Z'),
      updatedAt: new Date('2026-07-08T02:00:00.000Z'),
      takenAt: new Date('2026-07-08T02:00:00.000Z'),
    });

    await service.mark('u1', {
      currentMedicineId: 'medicine-1',
      status: DoseLogStatus.taken,
      scheduledFor: '2026-07-08',
      scheduledTime: '08:30',
    });

    expect(repository.findFirst).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        currentMedicineId: 'medicine-1',
        reminderId: null,
        scheduledFor: new Date('2026-07-08T00:00:00.000Z'),
        scheduledTime: '08:30',
      }),
    );
  });

  it('should validate and persist an active health event when mark creates a log', async () => {
    healthEventsOwnership.ensureActiveOwnedByUser.mockResolvedValue(
      {} as never,
    );
    repository.findCurrentMedicineById.mockResolvedValue({ userId: 'u1' });
    repository.findFirst.mockResolvedValue(null);
    repository.create.mockResolvedValue({
      id: 'dose-1',
      userId: 'u1',
      healthEventId: 'event-1',
      currentMedicineId: 'medicine-1',
      reminderId: null,
      status: DoseLogStatus.taken,
      scheduledFor: new Date('2026-07-08T00:00:00.000Z'),
      scheduledTime: '08:30',
      doseText: null,
      note: null,
      source: 'manual',
      deletedAt: null,
      createdAt: new Date('2026-07-08T01:00:00.000Z'),
      updatedAt: new Date('2026-07-08T02:00:00.000Z'),
      takenAt: new Date('2026-07-08T02:00:00.000Z'),
    });

    const dto = {
      currentMedicineId: 'medicine-1',
      status: DoseLogStatus.taken,
      scheduledFor: '2026-07-08',
      scheduledTime: '08:30',
      healthEventId: 'event-1',
    } as Parameters<MedicineDoseLogsService['mark']>[1] & {
      healthEventId: string;
    };

    await service.mark('u1', dto);

    expect(healthEventsOwnership.ensureActiveOwnedByUser).toHaveBeenCalledWith(
      'u1',
      'event-1',
    );
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ healthEventId: 'event-1' }),
    );
  });

  it('should preserve an existing health event when mark omits it', async () => {
    repository.findReminderById.mockResolvedValue({
      userId: 'u1',
      currentMedicineId: 'medicine-1',
      scheduledHour: 8,
      scheduledMinute: 30,
    });
    repository.findCurrentMedicineById.mockResolvedValue({ userId: 'u1' });
    repository.findFirst.mockResolvedValue({
      id: 'dose-1',
      userId: 'u1',
      healthEventId: 'existing-event',
      currentMedicineId: 'medicine-1',
      reminderId: null,
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
      healthEventId: 'existing-event',
      currentMedicineId: 'medicine-1',
      reminderId: null,
      status: DoseLogStatus.taken,
      scheduledFor: new Date('2026-07-08T00:00:00.000Z'),
      scheduledTime: '08:30',
      doseText: null,
      note: null,
      source: 'manual',
      deletedAt: null,
      createdAt: new Date('2026-07-08T01:00:00.000Z'),
      updatedAt: new Date('2026-07-08T02:00:00.000Z'),
      takenAt: new Date('2026-07-08T02:00:00.000Z'),
    });

    await service.mark('u1', {
      currentMedicineId: 'medicine-1',
      reminderId: 'reminder-1',
      status: DoseLogStatus.taken,
      scheduledFor: '2026-07-08',
      scheduledTime: '08:30',
    });

    expect(
      healthEventsOwnership.ensureActiveOwnedByUser,
    ).not.toHaveBeenCalled();
    expect(repository.update).toHaveBeenCalledWith(
      { id: 'dose-1' },
      expect.not.objectContaining({ healthEventId: expect.anything() }),
    );
  });

  it('should clear an existing health event when mark receives null', async () => {
    repository.findReminderById.mockResolvedValue({
      userId: 'u1',
      currentMedicineId: 'medicine-1',
      scheduledHour: 8,
      scheduledMinute: 30,
    });
    repository.findCurrentMedicineById.mockResolvedValue({ userId: 'u1' });
    repository.findFirst.mockResolvedValue({
      id: 'dose-1',
      userId: 'u1',
      healthEventId: 'existing-event',
      currentMedicineId: 'medicine-1',
      reminderId: null,
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
      healthEventId: null,
      currentMedicineId: 'medicine-1',
      reminderId: null,
      status: DoseLogStatus.taken,
      scheduledFor: new Date('2026-07-08T00:00:00.000Z'),
      scheduledTime: '08:30',
      doseText: null,
      note: null,
      source: 'manual',
      deletedAt: null,
      createdAt: new Date('2026-07-08T01:00:00.000Z'),
      updatedAt: new Date('2026-07-08T02:00:00.000Z'),
      takenAt: new Date('2026-07-08T02:00:00.000Z'),
    });

    const dto = {
      currentMedicineId: 'medicine-1',
      reminderId: 'reminder-1',
      status: DoseLogStatus.taken,
      scheduledFor: '2026-07-08',
      scheduledTime: '08:30',
      healthEventId: null,
    } as Parameters<MedicineDoseLogsService['mark']>[1] & {
      healthEventId: string | null;
    };

    await service.mark('u1', dto);

    expect(repository.update).toHaveBeenCalledWith(
      { id: 'dose-1' },
      expect.objectContaining({ healthEventId: null }),
    );
  });

  it('should update an existing health event when mark receives a new id', async () => {
    repository.findReminderById.mockResolvedValue({
      userId: 'u1',
      currentMedicineId: 'medicine-1',
      scheduledHour: 8,
      scheduledMinute: 30,
    });
    healthEventsOwnership.ensureActiveOwnedByUser.mockResolvedValue(
      {} as never,
    );
    repository.findCurrentMedicineById.mockResolvedValue({ userId: 'u1' });
    repository.findFirst.mockResolvedValue({
      id: 'dose-1',
      userId: 'u1',
      healthEventId: 'existing-event',
      currentMedicineId: 'medicine-1',
      reminderId: null,
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
      healthEventId: 'new-event',
      currentMedicineId: 'medicine-1',
      reminderId: null,
      status: DoseLogStatus.taken,
      scheduledFor: new Date('2026-07-08T00:00:00.000Z'),
      scheduledTime: '08:30',
      doseText: null,
      note: null,
      source: 'manual',
      deletedAt: null,
      createdAt: new Date('2026-07-08T01:00:00.000Z'),
      updatedAt: new Date('2026-07-08T02:00:00.000Z'),
      takenAt: new Date('2026-07-08T02:00:00.000Z'),
    });

    const dto = {
      currentMedicineId: 'medicine-1',
      reminderId: 'reminder-1',
      status: DoseLogStatus.taken,
      scheduledFor: '2026-07-08',
      scheduledTime: '08:30',
      healthEventId: 'new-event',
    } as Parameters<MedicineDoseLogsService['mark']>[1] & {
      healthEventId: string;
    };

    await service.mark('u1', dto);

    expect(healthEventsOwnership.ensureActiveOwnedByUser).toHaveBeenCalledWith(
      'u1',
      'new-event',
    );
    expect(repository.update).toHaveBeenCalledWith(
      { id: 'dose-1' },
      expect.objectContaining({ healthEventId: 'new-event' }),
    );
  });

  it('should reject foreign reminder slots on mark', async () => {
    repository.findReminderById.mockResolvedValue(null);

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

  it('should reject mark when currentMedicineId is provided without scheduledTime', async () => {
    repository.findCurrentMedicineById.mockResolvedValue({ userId: 'u1' });

    await expect(
      service.mark('u1', {
        currentMedicineId: 'medicine-1',
        status: DoseLogStatus.taken,
        scheduledFor: '2026-07-08',
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
