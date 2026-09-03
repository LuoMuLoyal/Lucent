import { nonDeleted } from '../../../common/index.js';
import { I18nService } from 'nestjs-i18n';
import { Test } from '@nestjs/testing';
import { type Mocked } from 'vitest';
import { Prisma } from '#generated/prisma/client.js';
import { okAsync } from '../../../common/result/index.js';
import type {
  DomainFailure,
  ResultAsync,
} from '../../../common/result/index.js';
import { MedicineReminderRepositoryPort } from '../repositories/reminder.repository.js';
import { MedicineRemindersOwnershipService } from './ownership.service.js';
import { MedicineRemindersMapperService } from './mapper.service.js';
import { MedicineRemindersService } from './reminders.service.js';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { REMINDER_CHANGED } from '../../../common/events/domain-events.js';

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

/** Unwraps a ResultAsync, failing the test when it is an Err. */
async function unwrapOk<T>(result: ResultAsync<T, DomainFailure>): Promise<T> {
  const outcome = await result.match(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );
  if (!outcome.ok) {
    throw new Error(`Expected ok result, got ${outcome.error.code}`);
  }
  return outcome.value;
}

/** Folds a ResultAsync into a plain outcome so specs can assert code/value. */
async function collectResult<T>(
  result: ResultAsync<T, DomainFailure>,
): Promise<{ ok: true; value: T } | { ok: false; error: DomainFailure }> {
  return result.match(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );
}

