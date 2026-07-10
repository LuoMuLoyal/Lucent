/* eslint-disable @typescript-eslint/no-unsafe-call */
import { nonDeleted } from '../../common/helpers/prisma.helpers';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { Test } from '@nestjs/testing';
import { Prisma } from '#generated/prisma/client';
import { MedicineReminderRepositoryPort } from './repositories';
import { MedicineRemindersOwnershipService } from './services/ownership.service';
import { MedicineRemindersMapperService } from './services/mapper.service';
import { MedicineRemindersService } from './services/reminders.service';

const now = new Date('2026-06-08T12:00:00.000Z');

function reminderRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'reminder-1',
    userId: 'user-1',
    currentMedicineId: 'medicine-1',
    label: 'Morning dose',
    scheduledHour: 8,
    scheduledMinute: 30,
    daysOfWeek: [1, 3, 5],
    startDate: null,
    endDate: null,
    isActive: true,
    note: 'After breakfast',
    ...nonDeleted,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('MedicineRemindersService', () => {
  let service: MedicineRemindersService;

  let repository: any;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        {
          provide: I18nService,
          useValue: { t: jest.fn().mockImplementation((key: string) => key) },
        },
        MedicineRemindersService,
        MedicineRemindersOwnershipService,
        MedicineRemindersMapperService,
        {
          provide: MedicineReminderRepositoryPort,
          useValue: {
            findManyReminders: jest.fn(),
            createReminder: jest.fn(),
            updateReminder: jest.fn(),
            findManyDeliveries: jest.fn(),
            findReminderById: jest.fn(),
            findCurrentMedicine: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(MedicineRemindersService);
    repository = module.get(MedicineReminderRepositoryPort);
  });

  it('should create a reminder with normalized text and weekdays', async () => {
    repository.findCurrentMedicine.mockResolvedValue({
      id: 'medicine-1',
      userId: 'user-1',
    });
    repository.createReminder.mockResolvedValue(
      reminderRecord({
        label: 'Morning dose',
        daysOfWeek: [1, 3, 5],
        startDate: new Date('2026-06-10T00:00:00.000Z'),
        endDate: new Date('2026-06-20T00:00:00.000Z'),
        note: 'After breakfast',
      }),
    );

    const result = await service.create('user-1', {
      currentMedicineId: 'medicine-1',
      label: ' Morning dose ',
      scheduledHour: 8,
      scheduledMinute: 30,
      daysOfWeek: [5, 1, 3, 1],
      startDate: '2026-06-10',
      endDate: '2026-06-20',
      note: ' After breakfast ',
    });

    expect(repository.createReminder).toHaveBeenCalledWith({
      userId: 'user-1',
      currentMedicineId: 'medicine-1',
      label: 'Morning dose',
      scheduledHour: 8,
      scheduledMinute: 30,
      daysOfWeek: [1, 3, 5],
      startDate: new Date('2026-06-10T00:00:00.000Z'),
      endDate: new Date('2026-06-20T00:00:00.000Z'),
      isActive: true,
      note: 'After breakfast',
    });
    expect(result).toMatchObject({
      id: 'reminder-1',
      currentMedicineId: 'medicine-1',
      label: 'Morning dose',
      scheduledHour: 8,
      scheduledMinute: 30,
      daysOfWeek: [1, 3, 5],
      startDate: '2026-06-10',
      endDate: '2026-06-20',
      isActive: true,
      note: 'After breakfast',
      createdAt: '2026-06-08T12:00:00.000Z',
      updatedAt: '2026-06-08T12:00:00.000Z',
    });
  });

  it('should treat null weekdays as every day', async () => {
    repository.createReminder.mockResolvedValue(
      reminderRecord({
        currentMedicineId: null,
        daysOfWeek: null,
      }),
    );

    const result = await service.create('user-1', {
      scheduledHour: 9,
      scheduledMinute: 0,
      daysOfWeek: null,
    });

    expect(repository.createReminder).toHaveBeenCalledWith(
      expect.objectContaining({
        currentMedicineId: null,
        daysOfWeek: Prisma.JsonNull,
      }),
    );
    expect(result.daysOfWeek).toBeNull();
  });

  it('should list reminders and honor activeOnly', async () => {
    repository.findManyReminders.mockResolvedValue([
      reminderRecord({ daysOfWeek: [2, 4] }),
    ]);

    const result = await service.list('user-1', true);

    expect(repository.findManyReminders).toHaveBeenCalledWith(
      {
        userId: 'user-1',
        ...nonDeleted,
        isActive: true,
      },
      [
        { scheduledHour: 'asc' },
        { scheduledMinute: 'asc' },
        { createdAt: 'asc' },
      ],
    );
    expect(result.items[0]?.daysOfWeek).toEqual([2, 4]);
  });

  it('should reject empty weekdays', async () => {
    await expect(
      service.create('user-1', {
        scheduledHour: 8,
        scheduledMinute: 0,
        daysOfWeek: [],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should enforce current medicine ownership on create', async () => {
    repository.findCurrentMedicine.mockResolvedValue(null);

    await expect(
      service.create('user-1', {
        currentMedicineId: 'foreign-medicine',
        scheduledHour: 8,
        scheduledMinute: 0,
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('should update fields and clear the linked medicine when null is sent', async () => {
    repository.findReminderById.mockResolvedValue({
      userId: 'user-1',
      startDate: null,
      endDate: null,
    });
    repository.updateReminder.mockResolvedValue(
      reminderRecord({
        currentMedicineId: null,
        scheduledHour: 21,
        scheduledMinute: 5,
        daysOfWeek: null,
        startDate: new Date('2026-06-09T00:00:00.000Z'),
        endDate: new Date('2026-06-18T00:00:00.000Z'),
        isActive: false,
      }),
    );

    await service.update('user-1', 'reminder-1', {
      currentMedicineId: null,
      scheduledHour: 21,
      scheduledMinute: 5,
      daysOfWeek: null,
      startDate: '2026-06-09',
      endDate: '2026-06-18',
      isActive: false,
    });

    expect(repository.updateReminder).toHaveBeenCalledWith(
      { id: 'reminder-1' },
      {
        currentMedicine: { disconnect: true },
        scheduledHour: 21,
        scheduledMinute: 5,
        daysOfWeek: Prisma.JsonNull,
        startDate: new Date('2026-06-09T00:00:00.000Z'),
        endDate: new Date('2026-06-18T00:00:00.000Z'),
        isActive: false,
      },
    );
  });

  it('should reject an end date before the start date', async () => {
    await expect(
      service.create('user-1', {
        scheduledHour: 8,
        scheduledMinute: 0,
        startDate: '2026-06-20',
        endDate: '2026-06-10',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should soft-delete reminders', async () => {
    repository.findReminderById.mockResolvedValue({
      userId: 'user-1',
      startDate: null,
      endDate: null,
    });

    await service.delete('user-1', 'reminder-1');

    expect(repository.updateReminder).toHaveBeenCalledWith(
      { id: 'reminder-1' },
      { deletedAt: expect.any(Date), isActive: false },
    );
  });

  it('should reject foreign reminder updates', async () => {
    repository.findReminderById.mockResolvedValue({
      userId: 'other-user',
    });

    await expect(
      service.update('user-1', 'reminder-1', { scheduledHour: 10 }),
    ).rejects.toThrow(NotFoundException);
  });

  it('should list delivery logs for a date with a capped limit', async () => {
    const scheduledFor = new Date('2026-06-10T08:00:00.000Z');
    const deliveredAt = new Date('2026-06-10T08:00:10.000Z');
    repository.findManyDeliveries.mockResolvedValue([
      {
        id: 'delivery-1',
        userId: 'user-1',
        reminderId: 'reminder-1',
        deviceId: 'device-1',
        channel: 'local',
        status: 'delivered',
        scheduledFor,
        deliveredAt,
        errorMessage: null,
        createdAt: now,
      },
    ]);

    const result = await service.listDeliveries('user-1', '2026-06-10', 200);

    expect(repository.findManyDeliveries).toHaveBeenCalledWith(
      {
        userId: 'user-1',
        scheduledFor: {
          gte: new Date('2026-06-10T00:00:00.000Z'),
          lt: new Date('2026-06-11T00:00:00.000Z'),
        },
      },
      [{ scheduledFor: 'desc' }, { createdAt: 'desc' }],
      100,
    );
    expect(result.items[0]).toMatchObject({
      id: 'delivery-1',
      reminderId: 'reminder-1',
      deviceId: 'device-1',
      channel: 'local',
      status: 'delivered',
      scheduledFor: '2026-06-10T08:00:00.000Z',
      deliveredAt: '2026-06-10T08:00:10.000Z',
      errorMessage: null,
      createdAt: '2026-06-08T12:00:00.000Z',
    });
  });
});
