import {
  buildRiskRefreshJobId,
  MEDICINE_RISK_REFRESH_DELAY_MS,
  MedicineRiskRefreshQueueService,
} from './risk-refresh.js';
import {
  EventConsumerRegistry,
  MEDICINE_RISK_REFRESH_JOB,
  type DomainEventJobData,
} from '../../../../common/index.js';
import { QUEUE_NAMES } from '../../../../common/queue/queue-names.js';
import type { BullmqQueueFactory } from '../../../../common/queue/queue.factory.js';
import type { MedicineRiskCheckService } from '../../application/use_cases/check-risk.js';
import {
  createDomainFailure,
  errAsync,
  okAsync,
} from '../../../../common/result/index.js';

function event(
  overrides: Partial<DomainEventJobData> = {},
): DomainEventJobData {
  return {
    eventId: 'evt-1',
    eventType: 'health-context.changed',
    version: 1,
    occurredAt: '2026-10-24T00:00:00.000Z',
    userId: 'u1',
    ...overrides,
  };
}

describe('MedicineRiskRefreshQueueService', () => {
  let riskCheck: { markStale: vi.Mock; runStaticCheck: vi.Mock };
  let registry: EventConsumerRegistry;

  function buildFactory(available: boolean) {
    const queue = {
      name: QUEUE_NAMES.medicineRiskRefresh,
      add: vi.fn().mockResolvedValue({ id: 'job-1' }),
      getJob: vi.fn().mockResolvedValue(null),
    };
    return {
      isAvailable: available,
      getQueues: () => (available ? [queue] : []),
      createQueue: vi.fn(() => ({
        queue: available ? queue : null,
        worker: available ? {} : null,
      })),
      queue,
    };
  }

  function build(available: boolean) {
    const factory = buildFactory(available);
    const service = new MedicineRiskRefreshQueueService(
      factory as unknown as BullmqQueueFactory,
      riskCheck as unknown as MedicineRiskCheckService,
      registry,
    );
    // Nest runs this during bootstrap; the inline registration lives there.
    service.onModuleInit();
    return { service, factory };
  }

  beforeEach(() => {
    riskCheck = {
      markStale: vi.fn().mockResolvedValue(undefined),
      runStaticCheck: vi.fn().mockReturnValue(okAsync(undefined as never)),
    };
    registry = new EventConsumerRegistry();
  });

  it('marks stale and schedules a delayed job', async () => {
    const { service, factory } = build(true);
    await service.refreshForEvent(event());

    expect(riskCheck.markStale).toHaveBeenCalledWith('u1');
    // Not run immediately: the whole point is the debounce window.
    expect(riskCheck.runStaticCheck).not.toHaveBeenCalled();
    expect(factory.queue.add).toHaveBeenCalledWith(
      MEDICINE_RISK_REFRESH_JOB,
      expect.objectContaining({ userId: 'u1' }),
      {
        jobId: buildRiskRefreshJobId('u1'),
        delay: MEDICINE_RISK_REFRESH_DELAY_MS,
      },
    );
  });

  it('keys the job id by user, matching the old per-user timer map', async () => {
    expect(buildRiskRefreshJobId('u1')).toContain('u1');
    const { service, factory } = build(true);
    await service.refreshForEvent(event({ userId: 'u1' }));
    const options = factory.queue.add.mock.calls[0]?.[2] as { jobId: string };
    expect(options.jobId).toBe(buildRiskRefreshJobId('u1'));
  });

  it('does not reschedule a job that is still waiting', async () => {
    // Deliberate: rescheduling on every event would push the deadline back
    // forever for a user whose changes keep arriving inside the window.
    const { service, factory } = build(true);
    factory.queue.getJob.mockResolvedValue({
      getState: vi.fn().mockResolvedValue('delayed'),
      remove: vi.fn(),
    });

    await service.refreshForEvent(event());

    expect(factory.queue.add).not.toHaveBeenCalled();
    expect(riskCheck.markStale).toHaveBeenCalledWith('u1');
  });

  it('replaces a finished job so the next change schedules a fresh check', async () => {
    const { service, factory } = build(true);
    const remove = vi.fn().mockResolvedValue(undefined);
    factory.queue.getJob.mockResolvedValue({
      getState: vi.fn().mockResolvedValue('completed'),
      remove,
    });

    await service.refreshForEvent(event());

    expect(remove).toHaveBeenCalled();
    expect(factory.queue.add).toHaveBeenCalledTimes(1);
  });

  it('schedules even when markStale fails', async () => {
    const { service, factory } = build(true);
    riskCheck.markStale.mockRejectedValue(new Error('db down'));

    await service.refreshForEvent(event());

    expect(factory.queue.add).toHaveBeenCalledTimes(1);
  });

  it('runs the check inline when the queue is unavailable', async () => {
    const { service } = build(false);
    await service.refreshForEvent(event());

    expect(riskCheck.markStale).toHaveBeenCalledWith('u1');
    expect(riskCheck.runStaticCheck).toHaveBeenCalledWith('u1');
  });

  it('registers an inline consumer when Redis is not configured', () => {
    build(false);
    expect(
      registry.has(QUEUE_NAMES.medicineRiskRefresh, MEDICINE_RISK_REFRESH_JOB),
    ).toBe(true);
  });

  it('does not register an inline consumer when the queue exists', () => {
    build(true);
    expect(
      registry.has(QUEUE_NAMES.medicineRiskRefresh, MEDICINE_RISK_REFRESH_JOB),
    ).toBe(false);
  });

  it('runs the check inline when enqueueing fails', async () => {
    // A Redis problem must not drop the refresh: markStale already flagged the
    // record, and the user should not wait for the next unrelated event.
    const { service, factory } = build(true);
    factory.queue.add.mockRejectedValue(new Error('redis down'));

    await service.refreshForEvent(event());

    expect(riskCheck.runStaticCheck).toHaveBeenCalledWith('u1');
  });

  it('does not throw when the static check fails', async () => {
    const { service } = build(false);
    riskCheck.runStaticCheck.mockReturnValue(
      errAsync(
        createDomainFailure({
          kind: 'internal',
          code: 'INTERNAL_ERROR',
          detail: 'boom',
        }),
      ),
    );
    await expect(service.refreshForEvent(event())).resolves.toBeUndefined();
  });

  it('skips a payload with no userId', async () => {
    const { service, factory } = build(true);
    await service.refreshForEvent({
      eventId: 'evt-2',
      eventType: 'reminder.changed',
      version: 1,
      occurredAt: '2026-10-24T00:00:00.000Z',
    });
    expect(riskCheck.markStale).not.toHaveBeenCalled();
    expect(factory.queue.add).not.toHaveBeenCalled();
  });

  it('ignores a job name it does not own', async () => {
    const factory = buildFactory(true);
    new MedicineRiskRefreshQueueService(
      factory as unknown as BullmqQueueFactory,
      riskCheck as unknown as MedicineRiskCheckService,
      registry,
    );
    const calls = factory.createQueue.mock.calls as unknown as Array<
      [
        {
          processor: (job: {
            name: string;
            data: DomainEventJobData;
          }) => Promise<void>;
        },
      ]
    >;
    const processor = calls[0]?.[0];
    await processor?.processor({ name: 'not-mine', data: event() });
    expect(riskCheck.markStale).not.toHaveBeenCalled();
  });
});
