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
  const worker = { process: vi.fn().mockResolvedValue(undefined) };
  const metrics = {
    recordSuggestionRecomputeEnqueue: vi.fn(),
    recordSuggestionRecomputeDedupe: vi.fn(),
  };

  beforeEach(() => {
    worker.process.mockClear();
    metrics.recordSuggestionRecomputeEnqueue.mockClear();
    metrics.recordSuggestionRecomputeDedupe.mockClear();
  });

  it('is disabled when the shared queue factory has no queue', () => {
    const factory = {
      createQueue: vi.fn().mockReturnValue({ queue: null, worker: null }),
    };
    const service = new RecomputeQueueService(
      factory as never,
      worker as never,
    );

    expect(service.isConfigured).toBe(false);
  });

  it('uses a stable user/date job id and debounce delay', async () => {
    const queue = {
      add: vi.fn().mockResolvedValue({ id: 'job-1' }),
      getJob: vi.fn().mockResolvedValue(null),
    };
    const service = new RecomputeQueueService(
      buildFactory(queue) as never,
      worker as never,
    );

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
    const service = new RecomputeQueueService(
      buildFactory(queue) as never,
      worker as never,
    );

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

  it('records enqueue and dedupe totals without user or date labels', async () => {
    const existing = {
      data: data(),
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
    const service = new RecomputeQueueService(
      buildFactory(queue) as never,
      worker as never,
      metrics as never,
    );

    await service.enqueue(
      data({ userId: 'private-user', localDate: '2026-08-11' }),
    );
    await service.enqueue(
      data({ userId: 'private-user', localDate: '2026-08-11' }),
    );

    expect(metrics.recordSuggestionRecomputeEnqueue).toHaveBeenCalledTimes(2);
    expect(metrics.recordSuggestionRecomputeDedupe).toHaveBeenCalledTimes(1);
    expect(metrics.recordSuggestionRecomputeEnqueue.mock.calls[0]).toHaveLength(
      0,
    );
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
    const service = new RecomputeQueueService(
      buildFactory(queue) as never,
      worker as never,
    );

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

  it('delegates BullMQ processing to the worker', async () => {
    const queue = {
      add: vi.fn().mockResolvedValue({ id: 'job-1' }),
      getJob: vi.fn().mockResolvedValue(null),
    };
    const factory = buildFactory(queue);
    const service = new RecomputeQueueService(
      factory as never,
      worker as never,
    );
    expect(service.isConfigured).toBe(true);
    const options = factory.createQueue.mock.calls[0]?.[0] as {
      processor: (job: { data: RecomputeJobData }) => Promise<void>;
    };

    await options.processor({ data: data() });

    expect(worker.process).toHaveBeenCalledWith(data());
  });

  it('processes inline when Redis is not configured', async () => {
    const factory = {
      createQueue: vi.fn().mockReturnValue({ queue: null, worker: null }),
    };
    const service = new RecomputeQueueService(
      factory as never,
      worker as never,
    );

    await service.enqueue(data());

    expect(worker.process).toHaveBeenCalledWith(data());
  });

  it('processes inline when a configured Redis queue is unavailable at runtime', async () => {
    const queue = {
      add: vi.fn(),
      getJob: vi.fn().mockRejectedValue(new Error('Redis connection lost')),
    };
    const service = new RecomputeQueueService(
      buildFactory(queue) as never,
      worker as never,
    );

    await service.enqueue(data());

    expect(worker.process).toHaveBeenCalledWith(data());
    expect(queue.add).not.toHaveBeenCalled();
  });
});