describe('MedicineRemindersService', () => {
  let service: MedicineRemindersService;

  let repository: Mocked<MedicineReminderRepositoryPort>;
  let eventEmitter: Mocked<EventEmitter2>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        {
          provide: I18nService,
          useValue: { t: vi.fn().mockImplementation((key: string) => key) },
        },
        MedicineRemindersService,
        MedicineRemindersOwnershipService,
        MedicineRemindersMapperService,
        {
          provide: MedicineReminderRepositoryPort,
          useValue: {
            findManyReminders: vi.fn(),
            createReminder: vi.fn(),
            updateReminder: vi.fn(),
            findManyDeliveries: vi.fn(),
            findReminderById: vi.fn(),
            findCurrentMedicine: vi.fn(),
            transaction: vi.fn(),
          },
        },
        {
          provide: EventEmitter2,
          useValue: { emitAsync: vi.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get(MedicineRemindersService);
    repository = module.get(
      MedicineReminderRepositoryPort,
    ) as unknown as Mocked<MedicineReminderRepositoryPort>;
    eventEmitter = module.get(
      EventEmitter2,
    ) as unknown as Mocked<EventEmitter2>;
  });

  it('should create a reminder with normalized text and weekdays', async () => {
    repository.findCurrentMedicine.mockResolvedValue({
      id: 'medicine-1',
      userId: 'user-1',
    });
    repository.createReminder.mockReturnValue(
      okAsync(
        reminderRecord({
          label: 'Morning dose',
          daysOfWeek: [1, 3, 5],
          startDate: new Date('2026-06-10T00:00:00.000Z'),
          endDate: new Date('2026-06-20T00:00:00.000Z'),
          note: 'After breakfast',
        }),
      ),
    );

    const result = await unwrapOk(
      service.create('user-1', {
        currentMedicineId: 'medicine-1',
        label: ' Morning dose ',
        scheduledHour: 8,
        scheduledMinute: 30,
        daysOfWeek: [5, 1, 3, 1],
        startDate: '2026-06-10',
        endDate: '2026-06-20',
        note: ' After breakfast ',
      }),
    );

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
    repository.createReminder.mockReturnValue(
      okAsync(
        reminderRecord({
          currentMedicineId: null,
          daysOfWeek: null,
        }),
      ),
    );

    const result = await unwrapOk(
      service.create('user-1', {
        scheduledHour: 9,
        scheduledMinute: 0,
        daysOfWeek: null,
      }),
    );

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

  it('should reject empty weekdays with VALIDATION_FAILED', async () => {
    const result = await collectResult(
      service.create('user-1', {
        scheduledHour: 8,
        scheduledMinute: 0,
        daysOfWeek: [],
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'validation', code: 'VALIDATION_FAILED' },
    });
    expect(repository.createReminder).not.toHaveBeenCalled();
  });

  it('should enforce current medicine ownership on create', async () => {
    repository.findCurrentMedicine.mockResolvedValue(null);

    const result = await collectResult(
      service.create('user-1', {
        currentMedicineId: 'foreign-medicine',
        scheduledHour: 8,
        scheduledMinute: 0,
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'not_found', code: 'RESOURCE_NOT_FOUND' },
    });
  });

  it('should update fields and clear the linked medicine when null is sent', async () => {
    repository.findReminderById.mockResolvedValue({
      userId: 'user-1',
      startDate: null,
      endDate: null,
    });
    repository.updateReminder.mockReturnValue(
      okAsync(
        reminderRecord({
          currentMedicineId: null,
          scheduledHour: 21,
          scheduledMinute: 5,
          daysOfWeek: null,
          startDate: new Date('2026-06-09T00:00:00.000Z'),
          endDate: new Date('2026-06-18T00:00:00.000Z'),
          isActive: false,
        }),
      ),
    );

    await unwrapOk(
      service.update('user-1', 'reminder-1', {
        currentMedicineId: null,
        scheduledHour: 21,
        scheduledMinute: 5,
        daysOfWeek: null,
        startDate: '2026-06-09',
        endDate: '2026-06-18',
        isActive: false,
      }),
    );

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

  it('should reject an end date before the start date with VALIDATION_FAILED', async () => {
    const result = await collectResult(
      service.create('user-1', {
        scheduledHour: 8,
        scheduledMinute: 0,
        startDate: '2026-06-20',
        endDate: '2026-06-10',
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'validation', code: 'VALIDATION_FAILED' },
    });
    expect(repository.createReminder).not.toHaveBeenCalled();
  });

  it('should soft-delete reminders', async () => {
    repository.findReminderById.mockResolvedValue({
      userId: 'user-1',
      startDate: null,
      endDate: null,
    });
    repository.updateReminder.mockReturnValue(
      okAsync(reminderRecord({ id: 'reminder-1' })),
    );

    await unwrapOk(service.delete('user-1', 'reminder-1'));

    expect(repository.updateReminder).toHaveBeenCalledWith(
      { id: 'reminder-1' },
      { deletedAt: expect.any(Date), isActive: false },
    );
  });

  it('should map foreign reminder updates to FORBIDDEN', async () => {
    repository.findReminderById.mockResolvedValue({
      userId: 'other-user',
    });

    const result = await collectResult(
      service.update('user-1', 'reminder-1', { scheduledHour: 10 }),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'authorization', code: 'FORBIDDEN' },
    });
    expect(repository.updateReminder).not.toHaveBeenCalled();
  });

  it('should map a missing reminder delete to RESOURCE_NOT_FOUND', async () => {
    repository.findReminderById.mockResolvedValue(null);

    const result = await collectResult(service.delete('user-1', 'reminder-1'));

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'not_found', code: 'RESOURCE_NOT_FOUND' },
    });
    expect(repository.updateReminder).not.toHaveBeenCalled();
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

    const result = await unwrapOk(
      service.listDeliveries('user-1', '2026-06-10', 200),
    );

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

  it('should map an invalid delivery date filter to VALIDATION_FAILED', async () => {
    const result = await collectResult(
      service.listDeliveries('user-1', 'not-a-date', 20),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'validation', code: 'VALIDATION_FAILED' },
    });
    expect(repository.findManyDeliveries).not.toHaveBeenCalled();
  });

  describe('upsertGroup', () => {
    function transactionClient() {
      return {
        userMedicineReminder: {
          findMany: vi.fn(),
          create: vi.fn(),
          update: vi.fn(),
          updateMany: vi.fn(),
        },
      };
    }

    it('should update, create, and soft-delete stale rows within one transaction', async () => {
      repository.findCurrentMedicine.mockResolvedValue({
        id: 'medicine-1',
        userId: 'user-1',
      });

      const tx = transactionClient();
      repository.transaction.mockImplementation((fn) =>
        (fn as (txArg: unknown) => Promise<unknown>)(tx),
      );

      tx.userMedicineReminder.findMany
        .mockResolvedValueOnce([{ id: 'slot-1' }])
        .mockResolvedValueOnce([
          reminderRecord({
            id: 'slot-1',
            scheduledHour: 8,
            scheduledMinute: 30,
          }),
          reminderRecord({
            id: 'slot-2',
            scheduledHour: 20,
            scheduledMinute: 5,
          }),
        ]);
      tx.userMedicineReminder.update.mockResolvedValue(
        reminderRecord({ id: 'slot-1' }),
      );
      tx.userMedicineReminder.create.mockResolvedValue(
        reminderRecord({ id: 'slot-2' }),
      );
      tx.userMedicineReminder.updateMany.mockResolvedValue({ count: 1 });

      const result = await unwrapOk(
        service.upsertGroup('user-1', {
          currentMedicineId: 'medicine-1',
          slots: [
            { id: 'slot-1', scheduledHour: 8, scheduledMinute: 30 },
            { scheduledHour: 20, scheduledMinute: 5 },
          ],
        }),
      );

      expect(tx.userMedicineReminder.findMany).toHaveBeenNthCalledWith(1, {
        where: {
          id: { in: ['slot-1'] },
          userId: 'user-1',
          currentMedicineId: 'medicine-1',
          ...nonDeleted,
        },
        select: { id: true },
      });

      expect(tx.userMedicineReminder.update).toHaveBeenCalledTimes(1);
      expect(tx.userMedicineReminder.update).toHaveBeenCalledWith({
        where: { id: 'slot-1' },
        data: expect.objectContaining({
          scheduledHour: 8,
          scheduledMinute: 30,
        }),
      });

      expect(tx.userMedicineReminder.create).toHaveBeenCalledTimes(1);
      expect(tx.userMedicineReminder.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          scheduledHour: 20,
          scheduledMinute: 5,
        }),
      });

      expect(tx.userMedicineReminder.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          currentMedicineId: 'medicine-1',
          ...nonDeleted,
          id: { notIn: ['slot-1'] },
        },
        data: { deletedAt: expect.any(Date), isActive: false },
      });

      expect(repository.transaction).toHaveBeenCalledTimes(1);
      expect(eventEmitter.emitAsync).toHaveBeenCalledTimes(1);
      expect(eventEmitter.emitAsync).toHaveBeenCalledWith(REMINDER_CHANGED, {
        userId: 'user-1',
      });

      expect(result.items).toHaveLength(2);
    });

    it('should map a slot id that does not belong to the group to RESOURCE_NOT_FOUND', async () => {
      repository.findCurrentMedicine.mockResolvedValue({
        id: 'medicine-1',
        userId: 'user-1',
      });

      const tx = transactionClient();
      repository.transaction.mockImplementation((fn) =>
        (fn as (txArg: unknown) => Promise<unknown>)(tx),
      );
      tx.userMedicineReminder.findMany.mockResolvedValueOnce([]);

      const result = await collectResult(
        service.upsertGroup('user-1', {
          currentMedicineId: 'medicine-1',
          slots: [{ id: 'foreign-slot', scheduledHour: 8, scheduledMinute: 0 }],
        }),
      );

      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'not_found', code: 'RESOURCE_NOT_FOUND' },
      });
      expect(tx.userMedicineReminder.updateMany).not.toHaveBeenCalled();
      expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
    });

    it('should reject empty slots with VALIDATION_FAILED', async () => {
      const result = await collectResult(
        service.upsertGroup('user-1', {
          currentMedicineId: 'medicine-1',
          slots: [],
        }),
      );

      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'validation', code: 'VALIDATION_FAILED' },
      });
      expect(repository.transaction).not.toHaveBeenCalled();
      expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
    });

    it('should reject duplicate slot ids with VALIDATION_FAILED', async () => {
      repository.findCurrentMedicine.mockResolvedValue({
        id: 'medicine-1',
        userId: 'user-1',
      });

      const result = await collectResult(
        service.upsertGroup('user-1', {
          currentMedicineId: 'medicine-1',
          slots: [
            { id: 'slot-1', scheduledHour: 8, scheduledMinute: 0 },
            { id: 'slot-1', scheduledHour: 20, scheduledMinute: 0 },
          ],
        }),
      );

      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'validation', code: 'VALIDATION_FAILED' },
      });
      expect(repository.transaction).not.toHaveBeenCalled();
      expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
    });

    it('should emit REMINDER_CHANGED exactly once after commit', async () => {
      repository.findCurrentMedicine.mockResolvedValue({
        id: 'medicine-1',
        userId: 'user-1',
      });

      const tx = transactionClient();
      repository.transaction.mockImplementation((fn) =>
        (fn as (txArg: unknown) => Promise<unknown>)(tx),
      );
      tx.userMedicineReminder.findMany.mockResolvedValueOnce([
        reminderRecord({ id: 'slot-1' }),
      ]);
      tx.userMedicineReminder.create.mockResolvedValue(
        reminderRecord({ id: 'slot-1' }),
      );
      tx.userMedicineReminder.updateMany.mockResolvedValue({ count: 0 });

      await unwrapOk(
        service.upsertGroup('user-1', {
          currentMedicineId: 'medicine-1',
          slots: [{ scheduledHour: 8, scheduledMinute: 0 }],
        }),
      );

      expect(eventEmitter.emitAsync).toHaveBeenCalledTimes(1);
      expect(eventEmitter.emitAsync).toHaveBeenCalledWith(REMINDER_CHANGED, {
        userId: 'user-1',
      });
    });

    it('should roll back and not emit an event when the transaction fails', async () => {
      repository.findCurrentMedicine.mockResolvedValue({
        id: 'medicine-1',
        userId: 'user-1',
      });

      // Atomic rollback is guaranteed by Prisma `$transaction`, delegated by the
      // repository (verified in reminder.repository.spec.ts). This test focuses
      // on the service not swallowing the error and not emitting the event: run
      // the transaction callback against the tx client so its writes execute,
      // then reject the transaction to simulate a post-callback failure.
      const tx = transactionClient();
      tx.userMedicineReminder.findMany.mockResolvedValue([]);
      repository.transaction.mockImplementation(async (fn) => {
        await (fn as (txArg: unknown) => Promise<unknown>)(tx);
        throw new Error('boom');
      });

      await expect(
        service.upsertGroup('user-1', {
          currentMedicineId: 'medicine-1',
          slots: [{ scheduledHour: 8, scheduledMinute: 0 }],
        }),
      ).rejects.toThrow('boom');

      expect(repository.transaction).toHaveBeenCalledTimes(1);
      expect(tx.userMedicineReminder.updateMany).toHaveBeenCalled();
      expect(tx.userMedicineReminder.create).toHaveBeenCalled();
      expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
    });

    it('should map a P2002 race inside the transaction to RESOURCE_CONFLICT', async () => {
      repository.findCurrentMedicine.mockResolvedValue({
        id: 'medicine-1',
        userId: 'user-1',
      });

      repository.transaction.mockRejectedValue(
        Object.create(Prisma.PrismaClientKnownRequestError.prototype, {
          code: { value: 'P2002' },
        }),
      );

      const result = await collectResult(
        service.upsertGroup('user-1', {
          currentMedicineId: 'medicine-1',
          slots: [{ scheduledHour: 8, scheduledMinute: 0 }],
        }),
      );

      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'conflict', code: 'RESOURCE_CONFLICT' },
      });
      expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
    });
  });
});
