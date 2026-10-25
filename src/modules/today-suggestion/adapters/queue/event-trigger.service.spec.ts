import { HealthEventKind } from '#generated/prisma/client.js';
import { formatDateOnlyInTimezone } from '../../../../common/index.js';
import type { DomainEventJobData } from '../../../../common/index.js';
import { RecomputeEventTriggerService } from './event-trigger.service.js';
import type { SuggestionCachePort } from '../../application/ports/suggestion-cache.js';
import type { MaterializationStorePort } from '../../application/ports/materialization.js';
import type { PrismaService } from '../../../../prisma/index.js';

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

/** Fanned-out event envelope plus the event's own fields. */
function event(
  eventType: string,
  fields: Record<string, unknown> = {},
): DomainEventJobData {
  return {
    eventId: 'evt-1',
    eventType,
    version: 1,
    occurredAt: '2026-08-09T00:00:00.000Z',
    userId: 'user-1',
    ...fields,
  };
}

describe('RecomputeEventTriggerService', () => {
  let service: RecomputeEventTriggerService;
  let store: { readStatus: vi.Mock; markPending: vi.Mock };
  let cache: { invalidateSignals: vi.Mock; invalidateBaseline: vi.Mock };
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
    cache = {
      invalidateSignals: vi.fn().mockResolvedValue(undefined),
      invalidateBaseline: vi.fn().mockResolvedValue(undefined),
    };
    prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          profile: { timezone: 'Asia/Shanghai' },
        }),
      },
    };
    service = new RecomputeEventTriggerService(
      store as unknown as MaterializationStorePort,
      cache as unknown as SuggestionCachePort,
      prisma as unknown as PrismaService,
    );
  });

  it.each([
    ['daily-record.changed', 'daily_record_changed'],
    ['dose-log.changed', 'dose_log_changed'],
    ['reminder.changed', 'reminder_changed'],
    ['health-context.changed', 'health_context_changed'],
    ['settings.changed', 'settings_changed'],
    ['health-event.changed', 'health_event_changed'],
  ] as const)('%s maps to reason code %s', async (eventType, reasonCode) => {
    const resolved = await service.resolve(
      event(eventType, { date: '2026-08-08' }),
    );
    expect(store.markPending).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCodes: [reasonCode] }),
    );
    expect(resolved?.reasonCodes).toEqual([reasonCode]);
  });

  it('bumps the source version from the row it just read', async () => {
    const resolved = await service.resolve(
      event('daily-record.changed', { date: '2026-08-08' }),
    );
    expect(store.readStatus).toHaveBeenCalledWith('user-1', '2026-08-08');
    expect(store.markPending).toHaveBeenCalledWith(
      expect.objectContaining({ sourceVersion: 5 }),
    );
    // The enqueued version must be the one just written, not the one read.
    expect(resolved?.sourceVersion).toBe(5);
  });

  it('invalidates caches before marking pending and enqueueing', async () => {
    // Order is the whole reason these two old listeners became one consumer: a
    // recompute that ran before the invalidation would persist a result built
    // from signals already known to be stale.
    const resolved = await service.resolve(
      event('daily-record.changed', { date: '2026-08-08' }),
    );
    expect(resolved).not.toBeNull();

    const invalidateOrder = cache.invalidateSignals.mock.invocationCallOrder[0];
    const pendingOrder = store.markPending.mock.invocationCallOrder[0];
    expect(invalidateOrder).toBeDefined();
    expect(pendingOrder).toBeDefined();
    expect(invalidateOrder!).toBeLessThan(pendingOrder!);
  });

  it('invalidates signals for the payload date when the event carries one', async () => {
    await service.resolve(
      event('daily-record.changed', { date: '2026-08-08' }),
    );
    expect(cache.invalidateSignals).toHaveBeenCalledWith(
      'user-1',
      '2026-08-08',
    );
  });

  it('uses the user timezone for events without an explicit date', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-08-01T18:00:00.000Z'));
      await service.resolve(event('reminder.changed'));
      expect(cache.invalidateSignals).toHaveBeenCalledWith(
        'user-1',
        formatDateOnlyInTimezone(
          new Date('2026-08-01T18:00:00.000Z'),
          'Asia/Shanghai',
        ),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['reminder.changed', 'health-context.changed', 'settings.changed'])(
    'also invalidates the baseline for %s',
    async (eventType) => {
      await service.resolve(event(eventType));
      expect(cache.invalidateBaseline).toHaveBeenCalledWith('user-1');
    },
  );

  it.each(['daily-record.changed', 'dose-log.changed', 'health-event.changed'])(
    'does not touch the baseline for %s',
    async (eventType) => {
      await service.resolve(event(eventType, { date: '2026-08-08' }));
      expect(cache.invalidateBaseline).not.toHaveBeenCalled();
    },
  );

  it('invalidates caches but skips the recompute for a non-symptom check-in', async () => {
    const resolved = await service.resolve(
      event('health-event.changed', {
        date: '2026-08-08',
        change: 'check-in',
        kind: HealthEventKind.other,
      }),
    );
    expect(resolved).toBeNull();
    expect(store.markPending).not.toHaveBeenCalled();
    // The old cache listener had no filter, so this must still invalidate.
    expect(cache.invalidateSignals).toHaveBeenCalledWith(
      'user-1',
      '2026-08-08',
    );
  });

  it('recomputes for a symptom check-in', async () => {
    const resolved = await service.resolve(
      event('health-event.changed', {
        date: '2026-08-08',
        change: 'check-in',
        kind: HealthEventKind.symptom,
      }),
    );
    expect(resolved).not.toBeNull();
  });

  it('skips a payload with no userId', async () => {
    const resolved = await service.resolve({
      eventId: 'evt-2',
      eventType: 'daily-record.changed',
      version: 1,
      occurredAt: '2026-08-09T00:00:00.000Z',
    });
    expect(resolved).toBeNull();
    expect(store.markPending).not.toHaveBeenCalled();
  });

  it('skips an event it has no reason code for, without throwing', async () => {
    // The table routed it here but this consumer does not know it: settle the
    // job rather than retry forever.
    const resolved = await service.resolve(event('unknown.event'));
    expect(resolved).toBeNull();
    expect(store.markPending).not.toHaveBeenCalled();
  });

  it('returns null instead of throwing when marking pending fails', async () => {
    store.markPending.mockRejectedValueOnce(new Error('database down'));
    await expect(
      service.resolve(event('daily-record.changed', { date: '2026-08-08' })),
    ).resolves.toBeNull();
  });

  it('still recomputes when cache invalidation fails', async () => {
    // The cache is an accelerator; the worker re-invalidates signals itself, so
    // a cache failure must not silently drop the recompute.
    cache.invalidateSignals.mockRejectedValueOnce(new Error('redis down'));
    const resolved = await service.resolve(
      event('daily-record.changed', { date: '2026-08-08' }),
    );
    expect(resolved).not.toBeNull();
  });

  it('falls back to the default timezone when the profile has none', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-08-01T18:00:00.000Z'));
      prisma.user.findUnique.mockResolvedValue({ profile: null });
      await service.resolve(event('reminder.changed'));
      expect(cache.invalidateSignals).toHaveBeenCalledWith(
        'user-1',
        formatDateOnlyInTimezone(new Date('2026-08-01T18:00:00.000Z'), null),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
