import { ReportsCacheInvalidationQueueService } from './cache-invalidation.js';
import { QUEUE_NAMES } from '../../../../common/queue/queue-names.js';
import {
  EventConsumerRegistry,
  REPORT_CACHE_INVALIDATION_JOB,
} from '../../../../common/index.js';
import type { BullmqQueueFactory } from '../../../../common/queue/queue.factory.js';
import type { ReportsService } from '../../application/use_cases/get-dashboard.js';

describe('ReportsCacheInvalidationQueueService', () => {
  let reportsService: { invalidateUserDashboard: vi.Mock };
  let registry: EventConsumerRegistry;

  /** Factory double: `isAvailable` decides which delivery mode is exercised. */
  function buildFactory(available: boolean) {
    const queue = { name: QUEUE_NAMES.reportCacheInvalidation, add: vi.fn() };
    return {
      isAvailable: available,
      getQueues: () => (available ? [queue] : []),
      createQueue: vi.fn(() => ({
        queue: available ? queue : null,
        worker: available ? {} : null,
      })),
    };
  }

  function build(available: boolean): ReportsCacheInvalidationQueueService {
    const service = new ReportsCacheInvalidationQueueService(
      buildFactory(available) as unknown as BullmqQueueFactory,
      reportsService as unknown as ReportsService,
      registry,
    );
    // Nest calls this during module bootstrap; the inline-consumer
    // registration lives there, so the test must run it too.
    service.onModuleInit();
    return service;
  }

  beforeEach(() => {
    reportsService = {
      invalidateUserDashboard: vi.fn().mockResolvedValue(undefined),
    };
    registry = new EventConsumerRegistry();
  });

  it('invalidates the dashboard for the event user', async () => {
    const service = build(true);
    await service.invalidateFromEvent({
      eventId: 'evt-1',
      eventType: 'daily-record.changed',
      version: 1,
      occurredAt: '2026-10-24T00:00:00.000Z',
      userId: 'u1',
    });
    expect(reportsService.invalidateUserDashboard).toHaveBeenCalledWith('u1');
  });

  it('registers an inline consumer when Redis is not configured', () => {
    // Local development and e2e have no Redis; without this the fan-out would
    // report a missing consumer and the dashboard would never be invalidated.
    build(false);
    expect(
      registry.has(
        QUEUE_NAMES.reportCacheInvalidation,
        REPORT_CACHE_INVALIDATION_JOB,
      ),
    ).toBe(true);
  });

  it('does not register an inline consumer when the queue exists', () => {
    build(true);
    expect(
      registry.has(
        QUEUE_NAMES.reportCacheInvalidation,
        REPORT_CACHE_INVALIDATION_JOB,
      ),
    ).toBe(false);
  });

  it('calls the same logic through the inline consumer', async () => {
    build(false);
    const inline = registry.resolve(
      QUEUE_NAMES.reportCacheInvalidation,
      REPORT_CACHE_INVALIDATION_JOB,
    );
    await inline?.({
      eventId: 'evt-2',
      eventType: 'dose-log.changed',
      version: 1,
      occurredAt: '2026-10-24T00:00:00.000Z',
      userId: 'u2',
    });
    expect(reportsService.invalidateUserDashboard).toHaveBeenCalledWith('u2');
  });

  it('skips a payload without a userId instead of retrying forever', async () => {
    const service = build(true);
    await service.invalidateFromEvent({
      eventId: 'evt-3',
      eventType: 'daily-record.changed',
      version: 1,
      occurredAt: '2026-10-24T00:00:00.000Z',
    });
    expect(reportsService.invalidateUserDashboard).not.toHaveBeenCalled();
  });

  it('skips a blank userId', async () => {
    const service = build(true);
    await service.invalidateFromEvent({
      eventId: 'evt-4',
      eventType: 'daily-record.changed',
      version: 1,
      occurredAt: '2026-10-24T00:00:00.000Z',
      userId: '',
    });
    expect(reportsService.invalidateUserDashboard).not.toHaveBeenCalled();
  });
});
