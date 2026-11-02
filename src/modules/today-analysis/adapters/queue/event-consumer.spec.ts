import { HealthEventKind, DailyRecordKind } from '#generated/prisma/client.js';
import { TodayAnalysisEventConsumerService } from './event-consumer.js';
import type { DomainEventJobData } from '../../../../common/index.js';
import type { TodayAnalysisMaterialization } from '../../application/ports/materialization.js';
import type { TodayAnalysisQueueService } from './analysis.js';
import type { TodayAnalysisContextService } from '../acl/analysis-context.js';
import type { BullmqQueueFactory } from '../../../../common/queue/queue.factory.js';
import { EventConsumerRegistry } from '../../../../common/index.js';

function event(
  eventType: string,
  fields: Record<string, unknown> = {},
): DomainEventJobData {
  return {
    eventId: 'evt-1',
    eventType,
    version: 1,
    occurredAt: '2026-10-24T00:00:00.000Z',
    userId: 'u1',
    date: '2026-10-24',
    ...fields,
  };
}

describe('TodayAnalysisEventConsumerService', () => {
  let service: TodayAnalysisEventConsumerService;
  let store: { markPending: vi.Mock };
  let queue: { enqueue: vi.Mock };
  let contextService: {
    invalidateContext: vi.Mock;
    shouldTriggerForDimension: vi.Mock;
  };
  let registry: EventConsumerRegistry;

  function build(redisAvailable: boolean) {
    return new TodayAnalysisEventConsumerService(
      store as unknown as TodayAnalysisMaterialization,
      queue as unknown as TodayAnalysisQueueService,
      contextService as unknown as TodayAnalysisContextService,
      { isAvailable: redisAvailable } as unknown as BullmqQueueFactory,
      registry,
    );
  }

  beforeEach(() => {
    store = {
      markPending: vi.fn().mockResolvedValue({
        shouldQueue: true,
        sourceVersion: 5,
      }),
    };
    queue = { enqueue: vi.fn().mockResolvedValue('job-1') };
    contextService = {
      invalidateContext: vi.fn().mockResolvedValue(undefined),
      shouldTriggerForDimension: vi.fn().mockResolvedValue(true),
    };
    registry = new EventConsumerRegistry();
    service = build(true);
  });

  it('invalidates the context and enqueues for a dose-log change', async () => {
    await service.handle(event('dose-log.changed', { doseLogId: 'd-1' }));

    // Both halves of the old listener must survive: the cache delete is what
    // makes the next analysis rebuild from the changed data.
    expect(contextService.invalidateContext).toHaveBeenCalledWith(
      'u1',
      '2026-10-24',
    );
    expect(store.markPending).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCode: 'dose_log_changed' }),
    );
    expect(queue.enqueue).toHaveBeenCalledWith(
      'u1',
      { date: '2026-10-24' },
      'zh-CN',
      5,
      'dose_log_changed',
      expect.any(String),
    );
  });

  it('enqueues with the version markPending just allocated', async () => {
    // The worker compares its job version against the row; a mismatch would
    // make its own fresh work look superseded.
    store.markPending.mockResolvedValue({
      shouldQueue: true,
      sourceVersion: 9,
    });
    await service.handle(event('dose-log.changed', {}));
    expect(queue.enqueue).toHaveBeenCalledWith(
      'u1',
      expect.anything(),
      'zh-CN',
      9,
      expect.anything(),
      expect.anything(),
    );
  });

  it('invalidates the context before enqueueing', async () => {
    await service.handle(event('dose-log.changed', {}));
    const invalidateOrder =
      contextService.invalidateContext.mock.invocationCallOrder[0];
    const enqueueOrder = queue.enqueue.mock.invocationCallOrder[0];
    expect(invalidateOrder).toBeDefined();
    expect(enqueueOrder).toBeDefined();
    expect(invalidateOrder!).toBeLessThan(enqueueOrder!);
  });

  it('marks pending before enqueueing', async () => {
    await service.handle(event('dose-log.changed', {}));
    const pendingOrder = store.markPending.mock.invocationCallOrder[0];
    const enqueueOrder = queue.enqueue.mock.invocationCallOrder[0];
    expect(pendingOrder!).toBeLessThan(enqueueOrder!);
  });

  it('does not enqueue when markPending says it is already queued', async () => {
    store.markPending.mockResolvedValue({
      shouldQueue: false,
      sourceVersion: 5,
    });
    await service.handle(event('dose-log.changed', {}));
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('always triggers for a symptom daily record', async () => {
    await service.handle(
      event('daily-record.changed', { kind: DailyRecordKind.symptom }),
    );
    expect(store.markPending).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCode: 'symptom_check_in' }),
    );
  });

  it('consults the dimension evaluator for a water record', async () => {
    await service.handle(
      event('daily-record.changed', { kind: DailyRecordKind.water }),
    );
    expect(contextService.shouldTriggerForDimension).toHaveBeenCalledWith(
      'u1',
      '2026-10-24',
      DailyRecordKind.water,
    );
  });

  it('skips the recompute when the dimension evaluator says no, but still invalidates', async () => {
    // The cache is keyed to the data that just changed, so it must drop even
    // when the change is too small to justify a recompute.
    contextService.shouldTriggerForDimension.mockResolvedValue(false);
    await service.handle(
      event('daily-record.changed', { kind: DailyRecordKind.water }),
    );
    expect(contextService.invalidateContext).toHaveBeenCalled();
    expect(store.markPending).not.toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('invalidates but does not recompute for a non-symptom check-in', async () => {
    await service.handle(
      event('health-event.changed', {
        change: 'check-in',
        kind: HealthEventKind.other,
      }),
    );
    expect(contextService.invalidateContext).toHaveBeenCalled();
    expect(store.markPending).not.toHaveBeenCalled();
  });

  it('recomputes for a symptom check-in', async () => {
    await service.handle(
      event('health-event.changed', {
        change: 'check-in',
        kind: HealthEventKind.symptom,
      }),
    );
    expect(store.markPending).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCode: 'health_event_changed' }),
    );
  });

  it('does not invalidate the context for a materialization change', async () => {
    // A materialization already reflects freshly computed suggestions, so
    // dropping the context would only force a rebuild producing the same thing.
    await service.handle(
      event('today-suggestion.materialization.changed', {
        analysisEligible: true,
        sourceVersion: 3,
      }),
    );
    expect(contextService.invalidateContext).not.toHaveBeenCalled();
    expect(store.markPending).toHaveBeenCalledWith(
      expect.objectContaining({
        reasonCode: 'suggestion_materialization_changed',
        requestedSourceVersion: 3,
      }),
    );
  });

  it('skips a materialization change that is not analysis-eligible', async () => {
    await service.handle(
      event('today-suggestion.materialization.changed', {
        analysisEligible: false,
      }),
    );
    expect(store.markPending).not.toHaveBeenCalled();
  });

  it('skips an unknown event without throwing', async () => {
    await service.handle(event('some.unknown.event', {}));
    expect(store.markPending).not.toHaveBeenCalled();
  });

  it('skips a payload with no userId', async () => {
    await service.handle({
      eventId: 'evt-2',
      eventType: 'dose-log.changed',
      version: 1,
      occurredAt: '2026-10-24T00:00:00.000Z',
      date: '2026-10-24',
    });
    expect(store.markPending).not.toHaveBeenCalled();
  });

  it('skips a payload with no date', async () => {
    await service.handle({
      eventId: 'evt-3',
      eventType: 'dose-log.changed',
      version: 1,
      occurredAt: '2026-10-24T00:00:00.000Z',
      userId: 'u1',
    });
    expect(store.markPending).not.toHaveBeenCalled();
  });

  it('never throws when marking pending fails', async () => {
    store.markPending.mockRejectedValue(new Error('db down'));
    await expect(
      service.handle(event('dose-log.changed', {})),
    ).resolves.toBeUndefined();
  });

  it('registers an inline consumer when Redis is not configured', () => {
    const offline = build(false);
    offline.onModuleInit();
    expect(registry.keys().length).toBeGreaterThan(0);
  });

  it('does not register an inline consumer when the queue exists', () => {
    const online = build(true);
    online.onModuleInit();
    expect(registry.keys()).toHaveLength(0);
  });
});
