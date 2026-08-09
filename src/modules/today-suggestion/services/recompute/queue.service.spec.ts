import {
  buildRecomputeJobId,
  RECOMPUTE_DEBOUNCE_MS,
  RecomputeQueueService,
  type RecomputeJobData,
} from './queue.service';

function buildFactory(queue: { add: vi.Mock; getJob: vi.Mock }): {
  createQueue: vi.Mock;
} {
  return {
    createQueue: vi.fn().mockReturnValue({
      queue,
      worker: { close: vi.fn() },
    }),
  };
}

function data(overrides: Partial<RecomputeJobData> = {}): RecomputeJobData {
  return {
    userId: 'user-1',
    localDate: '2026-08-09',
    sourceVersion: 1,
    reasonCodes: ['daily_record_changed'],
    ...overrides,
  };
}

describe('RecomputeQueueService', () => {
  it('is disabled when the shared queue factory has no queue', () => {
    const factory = {
      createQueue: vi.fn().mockReturnValue({ queue: null, worker: null }),
    };
    const service = new RecomputeQueueService(factory as never);

    expect(service.isConfigured).toBe(false);
  });

  it('uses a stable user/date job id and debounce delay', async () => {
    const queue = {
      add: vi.fn().mockResolvedValue({ id: 'job-1' }),
      getJob: vi.fn().mockResolvedValue(null),
    };
    const service = new RecomputeQueueService(buildFactory(queue) as never);

    await service.enqueue(data());

    expect(queue.add).toHaveBeenCalledWith(
      'recompute',
      data(),
      expect.objectContaining({
        jobId: buildRecomputeJobId('user-1', '2026-08-09'),
        delay: RECOMPUTE_DEBOUNCE_MS,
      }),
    );
  });

  it('updates one delayed job with merged reasons and the newest version', async () => {
    const first = data();
    const existing = {
      data: first,
      getState: vi.fn().mockResolvedValue('delayed'),
      updateData: vi.fn().mockResolvedValue(undefined),
      changeDelay: vi.fn().mockResolvedValue(undefined),
    };
    const queue = {
      add: vi.fn().mockResolvedValue({ id: 'job-1' }),
      getJob: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(existing),
    };
    const service = new RecomputeQueueService(buildFactory(queue) as never);

    await service.enqueue(first);
    await service.enqueue(
      data({
        sourceVersion: 2,
        reasonCodes: ['health_event_changed'],
      }),
    );

    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(existing.updateData).toHaveBeenCalledWith({
      ...first,
      sourceVersion: 2,
      reasonCodes: ['daily_record_changed', 'health_event_changed'],
    });
    expect(existing.changeDelay).toHaveBeenCalledWith(RECOMPUTE_DEBOUNCE_MS);
  });

  it('replaces a completed job instead of reusing stale retained work', async () => {
    const existing = {
      data: data(),
      getState: vi.fn().mockResolvedValue('completed'),
      remove: vi.fn().mockResolvedValue(undefined),
      updateData: vi.fn(),
      changeDelay: vi.fn(),
    };
    const queue = {
      add: vi.fn().mockResolvedValue({ id: 'job-2' }),
      getJob: vi.fn().mockResolvedValue(existing),
    };
    const service = new RecomputeQueueService(buildFactory(queue) as never);

    await service.enqueue(data({ sourceVersion: 2 }));

    expect(existing.remove).toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledWith(
      'recompute',
      data({ sourceVersion: 2 }),
      expect.objectContaining({
        jobId: buildRecomputeJobId('user-1', '2026-08-09'),
      }),
    );
  });
});
