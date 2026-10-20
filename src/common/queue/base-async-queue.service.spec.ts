import type { Cache } from 'cache-manager';
import type { Job } from 'bullmq';
import type { BullmqQueueFactory } from './queue.factory.js';
import { QUEUE_NAMES } from './queue-names.js';
import {
  BaseAsyncQueueService,
  DEFAULT_RESULT_TTL_MS,
  type AsyncJobResult,
} from './base-async-queue.service.js';
import { EnvKey } from '../../config/env/env-keys.enum.js';
import type { RuntimeConfigPort } from '../../config/runtime/runtime-config.types.js';

// ── Test doubles ─────────────────────────────────────────────────────

interface TestJobData {
  userId: string;
  value: number;
}

interface TestResult {
  doubled: number;
}

function buildFactory(queueAvailable: boolean): {
  factory: BullmqQueueFactory;
  mockQueue: {
    add: ReturnType<typeof vi.fn>;
    getJob: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  } | null;
} {
  if (!queueAvailable) {
    return {
      factory: {
        isAvailable: false,
        createQueue: () => ({ queue: null, worker: null }),
      } as unknown as BullmqQueueFactory,
      mockQueue: null,
    };
  }

  const mockQueue = {
    add: vi.fn(),
    getJob: vi.fn(),
    close: vi.fn(),
  };
  return {
    factory: {
      isAvailable: true,
      createQueue: () => ({
        queue: mockQueue,
        worker: { on: vi.fn(), close: vi.fn() },
      }),
    } as unknown as BullmqQueueFactory,
    mockQueue,
  };
}

function buildCache(): {
  cache: Cache;
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
} {
  const get = vi.fn();
  const set = vi.fn();
  return { cache: { get, set } as unknown as Cache, get, set };
}

/**
 * Concrete subclass for testing the abstract BaseAsyncQueueService.
 */
class TestQueueService extends BaseAsyncQueueService<TestJobData, TestResult> {
  readonly executeMock: ReturnType<typeof vi.fn>;

  constructor(
    factory: BullmqQueueFactory,
    cache: Cache,
    executeMock?: ReturnType<typeof vi.fn>,
    runtimeConfig?: RuntimeConfigPort,
  ) {
    super(
      QUEUE_NAMES.mealAnalysis,
      factory,
      cache,
      async (job) =>
        this.processJob(job, (data) => this.execute(data), 'Test job failed'),
      runtimeConfig,
    );
    this.executeMock = executeMock ?? vi.fn();
  }

  private execute(data: TestJobData): Promise<TestResult> {
    return (
      this.executeMock as unknown as (data: TestJobData) => Promise<TestResult>
    )(data);
  }

  // Expose protected methods for testing
  testProcessJob(job: {
    id: string | undefined;
    data: TestJobData;
  }): Promise<AsyncJobResult<TestResult>> {
    return this.processJob(
      job,
      (data) =>
        (
          this.executeMock as unknown as (
            data: TestJobData,
          ) => Promise<TestResult>
        )(data),
      'Test job failed',
    );
  }

  async testPollStatus(jobId: string, userId?: string) {
    return this.pollStatus(jobId, userId);
  }

  testResultKey(jobId: string): string {
    return this.resultKey(jobId);
  }

  async testStoreResult(
    jobId: string,
    result: AsyncJobResult<TestResult>,
    ttlMs?: number,
  ): Promise<void> {
    return this.storeResult(jobId, result, ttlMs);
  }
}

// ── Tests ───────────────────────────────────────────────────────────

