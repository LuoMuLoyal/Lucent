import { DoseLogStatus } from '#generated/prisma/client.js';

import type {
  DoseLogs,
  DoseLogRecord,
  ReminderSchedule,
} from '../../domain/dose-log/dose-logs.js';
import type { HealthEventGuard } from '../ports/health-event-guard.js';
import { DoseTargetResolver } from './dose-target-resolver.js';

function record(overrides: Partial<DoseLogRecord> = {}): DoseLogRecord {
  return {
    id: 'd1',
    userId: 'u1',
    healthEventId: null,
    currentMedicineId: null,
    reminderId: null,
    status: DoseLogStatus.taken,
    scheduledFor: new Date('2026-07-08T00:00:00.000Z'),
    scheduledTime: null,
    doseText: null,
    note: null,
    source: 'manual',
    takenAt: null,
    deletedAt: null,
    createdAt: new Date('2026-07-08T00:00:00.000Z'),
    updatedAt: new Date('2026-07-08T00:00:00.000Z'),
    ...overrides,
  };
}

class FakeRepository {
  reminders = new Map<string, ReminderSchedule>();
  medicines = new Set<string>();
  existingBySlot: DoseLogRecord | null = null;
  created: unknown[] = [];
  updated: Array<{ id: string; patch: Record<string, unknown> }> = [];
  deleted: string[] = [];

  listByDate() {
    return Promise.resolve({ items: [record()], total: 1 });
  }
  findBySlot() {
    return Promise.resolve(this.existingBySlot);
  }
  findOwned(_userId: string, id: string) {
    return Promise.resolve(
      id === 'd1'
        ? { userId: 'u1', scheduledFor: new Date('2026-07-08T00:00:00.000Z') }
        : null,
    );
  }
  create(input: unknown) {
    this.created.push(input);
    return Promise.resolve(
      record({ reminderId: 'reminder-1', scheduledTime: '08:30' }),
    );
  }
  update(id: string, patch: Record<string, unknown>) {
    this.updated.push({ id, patch });
    return Promise.resolve(
      record({ reminderId: 'reminder-1', scheduledTime: '08:30' }),
    );
  }
  softDelete(id: string) {
    this.deleted.push(id);
    return Promise.resolve();
  }
  findReminder(_userId: string, id: string) {
    return Promise.resolve(this.reminders.get(id) ?? null);
  }
  findOwnedCurrentMedicine(_userId: string, id: string) {
    return Promise.resolve(this.medicines.has(id) ? { userId: 'u1' } : null);
  }
}

function setup() {
  const repository = new FakeRepository();
  const events: Array<{ userId: string; date: string; doseLogId?: string }> =
    [];
  const healthEventCalls: Array<[string, string]> = [];
  let healthEventError: Error | null = null;

  const repositoryPort = repository as unknown as DoseLogs;
  const guard: HealthEventGuard = {
    ensureActiveOwnedByUser: (userId: string, eventId: string) => {
      healthEventCalls.push([userId, eventId]);
      if (healthEventError !== null) {
        return Promise.reject(healthEventError) as never;
      }
      return {
        map: () => undefined,
        andThen: () => undefined,
      } as never;
    },
  } as never;

  const resolver = new DoseTargetResolver(repositoryPort, guard);
  const publisher = {
    doseLogChanged: (input: {
      userId: string;
      date: string;
      doseLogId?: string;
    }) => {
      events.push(input);
      return { andThen: () => undefined } as never;
    },
  };

  return {
    repository,
    repositoryPort,
    resolver,
    guard,
    events,
    healthEventCalls,
    publisher,
    setHealthEventError: (error: Error) => {
      healthEventError = error;
    },
  };
}

describe('DoseTargetResolver', () => {
  it('resolves a reminder slot without the caller repeating the medicine', async () => {
    const { repository, resolver } = setup();
    repository.reminders.set('reminder-1', {
      userId: 'u1',
      currentMedicineId: 'medicine-1',
      scheduledHour: 8,
      scheduledMinute: 30,
    });
    repository.medicines.add('medicine-1');

    await expect(
      resolver.resolve(
        'u1',
        {
          reminderId: 'reminder-1',
          currentMedicineId: undefined,
          scheduledFor: new Date('2026-07-08T00:00:00.000Z'),
          scheduledTime: undefined,
        },
        undefined,
      ),
    ).resolves.toEqual({
      currentMedicineId: 'medicine-1',
      reminderId: 'reminder-1',
      scheduledFor: new Date('2026-07-08T00:00:00.000Z'),
      scheduledTime: '08:30',
    });
  });

  it('rejects a reminder that does not belong to the user', async () => {
    const { resolver } = setup();

    await expect(
      resolver.resolve(
        'u1',
        {
          reminderId: 'reminder-x',
          currentMedicineId: undefined,
          scheduledFor: new Date('2026-07-08T00:00:00.000Z'),
          scheduledTime: undefined,
        },
        undefined,
      ),
    ).rejects.toMatchObject({
      failure: { code: 'RESOURCE_NOT_FOUND' },
    });
  });

  it('rejects a medicine the reminder does not describe', async () => {
    const { repository, resolver } = setup();
    repository.reminders.set('reminder-1', {
      userId: 'u1',
      currentMedicineId: 'medicine-1',
      scheduledHour: 8,
      scheduledMinute: 30,
    });

    await expect(
      resolver.resolve(
        'u1',
        {
          reminderId: 'reminder-1',
          currentMedicineId: 'medicine-2',
          scheduledFor: new Date('2026-07-08T00:00:00.000Z'),
          scheduledTime: undefined,
        },
        undefined,
      ),
    ).rejects.toMatchObject({
      failure: { code: 'DOSE_LOG_TARGET_UNRESOLVED' },
    });
  });

  it('rejects a medicine the user does not own', async () => {
    const { resolver } = setup();

    await expect(
      resolver.resolve(
        'u1',
        {
          reminderId: undefined,
          currentMedicineId: 'foreign',
          scheduledFor: new Date('2026-07-08T00:00:00.000Z'),
          scheduledTime: undefined,
        },
        undefined,
      ),
    ).rejects.toMatchObject({
      failure: { code: 'RESOURCE_NOT_FOUND' },
    });
  });

  it('validates the health event only when one is attached', async () => {
    const { resolver, healthEventCalls } = setup();

    await resolver.resolve(
      'u1',
      {
        reminderId: undefined,
        currentMedicineId: undefined,
        scheduledFor: new Date('2026-07-08T00:00:00.000Z'),
        scheduledTime: undefined,
      },
      undefined,
    );
    expect(healthEventCalls).toEqual([]);
  });

  it('propagates the health-events failure untouched', async () => {
    const { resolver, setHealthEventError } = setup();
    const original = new Error('health-events.not_found');
    setHealthEventError(original);

    await expect(
      resolver.resolve(
        'u1',
        {
          reminderId: undefined,
          currentMedicineId: undefined,
          scheduledFor: new Date('2026-07-08T00:00:00.000Z'),
          scheduledTime: undefined,
        },
        'event-1',
      ),
    ).rejects.toBe(original);
  });
});
