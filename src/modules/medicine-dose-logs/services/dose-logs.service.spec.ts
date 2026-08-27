import { Test } from '@nestjs/testing';
import { type Mocked } from 'vitest';
import { DoseLogStatus } from '#generated/prisma/client';
import {
  createDomainFailure,
  errAsync,
  fromPromise,
  okAsync,
} from '../../../common/result';
import type { DomainFailure, ResultAsync } from '../../../common/result';
import { MedicineDoseLogRepositoryPort } from '../repositories/dose-log.repository';
import { MedicineDoseLogsService } from './dose-logs.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { HealthEventsOwnershipService } from '../../health-events';
import type { CreateDoseLogDto } from '../dto/create-dose-log.dto';
import type { MarkDoseLogDto } from '../dto/mark-dose-log.dto';

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

function doseLogRecord(overrides: Record<string, unknown> = {}) {
  return {
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
    createdAt: new Date('2026-06-04T00:00:00.000Z'),
    updatedAt: new Date('2026-06-04T00:00:00.000Z'),
    ...overrides,
  };
}

describe('MedicineDoseLogsService', () => {
  let service: MedicineDoseLogsService;

  let repository: Mocked<MedicineDoseLogRepositoryPort>;

  let healthEventsOwnership: Mocked<HealthEventsOwnershipService>;

  beforeEach(async () => {
    const m = await Test.createTestingModule({
      providers: [
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
    repository.create.mockReturnValue(okAsync(doseLogRecord()));
    repository.findManyWithCount.mockResolvedValue({
      items: [doseLogRecord()],
      total: 1,
    });

    await unwrapOk(
      service.create('u1', {
        status: DoseLogStatus.taken,
        scheduledFor: '2026-06-04',
      } as CreateDoseLogDto),
    );
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
    repository.create.mockReturnValue(
      okAsync(doseLogRecord({ healthEventId: 'event-1' })),
    );

    const dto = {
      status: DoseLogStatus.taken,
      scheduledFor: '2026-06-04',
      healthEventId: 'event-1',
    } as Parameters<MedicineDoseLogsService['create']>[1] & {
      healthEventId: string;
    };

    const result = await unwrapOk(service.create('u1', dto));

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
    const error = new Error('health-events.inactive');
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
    const error = new Error('health-events.not_found');
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

    const result = await collectResult(
      service.create('u1', {
        status: DoseLogStatus.taken,
        scheduledFor: '2026-06-04',
        currentMedicineId: 'm1',
      } as CreateDoseLogDto),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'not_found', code: 'RESOURCE_NOT_FOUND' },
    });
  });

  it('should soft-delete', async () => {
    repository.findFirst.mockResolvedValue({ userId: 'u1' });
    repository.update.mockReturnValue(okAsync(doseLogRecord({ id: 'd1' })));

    await unwrapOk(service.delete('u1', 'd1'));

    expect(repository.update).toHaveBeenCalledWith(
      { id: 'd1' },
      { deletedAt: expect.any(Date) },
    );
  });

  it('should map a missing dose-log delete to RESOURCE_NOT_FOUND', async () => {
    repository.findFirst.mockResolvedValue(null);

    const result = await collectResult(service.delete('u1', 'd1'));

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'not_found', code: 'RESOURCE_NOT_FOUND' },
    });
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('should update omitted fields without clearing nullable values', async () => {
    repository.findFirst.mockResolvedValue({ userId: 'u1' });
    repository.update.mockReturnValue(
      okAsync(
        doseLogRecord({
          id: 'd1',
          status: DoseLogStatus.skipped,
          doseText: '1 tablet',
          note: 'with food',
        }),
      ),
    );

    await unwrapOk(
      service.update('u1', 'd1', { status: DoseLogStatus.skipped }),
    );

    expect(repository.update).toHaveBeenCalledWith(
      { id: 'd1' },
      { status: DoseLogStatus.skipped, takenAt: null },
    );
  });

  it('should clear nullable dose fields when null is provided', async () => {
    repository.findFirst.mockResolvedValue({ userId: 'u1' });
    repository.update.mockReturnValue(
      okAsync(doseLogRecord({ id: 'd1', doseText: null, note: null })),
    );

    await unwrapOk(service.update('u1', 'd1', { doseText: null, note: null }));

    expect(repository.update).toHaveBeenCalledWith(
      { id: 'd1' },
      { doseText: null, note: null },
    );
  });

  it('should reject foreign dose-log updates', async () => {
    repository.findFirst.mockResolvedValue(null);

    const result = await collectResult(
      service.update('u1', 'd1', { status: DoseLogStatus.taken }),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'not_found', code: 'RESOURCE_NOT_FOUND' },
    });
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('should upsert an existing reminder slot dose log when mark is called', async () => {
    repository.findReminderById.mockResolvedValue({
      userId: 'u1',
      currentMedicineId: 'medicine-1',
      scheduledHour: 8,
      scheduledMinute: 30,
    });
    repository.findCurrentMedicineById.mockResolvedValue({ userId: 'u1' });
    repository.findFirst.mockResolvedValue(
      doseLogRecord({
        id: 'dose-1',
        currentMedicineId: 'medicine-1',
        reminderId: 'reminder-1',
        status: DoseLogStatus.planned,
        scheduledFor: new Date('2026-07-08T00:00:00.000Z'),
        scheduledTime: '08:30',
        createdAt: new Date('2026-07-08T01:00:00.000Z'),
        updatedAt: new Date('2026-07-08T01:00:00.000Z'),
      }),
    );
    repository.update.mockReturnValue(
      okAsync(
        doseLogRecord({
          id: 'dose-1',
          currentMedicineId: 'medicine-1',
          reminderId: 'reminder-1',
          status: DoseLogStatus.taken,
          scheduledFor: new Date('2026-07-08T00:00:00.000Z'),
          scheduledTime: '08:30',
          note: 'after breakfast',
          updatedAt: new Date('2026-07-08T02:00:00.000Z'),
          takenAt: new Date('2026-07-08T02:00:00.000Z'),
        }),
      ),
    );

    const result = await unwrapOk(
      service.mark('u1', {
        currentMedicineId: 'medicine-1',
        reminderId: 'reminder-1',
        status: DoseLogStatus.taken,
        scheduledFor: '2026-07-08',
        scheduledTime: '08:30',
        note: 'after breakfast',
      } as MarkDoseLogDto),
    );

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
    repository.findFirst.mockResolvedValue(
      doseLogRecord({
        id: 'temporary-dose-1',
        currentMedicineId: 'medicine-1',
        status: DoseLogStatus.taken,
        scheduledFor: new Date('2026-07-08T00:00:00.000Z'),
        scheduledTime: '08:30',
        takenAt: new Date('2026-07-08T01:00:00.000Z'),
      }),
    );
    repository.create.mockReturnValue(
      okAsync(
        doseLogRecord({
          id: 'temporary-dose-2',
          currentMedicineId: 'medicine-1',
          status: DoseLogStatus.taken,
          scheduledFor: new Date('2026-07-08T00:00:00.000Z'),
          scheduledTime: '08:30',
          createdAt: new Date('2026-07-08T02:00:00.000Z'),
          updatedAt: new Date('2026-07-08T02:00:00.000Z'),
          takenAt: new Date('2026-07-08T02:00:00.000Z'),
        }),
      ),
    );

    await unwrapOk(
      service.mark('u1', {
        currentMedicineId: 'medicine-1',
        status: DoseLogStatus.taken,
        scheduledFor: '2026-07-08',
        scheduledTime: '08:30',
      } as MarkDoseLogDto),
    );

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
    repository.create.mockReturnValue(
      okAsync(
        doseLogRecord({
          id: 'dose-1',
          healthEventId: 'event-1',
          currentMedicineId: 'medicine-1',
          status: DoseLogStatus.taken,
          scheduledFor: new Date('2026-07-08T00:00:00.000Z'),
          scheduledTime: '08:30',
          updatedAt: new Date('2026-07-08T02:00:00.000Z'),
          takenAt: new Date('2026-07-08T02:00:00.000Z'),
        }),
      ),
    );

    const dto = {
      currentMedicineId: 'medicine-1',
      status: DoseLogStatus.taken,
      scheduledFor: '2026-07-08',
      scheduledTime: '08:30',
      healthEventId: 'event-1',
    } as Parameters<MedicineDoseLogsService['mark']>[1] & {
      healthEventId: string;
    };

    await unwrapOk(service.mark('u1', dto));

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
    repository.findFirst.mockResolvedValue(
      doseLogRecord({
        id: 'dose-1',
        healthEventId: 'existing-event',
        currentMedicineId: 'medicine-1',
        status: DoseLogStatus.planned,
        scheduledFor: new Date('2026-07-08T00:00:00.000Z'),
        scheduledTime: '08:30',
        updatedAt: new Date('2026-07-08T01:00:00.000Z'),
      }),
    );
    repository.update.mockReturnValue(
      okAsync(
        doseLogRecord({
          id: 'dose-1',
          healthEventId: 'existing-event',
          currentMedicineId: 'medicine-1',
          status: DoseLogStatus.taken,
          scheduledFor: new Date('2026-07-08T00:00:00.000Z'),
          scheduledTime: '08:30',
          updatedAt: new Date('2026-07-08T02:00:00.000Z'),
          takenAt: new Date('2026-07-08T02:00:00.000Z'),
        }),
      ),
    );

    await unwrapOk(
      service.mark('u1', {
        currentMedicineId: 'medicine-1',
        reminderId: 'reminder-1',
        status: DoseLogStatus.taken,
        scheduledFor: '2026-07-08',
        scheduledTime: '08:30',
      } as MarkDoseLogDto),
    );

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
    repository.findFirst.mockResolvedValue(
      doseLogRecord({
        id: 'dose-1',
        healthEventId: 'existing-event',
        currentMedicineId: 'medicine-1',
        status: DoseLogStatus.planned,
        scheduledFor: new Date('2026-07-08T00:00:00.000Z'),
        scheduledTime: '08:30',
        updatedAt: new Date('2026-07-08T01:00:00.000Z'),
      }),
    );
    repository.update.mockReturnValue(
      okAsync(
        doseLogRecord({
          id: 'dose-1',
          healthEventId: null,
          currentMedicineId: 'medicine-1',
          status: DoseLogStatus.taken,
          scheduledFor: new Date('2026-07-08T00:00:00.000Z'),
          scheduledTime: '08:30',
          updatedAt: new Date('2026-07-08T02:00:00.000Z'),
          takenAt: new Date('2026-07-08T02:00:00.000Z'),
        }),
      ),
    );

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

    await unwrapOk(service.mark('u1', dto));

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
    repository.findFirst.mockResolvedValue(
      doseLogRecord({
        id: 'dose-1',
        healthEventId: 'existing-event',
        currentMedicineId: 'medicine-1',
        status: DoseLogStatus.planned,
        scheduledFor: new Date('2026-07-08T00:00:00.000Z'),
        scheduledTime: '08:30',
        updatedAt: new Date('2026-07-08T01:00:00.000Z'),
      }),
    );
    repository.update.mockReturnValue(
      okAsync(
        doseLogRecord({
          id: 'dose-1',
          healthEventId: 'new-event',
          currentMedicineId: 'medicine-1',
          status: DoseLogStatus.taken,
          scheduledFor: new Date('2026-07-08T00:00:00.000Z'),
          scheduledTime: '08:30',
          updatedAt: new Date('2026-07-08T02:00:00.000Z'),
          takenAt: new Date('2026-07-08T02:00:00.000Z'),
        }),
      ),
    );

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

    await unwrapOk(service.mark('u1', dto));

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

    const result = await collectResult(
      service.mark('u1', {
        currentMedicineId: 'medicine-1',
        reminderId: 'reminder-1',
        status: DoseLogStatus.taken,
        scheduledFor: '2026-07-08',
        scheduledTime: '08:30',
      } as MarkDoseLogDto),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'not_found', code: 'RESOURCE_NOT_FOUND' },
    });
  });

  it('should reject mark when neither reminderId nor currentMedicineId is provided', async () => {
    const result = await collectResult(
      service.mark('u1', {
        status: DoseLogStatus.taken,
        scheduledFor: '2026-07-08',
      } as MarkDoseLogDto),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'validation', code: 'VALIDATION_FAILED' },
    });
  });

  it('should create mark when currentMedicineId is provided without scheduledTime (temporary log)', async () => {
    repository.findCurrentMedicineById.mockResolvedValue({ userId: 'u1' });
    repository.create.mockReturnValue(
      okAsync(
        doseLogRecord({
          id: 'log-1',
          currentMedicineId: 'medicine-1',
          status: DoseLogStatus.taken,
          scheduledFor: new Date('2026-07-08T00:00:00.000Z'),
          scheduledTime: null,
        }),
      ),
    );

    const result = await collectResult(
      service.mark('u1', {
        currentMedicineId: 'medicine-1',
        status: DoseLogStatus.taken,
        scheduledFor: '2026-07-08',
      } as MarkDoseLogDto),
    );

    expect(result).toMatchObject({ ok: true });
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        currentMedicineId: 'medicine-1',
        scheduledTime: null,
      }),
    );
  });

  it('should reject mark when the slot medicine does not match the reminder', async () => {
    repository.findReminderById.mockResolvedValue({
      userId: 'u1',
      currentMedicineId: 'medicine-1',
      scheduledHour: 8,
      scheduledMinute: 30,
    });

    const result = await collectResult(
      service.mark('u1', {
        currentMedicineId: 'medicine-2',
        reminderId: 'reminder-1',
        status: DoseLogStatus.taken,
        scheduledFor: '2026-07-08',
        scheduledTime: '08:30',
      } as MarkDoseLogDto),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'validation', code: 'VALIDATION_FAILED' },
    });
    expect(repository.findFirst).not.toHaveBeenCalled();
  });

  it('maps a P2002 race on create to RESOURCE_CONFLICT', async () => {
    repository.create.mockReturnValue(
      errAsync(
        createDomainFailure({
          kind: 'conflict',
          code: 'RESOURCE_CONFLICT',
        }),
      ),
    );

    const result = await collectResult(
      service.create('u1', {
        status: DoseLogStatus.taken,
        scheduledFor: '2026-06-04',
      } as CreateDoseLogDto),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'conflict', code: 'RESOURCE_CONFLICT' },
    });
  });

  it('rethrows unknown database errors on create', async () => {
    // The repository rethrows unknown DB errors from within fromPrismaResult,
    // producing a *rejected* ResultAsync; the service chain must propagate it.
    repository.create.mockReturnValue(
      fromPromise(Promise.reject(new Error('connection lost')), (error) => {
        throw error;
      }),
    );

    await expect(
      service.create('u1', {
        status: DoseLogStatus.taken,
        scheduledFor: '2026-06-04',
      } as CreateDoseLogDto),
    ).rejects.toThrow('connection lost');
  });
});