describe('BaseAsyncQueueService', () => {
  describe('constructor & isConfigured', () => {
    it('is not configured when factory returns null queue', () => {
      const { factory } = buildFactory(false);
      const { cache } = buildCache();

      const service = new TestQueueService(factory, cache);

      expect(service.isConfigured).toBe(false);
    });

    it('is configured when factory returns a queue', () => {
      const { factory } = buildFactory(true);
      const { cache } = buildCache();

      const service = new TestQueueService(factory, cache);

      expect(service.isConfigured).toBe(true);
    });
  });

  describe('resultKey', () => {
    it('generates key with queue name and job id', () => {
      const { factory } = buildFactory(false);
      const { cache } = buildCache();

      const service = new TestQueueService(factory, cache);

      expect(service.testResultKey('job-123')).toBe(
        'async-job:lucent-meal-analysis:job-123',
      );
    });
  });

  describe('storeResult', () => {
    it('stores result in cache with default TTL', async () => {
      const { factory } = buildFactory(false);
      const { cache, set } = buildCache();

      const service = new TestQueueService(factory, cache);
      const result: AsyncJobResult<TestResult> = {
        status: 'completed',
        result: { doubled: 42 },
      };

      await service.testStoreResult('job-1', result);

      expect(set).toHaveBeenCalledWith(
        'async-job:lucent-meal-analysis:job-1',
        result,
        DEFAULT_RESULT_TTL_MS,
      );
    });

    it('stores result in cache with custom TTL', async () => {
      const { factory } = buildFactory(false);
      const { cache, set } = buildCache();

      const service = new TestQueueService(factory, cache);
      const result: AsyncJobResult<TestResult> = {
        status: 'failed',
        error: 'boom',
      };

      await service.testStoreResult('job-2', result, 5000);

      expect(set).toHaveBeenCalledWith(
        'async-job:lucent-meal-analysis:job-2',
        result,
        5000,
      );
    });

    it('reads the result TTL from the snapshot on every write', async () => {
      const { factory } = buildFactory(false);
      const { cache, set } = buildCache();
      const values: Record<string, unknown> = {
        [EnvKey.ASYNC_JOB_RESULT_CACHE_TTL_MS]: 42_000,
      };
      const service = new TestQueueService(factory, cache, undefined, {
        getSnapshot: () => ({ values }),
      } as unknown as RuntimeConfigPort);
      const result: AsyncJobResult<TestResult> = {
        status: 'completed',
        result: { doubled: 1 },
      };

      await service.testStoreResult('job-3', result);
      expect(set).toHaveBeenLastCalledWith(
        'async-job:lucent-meal-analysis:job-3',
        result,
        42_000,
      );

      values[EnvKey.ASYNC_JOB_RESULT_CACHE_TTL_MS] = 60_000;
      await service.testStoreResult('job-4', result);
      expect(set).toHaveBeenLastCalledWith(
        'async-job:lucent-meal-analysis:job-4',
        result,
        60_000,
      );
    });

    it('falls back to the code default when the snapshot has no value', async () => {
      const { factory } = buildFactory(false);
      const { cache, set } = buildCache();
      const service = new TestQueueService(factory, cache, undefined, {
        getSnapshot: () => ({ values: {} }),
      } as unknown as RuntimeConfigPort);
      const result: AsyncJobResult<TestResult> = {
        status: 'completed',
        result: { doubled: 2 },
      };

      await service.testStoreResult('job-5', result);
      expect(set).toHaveBeenLastCalledWith(
        'async-job:lucent-meal-analysis:job-5',
        result,
        DEFAULT_RESULT_TTL_MS,
      );
    });
  });

  describe('processJob', () => {
    it('stores and returns completed result on success', async () => {
      const { factory } = buildFactory(false);
      const { cache, set } = buildCache();
      const executeMock = vi.fn().mockResolvedValue({ doubled: 10 });

      const service = new TestQueueService(factory, cache, executeMock);

      const result = await service.testProcessJob({
        id: 'job-success',
        data: { userId: 'u1', value: 5 },
      });

      expect(result).toEqual({ status: 'completed', result: { doubled: 10 } });
      expect(executeMock).toHaveBeenCalledWith({ userId: 'u1', value: 5 });
      expect(set).toHaveBeenCalledWith(
        'async-job:lucent-meal-analysis:job-success',
        { status: 'completed', result: { doubled: 10 } },
        DEFAULT_RESULT_TTL_MS,
      );
    });

    it('stores and returns failed result on error', async () => {
      const { factory } = buildFactory(false);
      const { cache, set } = buildCache();
      const executeMock = vi.fn().mockRejectedValue(new Error('kaboom'));

      const service = new TestQueueService(factory, cache, executeMock);

      const result = await service.testProcessJob({
        id: 'job-fail',
        data: { userId: 'u1', value: 5 },
      });

      expect(result).toEqual({ status: 'failed', error: 'kaboom' });
      expect(set).toHaveBeenCalledWith(
        'async-job:lucent-meal-analysis:job-fail',
        { status: 'failed', error: 'kaboom' },
        DEFAULT_RESULT_TTL_MS,
      );
    });

    it('handles non-Error throw values', async () => {
      const { factory } = buildFactory(false);
      const { cache } = buildCache();
      const executeMock = vi.fn().mockRejectedValue('string error');

      const service = new TestQueueService(factory, cache, executeMock);

      const result = await service.testProcessJob({
        id: 'job-str',
        data: { userId: 'u1', value: 5 },
      });

      expect(result).toEqual({ status: 'failed', error: 'string error' });
    });

    it('does not store result when job.id is undefined', async () => {
      const { factory } = buildFactory(false);
      const { cache, set } = buildCache();
      const executeMock = vi.fn().mockResolvedValue({ doubled: 1 });

      const service = new TestQueueService(factory, cache, executeMock);

      const result = await service.testProcessJob({
        id: undefined,
        data: { userId: 'u1', value: 0 },
      });

      expect(result).toEqual({ status: 'completed', result: { doubled: 1 } });
      expect(set).not.toHaveBeenCalled();
    });
  });

  describe('pollStatus', () => {
    it('returns null when queue is null and cache miss', async () => {
      const { factory } = buildFactory(false);
      const { cache, get } = buildCache();
      get.mockResolvedValue(null);

      const service = new TestQueueService(factory, cache);

      const result = await service.testPollStatus('job-x');

      expect(result).toBeNull();
    });

    it('returns cached completed result without userId check', async () => {
      const { factory } = buildFactory(false);
      const { cache, get } = buildCache();
      const cached: AsyncJobResult<TestResult> = {
        status: 'completed',
        result: { doubled: 99 },
      };
      get.mockResolvedValue(cached);

      const service = new TestQueueService(factory, cache);

      const result = await service.testPollStatus('job-cached');

      expect(result).toEqual({ status: 'completed', result: { doubled: 99 } });
    });

    it('returns cached failed result with error', async () => {
      const { factory } = buildFactory(false);
      const { cache, get } = buildCache();
      const cached: AsyncJobResult<TestResult> = {
        status: 'failed',
        error: 'cached error',
      };
      get.mockResolvedValue(cached);

      const service = new TestQueueService(factory, cache);

      const result = await service.testPollStatus('job-failed-cached');

      expect(result).toEqual({ status: 'failed', error: 'cached error' });
    });

    it('returns null when userId is provided but queue is null (cached)', async () => {
      const { factory } = buildFactory(false);
      const { cache, get } = buildCache();
      get.mockResolvedValue({ status: 'completed', result: { doubled: 1 } });

      const service = new TestQueueService(factory, cache);

      const result = await service.testPollStatus('job-own', 'u1');

      expect(result).toBeNull();
    });

    it('returns null when userId is provided but job not found in queue', async () => {
      const { factory, mockQueue } = buildFactory(true);
      const { cache, get } = buildCache();
      get.mockResolvedValue({ status: 'completed', result: { doubled: 1 } });
      mockQueue!.getJob.mockResolvedValue(null);

      const service = new TestQueueService(factory, cache);

      const result = await service.testPollStatus('job-missing', 'u1');

      expect(result).toBeNull();
    });

    it('returns null when userId does not match job userId', async () => {
      const { factory, mockQueue } = buildFactory(true);
      const { cache, get } = buildCache();
      get.mockResolvedValue({ status: 'completed', result: { doubled: 1 } });
      const mockJob = { data: { userId: 'other-user' } };
      mockQueue!.getJob.mockResolvedValue(mockJob);

      const service = new TestQueueService(factory, cache);

      const result = await service.testPollStatus('job-mismatch', 'u1');

      expect(result).toBeNull();
    });

    it('returns cached result when userId matches', async () => {
      const { factory, mockQueue } = buildFactory(true);
      const { cache, get } = buildCache();
      const cached: AsyncJobResult<TestResult> = {
        status: 'completed',
        result: { doubled: 7 },
      };
      get.mockResolvedValue(cached);
      const mockJob = { data: { userId: 'u1' } };
      mockQueue!.getJob.mockResolvedValue(mockJob);

      const service = new TestQueueService(factory, cache);

      const result = await service.testPollStatus('job-match', 'u1');

      expect(result).toEqual({ status: 'completed', result: { doubled: 7 } });
    });

    it('returns null when job not found in queue (cache miss, slow path)', async () => {
      const { factory, mockQueue } = buildFactory(true);
      const { cache, get } = buildCache();
      get.mockResolvedValue(null);
      mockQueue!.getJob.mockResolvedValue(null);

      const service = new TestQueueService(factory, cache);

      const result = await service.testPollStatus('nope');

      expect(result).toBeNull();
    });

    it('returns null when userId mismatch on slow path', async () => {
      const { factory, mockQueue } = buildFactory(true);
      const { cache, get } = buildCache();
      get.mockResolvedValue(null);
      const mockJob = { data: { userId: 'someone-else' } };
      mockQueue!.getJob.mockResolvedValue(mockJob);

      const service = new TestQueueService(factory, cache);

      const result = await service.testPollStatus('job-1', 'u1');

      expect(result).toBeNull();
    });

    it('returns pending for active job', async () => {
      const { factory, mockQueue } = buildFactory(true);
      const { cache, get } = buildCache();
      get.mockResolvedValue(null);
      const mockJob = {
        data: { userId: 'u1' },
        getState: vi.fn().mockResolvedValue('active'),
      };
      mockQueue!.getJob.mockResolvedValue(mockJob);

      const service = new TestQueueService(factory, cache);

      const result = await service.testPollStatus('job-active');

      expect(result).toEqual({ status: 'pending' });
    });

    it('returns completed result from job.returnvalue on slow path', async () => {
      const { factory, mockQueue } = buildFactory(true);
      const { cache, get } = buildCache();
      get.mockResolvedValue(null);
      const mockJob = {
        data: { userId: 'u1' },
        getState: vi.fn().mockResolvedValue('completed'),
        returnvalue: { status: 'completed', result: { doubled: 55 } },
      };
      mockQueue!.getJob.mockResolvedValue(mockJob as unknown as Job);

      const service = new TestQueueService(factory, cache);

      const result = await service.testPollStatus('job-done');

      expect(result).toEqual({ status: 'completed', result: { doubled: 55 } });
    });

    it('returns completed without result when returnvalue is null', async () => {
      const { factory, mockQueue } = buildFactory(true);
      const { cache, get } = buildCache();
      get.mockResolvedValue(null);
      const mockJob = {
        data: { userId: 'u1' },
        getState: vi.fn().mockResolvedValue('completed'),
        returnValue: undefined,
      };
      mockQueue!.getJob.mockResolvedValue(mockJob as unknown as Job);

      const service = new TestQueueService(factory, cache);

      const result = await service.testPollStatus('job-done-novalue');

      expect(result).toEqual({ status: 'completed' });
    });

    it('returns failed with error from job.failedReason', async () => {
      const { factory, mockQueue } = buildFactory(true);
      const { cache, get } = buildCache();
      get.mockResolvedValue(null);
      const mockJob = {
        data: { userId: 'u1' },
        getState: vi.fn().mockResolvedValue('failed'),
        failedReason: 'timeout exceeded',
      };
      mockQueue!.getJob.mockResolvedValue(mockJob as unknown as Job);

      const service = new TestQueueService(factory, cache);

      const result = await service.testPollStatus('job-failed-slow');

      expect(result).toEqual({ status: 'failed', error: 'timeout exceeded' });
    });

    it('returns failed with fallback error when failedReason is undefined', async () => {
      const { factory, mockQueue } = buildFactory(true);
      const { cache, get } = buildCache();
      get.mockResolvedValue(null);
      const mockJob = {
        data: { userId: 'u1' },
        getState: vi.fn().mockResolvedValue('failed'),
        failedReason: undefined,
      };
      mockQueue!.getJob.mockResolvedValue(mockJob as unknown as Job);

      const service = new TestQueueService(factory, cache);

      const result = await service.testPollStatus('job-failed-noreason');

      expect(result).toEqual({ status: 'failed', error: 'Unknown error' });
    });
  });
});
