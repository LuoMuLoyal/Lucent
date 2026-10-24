import {
  AggregateDeliveryError,
  DomainEventFanOutService,
  EventConsumerRegistry,
  type FanOutOutcome,
} from './domain-events-fanout.service.js';
import type { BullmqQueueFactory } from '../queue/queue.factory.js';
import { QUEUE_NAMES } from '../queue/queue-names.js';

/**
 * The fan-out service reads the static `EVENT_SUBSCRIPTIONS` table, so the
 * table is stubbed here: these tests cover the *mechanism* (which queue gets
 * which job, and what happens when one fails), not the current table contents.
 * The table's own invariants live in `subscriptions.spec.ts`.
 */
const table = vi.hoisted(() => ({
  current: {} as Record<string, readonly { queue: string; job: string }[]>,
}));

vi.mock('./subscriptions.js', () => ({
  subscriptionsFor: (eventName: string) => table.current[eventName] ?? [],
}));

/** Human-readable message of a failed fan-out (test helper). */
function outcomeMessage(outcome: FanOutOutcome): string {
  if (outcome.kind === 'failed') {
    return outcome.error instanceof Error
      ? outcome.error.message
      : String(outcome.error);
  }
  return '';
}

const EVENT = 'daily-record.changed';

/** Claimed-row shape as `DomainEventOutboxService` hands it over. */
function claim(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt-1',
    eventName: EVENT,
    payloadVersion: 1,
    occurredAt: new Date('2026-10-21T00:00:00Z'),
    payload: { userId: 'u1', date: '2026-10-21' },
    ...overrides,
  };
}

describe('EventConsumerRegistry', () => {
  let registry: EventConsumerRegistry;

  beforeEach(() => {
    registry = new EventConsumerRegistry();
  });

  it('resolves a registered handler by queue and job', () => {
    const handler = vi.fn();
    registry.register(
      QUEUE_NAMES.reportCacheInvalidation,
      'invalidate',
      handler,
    );
    expect(
      registry.resolve(QUEUE_NAMES.reportCacheInvalidation, 'invalidate'),
    ).toBe(handler);
    expect(
      registry.has(QUEUE_NAMES.reportCacheInvalidation, 'invalidate'),
    ).toBe(true);
  });

  it('does not confuse the same job name on different queues', () => {
    registry.register(
      QUEUE_NAMES.reportCacheInvalidation,
      'invalidate',
      vi.fn(),
    );
    expect(
      registry.resolve(QUEUE_NAMES.suggestionRecompute, 'invalidate'),
    ).toBe(undefined);
  });

  it('replaces rather than accumulates on repeated registration', () => {
    registry.register(
      QUEUE_NAMES.reportCacheInvalidation,
      'invalidate',
      vi.fn(),
    );
    const second = vi.fn();
    registry.register(
      QUEUE_NAMES.reportCacheInvalidation,
      'invalidate',
      second,
    );
    expect(registry.keys()).toHaveLength(1);
    expect(
      registry.resolve(QUEUE_NAMES.reportCacheInvalidation, 'invalidate'),
    ).toBe(second);
  });

  it('unregisters a handler', () => {
    registry.register(
      QUEUE_NAMES.reportCacheInvalidation,
      'invalidate',
      vi.fn(),
    );
    registry.unregister(QUEUE_NAMES.reportCacheInvalidation, 'invalidate');
    expect(registry.keys()).toHaveLength(0);
  });
});

