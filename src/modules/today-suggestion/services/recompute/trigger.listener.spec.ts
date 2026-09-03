import { HealthEventKind } from '#generated/prisma/client.js';
import { formatDateOnlyInTimezone } from '../../../../common/index.js';
import {
  DAILY_RECORD_CHANGED,
  DOSE_LOG_CHANGED,
  HEALTH_CONTEXT_CHANGED,
  HEALTH_EVENT_CHANGED,
  REMINDER_CHANGED,
  SETTINGS_CHANGED,
} from '../../../../common/events/domain-events.js';
import { RecomputeTriggerListener } from './trigger.listener.js';

const CURRENT = {
  id: 'materialization-1',
  userId: 'user-1',
  localDate: new Date('2026-08-09T00:00:00.000Z'),
  sourceVersion: 4,
  computedVersion: 4,
  status: 'ready' as const,
  reasonCodes: [],
  lastErrorCode: null,
  queuedAt: null,
  computedAt: new Date('2026-08-09T08:00:00.000Z'),
  updatedAt: new Date('2026-08-09T08:00:00.000Z'),
};

describe('RecomputeTriggerListener', () => {
  let listener: RecomputeTriggerListener;
  let store: { readStatus: vi.Mock; markPending: vi.Mock };
  let queue: { enqueue: vi.Mock };
  let prisma: { user: { findUnique: vi.Mock } };

  beforeEach(() => {
    store = {
      readStatus: vi.fn().mockResolvedValue(CURRENT),
      markPending: vi.fn().mockImplementation((input) =>
        Promise.resolve({
          ...CURRENT,
          localDate: new Date(`${input.localDate}T00:00:00.000Z`),
          sourceVersion: input.sourceVersion,
          status: 'pending',
          reasonCodes: input.reasonCodes,
        }),
      ),
    };
    queue = { enqueue: vi.fn().mockResolvedValue('job-1') };
    prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          profile: { timezone: 'Asia/Shanghai' },
        }),
      },
    };
    listener = new RecomputeTriggerListener(
      store as never,
      queue as never,
      prisma as never,
    );
  });

  it.each([
    [DAILY_RECORD_CHANGED, 'handleDailyRecordChanged', 'daily_record_changed'],
    [DOSE_LOG_CHANGED, 'handleDoseLogChanged', 'dose_log_changed'],
    [REMINDER_CHANGED, 'handleReminderChanged', 'reminder_changed'],
    [
      HEALTH_CONTEXT_CHANGED,
      'handleHealthContextChanged',
      'health_context_changed',
    ],
    [SETTINGS_CHANGED, 'handleSettingsChanged', 'settings_changed'],
    [HEALTH_EVENT_CHANGED, 'handleHealthEventChanged', 'health_event_changed'],
  ] as const)(
    '%s marks pending before enqueueing with reason %s',
    async (_event, methodName, reasonCode) => {
      const payload =
        methodName === 'handleHealthEventChanged'
          ? {
              userId: 'user-1',
              eventId: 'event-1',
              date: '2026-08-08',
              change: 'check-in' as const,
            }
          : methodName === 'handleDailyRecordChanged' ||
              methodName === 'handleDoseLogChanged'
            ? { userId: 'user-1', date: '2026-08-08' }
            : { userId: 'user-1' };

      await listener[methodName](payload as never);

      expect(store.markPending).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          localDate:
            methodName === 'handleHealthEventChanged' ||
            methodName === 'handleDailyRecordChanged' ||
            methodName === 'handleDoseLogChanged'
              ? '2026-08-08'
              : expect.any(String),
          sourceVersion: 5,
          reasonCodes: [reasonCode],
        }),
      );
      expect(queue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          sourceVersion: 5,
          reasonCodes: [reasonCode],
        }),
      );
      const markPendingOrder = store.markPending.mock.invocationCallOrder[0];
      const enqueueOrder = queue.enqueue.mock.invocationCallOrder[0];
      expect(markPendingOrder).toBeDefined();
      expect(enqueueOrder).toBeDefined();
      expect(markPendingOrder!).toBeLessThan(enqueueOrder!);
    },
  );

  it('uses the user timezone for events without an explicit date', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-08-01T18:00:00.000Z'));

      await listener.handleReminderChanged({ userId: 'user-1' });

      expect(store.markPending).toHaveBeenCalledWith(
        expect.objectContaining({
          localDate: formatDateOnlyInTimezone(
            new Date('2026-08-01T18:00:00.000Z'),
            'Asia/Shanghai',
          ),
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not recompute suggestions for a non-symptom check-in', async () => {
    await listener.handleHealthEventChanged({
      userId: 'user-1',
      eventId: 'event-1',
      date: '2026-08-08',
      change: 'check-in',
      kind: HealthEventKind.other,
    });

    expect(store.markPending).not.toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('does not throw when pending marking or enqueueing fails', async () => {
    store.markPending.mockRejectedValueOnce(new Error('database down'));
    await expect(
      listener.handleDailyRecordChanged({
        userId: 'user-1',
        date: '2026-08-08',
      }),
    ).resolves.toBeUndefined();

    store.markPending.mockImplementationOnce((input) =>
      Promise.resolve({
        ...CURRENT,
        sourceVersion: input.sourceVersion,
        status: 'pending',
        reasonCodes: input.reasonCodes,
      }),
    );
    queue.enqueue.mockRejectedValueOnce(new Error('redis down'));
    await expect(
      listener.handleDailyRecordChanged({
        userId: 'user-1',
        date: '2026-08-08',
      }),
    ).resolves.toBeUndefined();
  });
});
