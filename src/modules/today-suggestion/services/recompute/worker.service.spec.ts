import { SuggestionRecomputeWorkerService } from './worker.service';
import type { RecomputeJobData } from './queue.service';

function job(overrides: Partial<RecomputeJobData> = {}): RecomputeJobData {
  return {
    userId: 'user-1',
    localDate: '2026-08-09',
    sourceVersion: 1,
    reasonCodes: ['daily_record_changed'],
    ...overrides,
  };
}

function status(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mat-1',
    userId: 'user-1',
    localDate: new Date('2026-08-09T00:00:00.000Z'),
    sourceVersion: 1,
    computedVersion: 0,
    status: 'pending' as const,
    reasonCodes: ['daily_record_changed' as const],
    lastErrorCode: null,
    queuedAt: new Date('2026-08-09T08:00:00.000Z'),
    computedAt: null,
    updatedAt: new Date('2026-08-09T08:00:00.000Z'),
    ...overrides,
  };
}

describe('SuggestionRecomputeWorkerService', () => {
  it('recomputes the suggestion materialization and marks the same version ready', async () => {
    const suggestionService = {
      recompute: vi.fn().mockResolvedValue({
        generatedAt: '2026-08-09T08:00:01.000Z',
        primary: undefined,
        secondary: undefined,
        observations: undefined,
      }),
    };
    const materializationStore = {
      readStatus: vi.fn().mockResolvedValue(status()),
      markReady: vi.fn().mockResolvedValue(
        status({
          computedVersion: 1,
          status: 'ready',
          computedAt: new Date('2026-08-09T08:00:02.000Z'),
        }),
      ),
      markFailed: vi.fn(),
    };
    const cache = { invalidateSignals: vi.fn().mockResolvedValue(undefined) };
    const worker = new SuggestionRecomputeWorkerService(
      suggestionService as never,
      materializationStore as never,
      cache as never,
    );

    await worker.process(job());

    expect(suggestionService.recompute).toHaveBeenCalledWith(
      'user-1',
      '2026-08-09',
      undefined,
      { locale: 'zh-CN', sourceVersion: 1 },
    );
    expect(cache.invalidateSignals).toHaveBeenCalledWith(
      'user-1',
      '2026-08-09',
    );
    expect(materializationStore.markReady).toHaveBeenCalledWith({
      userId: 'user-1',
      localDate: '2026-08-09',
      sourceVersion: 1,
    });
  });

  it('skips a job whose source version is already ready', async () => {
    const suggestionService = { recompute: vi.fn() };
    const materializationStore = {
      readStatus: vi.fn().mockResolvedValue(
        status({
          sourceVersion: 3,
          computedVersion: 3,
          status: 'ready',
        }),
      ),
      markReady: vi.fn(),
      markFailed: vi.fn(),
    };
    const cache = { invalidateSignals: vi.fn() };
    const worker = new SuggestionRecomputeWorkerService(
      suggestionService as never,
      materializationStore as never,
      cache as never,
    );

    await worker.process(job({ sourceVersion: 3 }));

    expect(suggestionService.recompute).not.toHaveBeenCalled();
    expect(cache.invalidateSignals).not.toHaveBeenCalled();
    expect(materializationStore.markReady).not.toHaveBeenCalled();
  });

  it('marks the exact version failed and rethrows worker errors', async () => {
    const error = new Error('rule failed');
    const suggestionService = {
      recompute: vi.fn().mockRejectedValue(error),
    };
    const materializationStore = {
      readStatus: vi.fn().mockResolvedValue(status()),
      markReady: vi.fn(),
      markFailed: vi.fn().mockResolvedValue(status({ status: 'failed' })),
    };
    const cache = { invalidateSignals: vi.fn().mockResolvedValue(undefined) };
    const worker = new SuggestionRecomputeWorkerService(
      suggestionService as never,
      materializationStore as never,
      cache as never,
    );

    await expect(worker.process(job())).rejects.toThrow('rule failed');

    expect(materializationStore.markFailed).toHaveBeenCalledWith({
      userId: 'user-1',
      localDate: '2026-08-09',
      sourceVersion: 1,
      errorCode: 'RECOMPUTE_FAILED',
    });
  });

  it('preserves the worker error and attempts failed state when status reads fail during recovery', async () => {
    const error = new Error('rule failed');
    const suggestionService = {
      recompute: vi.fn().mockRejectedValue(error),
    };
    const materializationStore = {
      readStatus: vi
        .fn()
        .mockResolvedValueOnce(status())
        .mockRejectedValueOnce(new Error('materialization read failed')),
      markReady: vi.fn(),
      markFailed: vi.fn().mockResolvedValue(status({ status: 'failed' })),
    };
    const cache = { invalidateSignals: vi.fn().mockResolvedValue(undefined) };
    const worker = new SuggestionRecomputeWorkerService(
      suggestionService as never,
      materializationStore as never,
      cache as never,
    );

    await expect(worker.process(job())).rejects.toThrow('rule failed');

    expect(materializationStore.markFailed).toHaveBeenCalledWith({
      userId: 'user-1',
      localDate: '2026-08-09',
      sourceVersion: 1,
      errorCode: 'RECOMPUTE_FAILED',
    });
  });

  it('continues with a newer pending version when an active job was updated', async () => {
    const suggestionService = {
      recompute: vi.fn().mockResolvedValue({ generatedAt: 'old' }),
    };
    const materializationStore = {
      readStatus: vi
        .fn()
        .mockResolvedValueOnce(status())
        .mockResolvedValueOnce(status({ sourceVersion: 2 }))
        .mockResolvedValueOnce(status({ sourceVersion: 2 }))
        .mockResolvedValueOnce(status({ sourceVersion: 2 }))
        .mockResolvedValueOnce(
          status({ sourceVersion: 2, status: 'ready', computedVersion: 2 }),
        ),
      markReady: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn(),
    };
    const cache = { invalidateSignals: vi.fn().mockResolvedValue(undefined) };
    const worker = new SuggestionRecomputeWorkerService(
      suggestionService as never,
      materializationStore as never,
      cache as never,
    );

    await worker.process(job());

    expect(suggestionService.recompute).toHaveBeenCalledTimes(2);
    expect(materializationStore.markReady).toHaveBeenCalledWith({
      userId: 'user-1',
      localDate: '2026-08-09',
      sourceVersion: 2,
    });
  });

  it('continues with a newer pending version when the older recompute fails', async () => {
    const suggestionService = {
      recompute: vi
        .fn()
        .mockRejectedValueOnce(new Error('old version failed'))
        .mockResolvedValueOnce({ generatedAt: 'new' }),
    };
    const materializationStore = {
      readStatus: vi
        .fn()
        .mockResolvedValueOnce(status())
        .mockResolvedValueOnce(status({ sourceVersion: 2 }))
        .mockResolvedValueOnce(status({ sourceVersion: 2 }))
        .mockResolvedValueOnce(
          status({ sourceVersion: 2, status: 'ready', computedVersion: 2 }),
        )
        .mockResolvedValueOnce(
          status({ sourceVersion: 2, status: 'ready', computedVersion: 2 }),
        ),
      markReady: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn(),
    };
    const cache = { invalidateSignals: vi.fn().mockResolvedValue(undefined) };
    const worker = new SuggestionRecomputeWorkerService(
      suggestionService as never,
      materializationStore as never,
      cache as never,
    );

    await worker.process(job());

    expect(suggestionService.recompute).toHaveBeenCalledTimes(2);
    expect(materializationStore.markFailed).not.toHaveBeenCalled();
    expect(materializationStore.markReady).toHaveBeenCalledWith({
      userId: 'user-1',
      localDate: '2026-08-09',
      sourceVersion: 2,
    });
  });
});