describe('DomainEventFanOutService', () => {
  let registry: EventConsumerRegistry;
  let queues: Array<{ name: string; add: vi.Mock }>;
  let factory: { isAvailable: boolean; getQueues: () => unknown[] };
  let service: DomainEventFanOutService;

  /** Queue by name; every subscription in these tests addresses a created one. */
  const queueFor = (name: string): { name: string; add: vi.Mock } => {
    const found = queues.find((queue) => queue.name === name);
    if (found == null) {
      throw new Error(`test bug: queue ${name} not created`);
    }
    return found;
  };

  beforeEach(() => {
    registry = new EventConsumerRegistry();
    queues = [
      {
        name: QUEUE_NAMES.reportCacheInvalidation,
        add: vi.fn().mockResolvedValue({ id: 'job-1' }),
      },
      {
        name: QUEUE_NAMES.suggestionRecompute,
        add: vi.fn().mockResolvedValue({ id: 'job-2' }),
      },
      {
        name: QUEUE_NAMES.todayAnalysis,
        add: vi.fn().mockResolvedValue({ id: 'job-3' }),
      },
    ];
    factory = { isAvailable: true, getQueues: () => queues };
    service = new DomainEventFanOutService(
      factory as unknown as BullmqQueueFactory,
      registry,
    );
  });

  describe('queue mode', () => {
    beforeEach(() => {
      table.current = {
        [EVENT]: [
          { queue: QUEUE_NAMES.reportCacheInvalidation, job: 'invalidate' },
          { queue: QUEUE_NAMES.suggestionRecompute, job: 'recompute' },
          { queue: QUEUE_NAMES.todayAnalysis, job: 'generate' },
        ],
      };
    });

    it('adds one job per subscription with the event envelope', async () => {
      const outcome = await service.fanOut(claim());
      expect(outcome).toEqual({ kind: 'delivered', jobs: 3 });

      const reportAdd = queueFor(QUEUE_NAMES.reportCacheInvalidation).add;
      expect(reportAdd).toHaveBeenCalledTimes(1);
      expect(
        queueFor(QUEUE_NAMES.suggestionRecompute).add,
      ).toHaveBeenCalledTimes(1);

      const [jobName, data] = reportAdd.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      expect(jobName).toBe('invalidate');
      expect(data['eventId']).toBe('evt-1');
      expect(data['eventType']).toBe(EVENT);
      expect(data['version']).toBe(1);
      expect(data['occurredAt']).toBe('2026-10-21T00:00:00.000Z');
      // The event's own payload fields travel alongside the envelope.
      expect(data['userId']).toBe('u1');
      expect(data['date']).toBe('2026-10-21');
    });

    it('uses a deterministic job id so a re-run of the fan-out cannot duplicate a job', async () => {
      await service.fanOut(claim());
      await service.fanOut(claim());
      const options = queueFor(QUEUE_NAMES.reportCacheInvalidation).add.mock
        .calls[0]?.[2] as { jobId: string };
      expect(options.jobId).toBe('evt-1:invalidate:report-cache-invalidation');
    });

    it('keeps delivering to the other subscribers when one queue fails', async () => {
      queueFor(QUEUE_NAMES.reportCacheInvalidation).add.mockRejectedValue(
        new Error('redis blip'),
      );
      const outcome = await service.fanOut(claim());
      expect(outcome.kind).toBe('failed');
      expect((outcome as { error: unknown }).error).toBeInstanceOf(
        AggregateDeliveryError,
      );
      expect(
        queueFor(QUEUE_NAMES.suggestionRecompute).add,
      ).toHaveBeenCalledTimes(1);
      expect(queueFor(QUEUE_NAMES.todayAnalysis).add).toHaveBeenCalledTimes(1);
    });

    it('names the failing subscription in the error', async () => {
      queueFor(QUEUE_NAMES.suggestionRecompute).add.mockRejectedValue(
        new Error('redis blip'),
      );
      const outcome = await service.fanOut(claim());
      expect(outcomeMessage(outcome)).toContain(
        'suggestion-recompute#recompute',
      );
      expect(outcomeMessage(outcome)).toContain('redis blip');
    });

    it('reports a subscribed queue that was never created', async () => {
      queues = [];
      const outcome = await service.fanOut(claim());
      expect(outcome.kind).toBe('failed');
      expect(outcomeMessage(outcome)).toContain('no queue created');
    });
  });

  describe('no subscribers', () => {
    beforeEach(() => {
      table.current = {};
    });

    it('settles without creating any job', async () => {
      const outcome = await service.fanOut(claim());
      expect(outcome).toEqual({ kind: 'no-subscribers' });
      for (const queue of queues) {
        expect(queue.add).not.toHaveBeenCalled();
      }
    });

    it('needs no inline consumer either', async () => {
      factory.isAvailable = false;
      queues = [];
      const outcome = await service.fanOut(claim());
      expect(outcome).toEqual({ kind: 'no-subscribers' });
    });
  });

  describe('inline mode (no Redis)', () => {
    beforeEach(() => {
      factory.isAvailable = false;
      queues = [];
      table.current = {
        [EVENT]: [
          { queue: QUEUE_NAMES.reportCacheInvalidation, job: 'invalidate' },
          { queue: QUEUE_NAMES.suggestionRecompute, job: 'recompute' },
        ],
      };
    });

    it('calls the registered inline consumers with the event envelope', async () => {
      const invalidate = vi.fn().mockResolvedValue(undefined);
      const recompute = vi.fn().mockResolvedValue(undefined);
      registry.register(
        QUEUE_NAMES.reportCacheInvalidation,
        'invalidate',
        invalidate,
      );
      registry.register(
        QUEUE_NAMES.suggestionRecompute,
        'recompute',
        recompute,
      );

      const outcome = await service.fanOut(claim());
      expect(outcome).toEqual({ kind: 'delivered', jobs: 2 });
      expect(invalidate).toHaveBeenCalledTimes(1);
      expect(recompute).toHaveBeenCalledTimes(1);
      const passed = invalidate.mock.calls[0]?.[0] as {
        eventId: string;
        userId: string;
      };
      expect(passed.eventId).toBe('evt-1');
      expect(passed.userId).toBe('u1');
    });

    it('fails when a subscriber has neither a queue nor an inline handler', async () => {
      const outcome = await service.fanOut(claim());
      expect(outcome.kind).toBe('failed');
      expect(outcomeMessage(outcome)).toContain('no inline consumer for');
    });

    it('keeps calling the other consumers when one inline handler throws', async () => {
      const invalidate = vi.fn().mockRejectedValue(new Error('cache down'));
      const recompute = vi.fn().mockResolvedValue(undefined);
      registry.register(
        QUEUE_NAMES.reportCacheInvalidation,
        'invalidate',
        invalidate,
      );
      registry.register(
        QUEUE_NAMES.suggestionRecompute,
        'recompute',
        recompute,
      );

      const outcome = await service.fanOut(claim());
      expect(outcome.kind).toBe('failed');
      expect(recompute).toHaveBeenCalledTimes(1);
      expect(outcomeMessage(outcome)).toContain('cache down');
    });
  });
});
