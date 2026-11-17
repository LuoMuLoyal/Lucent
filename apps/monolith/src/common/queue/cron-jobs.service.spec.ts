import { Logger } from '@nestjs/common';
import { EnvKey } from '../../config/env/env-keys.enum.js';
import type { RuntimeConfigPort } from '../../config/runtime/runtime-config.types.js';
import type { BullmqQueueFactory } from './queue.factory.js';
import type { MealAnalysisSweeperService } from '../../modules/daily-records/index.js';
import type { DataRetentionService } from '../../modules/data-retention/index.js';
import type { LifecycleService } from '../../modules/today-suggestion/index.js';
import type { WeeklyInsightSchedulerService } from '../../modules/notification-preferences/index.js';
import { CronJobsService, CRON_QUEUE_NAME } from './cron-jobs.service.js';

type ProcessorFn = (job: {
  id: string | undefined;
  name: string;
  data: unknown;
}) => Promise<unknown>;

interface CapturedQueue {
  name: string;
  workerConcurrency: number | undefined;
  processor: ProcessorFn;
  upsertJobScheduler: ReturnType<typeof vi.fn>;
  removeJobScheduler: ReturnType<typeof vi.fn>;
}

function buildFactory(
  available: boolean,
  rejectScheduler = false,
): {
  factory: BullmqQueueFactory;
  captured: CapturedQueue[];
} {
  const captured: CapturedQueue[] = [];

  if (!available) {
    return {
      factory: {
        isAvailable: false,
        createQueue: () => ({ queue: null, worker: null }),
      } as unknown as BullmqQueueFactory,
      captured,
    };
  }

  const createQueue = (options: {
    name: string;
    workerConcurrency?: number;
    processor: ProcessorFn;
  }) => {
    const upsertJobScheduler = rejectScheduler
      ? vi.fn().mockRejectedValue(new Error('Redis connection lost'))
      : vi.fn().mockResolvedValue(undefined);
    const removeJobScheduler = vi.fn().mockResolvedValue(true);
    const q: CapturedQueue = {
      name: options.name,
      workerConcurrency: options.workerConcurrency,
      processor: options.processor,
      upsertJobScheduler,
      removeJobScheduler,
    };
    captured.push(q);
    return { queue: q as unknown, worker: { on: vi.fn(), close: vi.fn() } };
  };

  return {
    factory: {
      isAvailable: true,
      createQueue,
    } as unknown as BullmqQueueFactory,
    captured,
  };
}

function runtimeWith() {
  const listeners = new Set<
    (next: ReturnType<RuntimeConfigPort['getSnapshot']>) => void
  >();
  const snapshot = (values: Record<string, unknown>) => ({
    values: values as never,
    version: 'test#1',
    source: 'remote' as const,
    revision: 'test',
    seq: 1,
  });
  let current = snapshot({});
  const port: RuntimeConfigPort = {
    getSnapshot: () => current,
    getVersion: () => current.version,
    applyDocument: () => ({ ok: true, version: current.version, changed: [] }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    port,
    publish(values: Record<string, unknown>): void {
      current = snapshot(values);
      for (const listener of listeners) {
        listener(current);
      }
    },
  };
}

function buildServices() {
  return {
    dataRetentionService: {
      cleanupExpiredData: vi.fn().mockResolvedValue(undefined),
    } as unknown as DataRetentionService,
    lifecycleService: {
      refreshLifecycleStates: vi.fn().mockResolvedValue(undefined),
    } as unknown as LifecycleService,
    weeklyInsightSchedulerService: {
      runTick: vi.fn().mockResolvedValue(undefined),
    } as unknown as WeeklyInsightSchedulerService,
    mealAnalysisSweeperService: {
      reapStaleAnalyses: vi.fn().mockResolvedValue(0),
    } as unknown as MealAnalysisSweeperService,
  };
}

describe('CronJobsService', () => {
  let factory: BullmqQueueFactory;
  let captured: CapturedQueue[];
  let dataRetentionService: DataRetentionService;
  let lifecycleService: LifecycleService;
  let weeklyInsightSchedulerService: WeeklyInsightSchedulerService;
  let mealAnalysisSweeperService: MealAnalysisSweeperService;
  let service: CronJobsService;

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  describe('onModuleInit — Redis unavailable', () => {
    it('skips queue creation when REDIS_URL is not configured', async () => {
      const built = buildFactory(false);
      factory = built.factory;
      captured = built.captured;
      const svcs = buildServices();
      dataRetentionService = svcs.dataRetentionService;
      lifecycleService = svcs.lifecycleService;
      weeklyInsightSchedulerService = svcs.weeklyInsightSchedulerService;
      mealAnalysisSweeperService = svcs.mealAnalysisSweeperService;

      service = new CronJobsService(
        factory,
        dataRetentionService,
        lifecycleService,
        weeklyInsightSchedulerService,
        mealAnalysisSweeperService,
      );

      await service.onModuleInit();

      expect(captured).toHaveLength(0);
    });
  });

  describe('onModuleInit — Redis available', () => {
    beforeEach(async () => {
      const built = buildFactory(true);
      factory = built.factory;
      captured = built.captured;
      const svcs = buildServices();
      dataRetentionService = svcs.dataRetentionService;
      lifecycleService = svcs.lifecycleService;
      weeklyInsightSchedulerService = svcs.weeklyInsightSchedulerService;
      mealAnalysisSweeperService = svcs.mealAnalysisSweeperService;

      service = new CronJobsService(
        factory,
        dataRetentionService,
        lifecycleService,
        weeklyInsightSchedulerService,
        mealAnalysisSweeperService,
      );

      await service.onModuleInit();
    });

    it('creates only the low-frequency cron queue', () => {
      // `reminder-dispatch` moved to its owning module (ADR-0025); this layer
      // must not create it, or `common/` would again import a business module.
      expect(captured).toHaveLength(1);
      expect(captured.map((c) => c.name)).toEqual([CRON_QUEUE_NAME]);
    });

    it('sets workerConcurrency on the cron queue', () => {
      const cronQ = captured.find((c) => c.name === CRON_QUEUE_NAME);
      expect(cronQ?.workerConcurrency).toBe(2);
    });

    it('registers data-retention scheduler on cron queue', () => {
      const cronQ = captured.find((c) => c.name === CRON_QUEUE_NAME);
      expect(cronQ?.upsertJobScheduler).toHaveBeenCalledWith(
        'data-retention-cleanup',
        expect.objectContaining({ tz: 'UTC' }),
        expect.objectContaining({ name: 'data-retention-cleanup' }),
      );
    });

    it('registers lifecycle scheduler on cron queue', () => {
      const cronQ = captured.find((c) => c.name === CRON_QUEUE_NAME);
      expect(cronQ?.upsertJobScheduler).toHaveBeenCalledWith(
        'lifecycle-refresh',
        expect.objectContaining({ tz: 'UTC' }),
        expect.objectContaining({ name: 'lifecycle-refresh' }),
      );
    });

    it('registers weekly insight scheduler on the shared cron queue', () => {
      const cronQ = captured.find((c) => c.name === CRON_QUEUE_NAME);
      expect(cronQ?.upsertJobScheduler).toHaveBeenCalledWith(
        'weekly-insight',
        { pattern: '* * * * *', tz: 'UTC' },
        expect.objectContaining({ name: 'weekly-insight' }),
      );
    });

    it('registers the meal-analysis reap scheduler on the shared cron queue', () => {
      const cronQ = captured.find((c) => c.name === CRON_QUEUE_NAME);
      expect(cronQ?.upsertJobScheduler).toHaveBeenCalledWith(
        'meal-analysis-reap',
        { pattern: '*/5 * * * *', tz: 'UTC' },
        expect.objectContaining({ name: 'reap-stale-meal-analyses' }),
      );
    });

    it('does not register the reminder scheduler on the cron queue', () => {
      const cronQ = captured.find((c) => c.name === CRON_QUEUE_NAME);
      expect(cronQ?.upsertJobScheduler).not.toHaveBeenCalledWith(
        'reminder-dispatch',
        expect.anything(),
        expect.anything(),
      );
    });

    it('removes the stale reminder-dispatch scheduler from the cron queue', () => {
      // BullMQ keeps repeatable schedulers in Redis until removed, so the rule
      // left on this queue by the pre-ADR-0025 layout would keep firing here.
      const cronQ = captured.find((c) => c.name === CRON_QUEUE_NAME);
      expect(cronQ?.removeJobScheduler).toHaveBeenCalledWith(
        'reminder-dispatch',
      );
    });
  });

  describe('cron queue processor', () => {
    let cronProcessor: ProcessorFn;

    beforeEach(async () => {
      const built = buildFactory(true);
      factory = built.factory;
      captured = built.captured;
      const svcs = buildServices();
      dataRetentionService = svcs.dataRetentionService;
      lifecycleService = svcs.lifecycleService;
      weeklyInsightSchedulerService = svcs.weeklyInsightSchedulerService;
      mealAnalysisSweeperService = svcs.mealAnalysisSweeperService;

      service = new CronJobsService(
        factory,
        dataRetentionService,
        lifecycleService,
        weeklyInsightSchedulerService,
        mealAnalysisSweeperService,
      );

      await service.onModuleInit();
      cronProcessor = captured.find(
        (c) => c.name === CRON_QUEUE_NAME,
      )!.processor;
    });

    it('dispatches data-retention-cleanup to DataRetentionService', async () => {
      await cronProcessor({
        id: '1',
        name: 'data-retention-cleanup',
        data: {},
      });
      expect(dataRetentionService.cleanupExpiredData).toHaveBeenCalledOnce();
    });

    it('dispatches lifecycle-refresh to LifecycleService', async () => {
      await cronProcessor({
        id: '2',
        name: 'lifecycle-refresh',
        data: {},
      });
      expect(lifecycleService.refreshLifecycleStates).toHaveBeenCalledOnce();
    });

    it('logs warning for unknown job name', async () => {
      await cronProcessor({
        id: '3',
        name: 'unknown-job',
        data: {},
      });
      expect(vi.mocked(Logger.prototype.warn)).toHaveBeenCalledWith(
        expect.stringContaining('unknown-job'),
      );
    });

    it('does not dispatch reminder-dispatch', async () => {
      // The job belongs to `medicine-reminders` now; this processor must not
      // reach for it, and the module no longer injects the reminder service.
      await cronProcessor({
        id: '4',
        name: 'reminder-dispatch',
        data: {},
      });
      expect(vi.mocked(Logger.prototype.warn)).toHaveBeenCalledWith(
        expect.stringContaining('reminder-dispatch'),
      );
    });

    it('dispatches weekly-insight to WeeklyInsightSchedulerService', async () => {
      await cronProcessor({
        id: '5',
        name: 'weekly-insight',
        data: {},
      });
      expect(weeklyInsightSchedulerService.runTick).toHaveBeenCalledOnce();
    });

    it('dispatches the meal-analysis reap job to MealAnalysisSweeperService', async () => {
      await cronProcessor({
        id: '6',
        name: 'reap-stale-meal-analyses',
        data: {},
      });
      expect(
        mealAnalysisSweeperService.reapStaleAnalyses,
      ).toHaveBeenCalledOnce();
    });
  });

  describe('runtime config', () => {
    it('re-upserts the reaper scheduler when the published cron changes', async () => {
      const built = buildFactory(true);
      factory = built.factory;
      const svcs = buildServices();
      const runtime = runtimeWith();

      service = new CronJobsService(
        factory,
        svcs.dataRetentionService,
        svcs.lifecycleService,
        svcs.weeklyInsightSchedulerService,
        svcs.mealAnalysisSweeperService,
        runtime.port,
      );
      await service.onModuleInit();

      const cronQueue = built.captured.find(
        (queue) => queue.name === CRON_QUEUE_NAME,
      );
      cronQueue?.upsertJobScheduler.mockClear();

      runtime.publish({ [EnvKey.MEAL_ANALYSIS_REAP_CRON]: '*/15 * * * *' });

      expect(cronQueue?.upsertJobScheduler).toHaveBeenCalledWith(
        'meal-analysis-reap',
        { pattern: '*/15 * * * *', tz: 'UTC' },
        { name: 'reap-stale-meal-analyses', data: {} },
      );
      service.onModuleDestroy();
    });

    it('does not touch the scheduler when the pattern is unchanged', async () => {
      const built = buildFactory(true);
      factory = built.factory;
      const svcs = buildServices();
      const runtime = runtimeWith();

      service = new CronJobsService(
        factory,
        svcs.dataRetentionService,
        svcs.lifecycleService,
        svcs.weeklyInsightSchedulerService,
        svcs.mealAnalysisSweeperService,
        runtime.port,
      );
      // 已注册的模式来自基线；再发布同一个值不应重排。
      await service.onModuleInit();
      const cronQueue = built.captured.find(
        (queue) => queue.name === CRON_QUEUE_NAME,
      );
      cronQueue?.upsertJobScheduler.mockClear();

      runtime.publish({ [EnvKey.QUEUE_CRON_CONCURRENCY]: 4 });

      expect(cronQueue?.upsertJobScheduler).not.toHaveBeenCalled();
      service.onModuleDestroy();
    });

    it('warns instead of throwing when the reschedule fails', async () => {
      const built = buildFactory(true);
      factory = built.factory;
      const svcs = buildServices();
      const runtime = runtimeWith();

      service = new CronJobsService(
        factory,
        svcs.dataRetentionService,
        svcs.lifecycleService,
        svcs.weeklyInsightSchedulerService,
        svcs.mealAnalysisSweeperService,
        runtime.port,
      );
      await service.onModuleInit();
      const cronQueue = built.captured.find(
        (queue) => queue.name === CRON_QUEUE_NAME,
      );
      cronQueue?.upsertJobScheduler.mockRejectedValueOnce(
        new Error('Redis connection lost'),
      );

      runtime.publish({ [EnvKey.MEAL_ANALYSIS_REAP_CRON]: '0 * * * *' });
      await Promise.resolve();

      expect(vi.mocked(Logger.prototype.warn)).toHaveBeenCalledWith(
        expect.stringContaining('Failed to reschedule'),
      );
      service.onModuleDestroy();
    });
  });

  describe('registerSchedulers error handling', () => {
    it('logs error when upsertJobScheduler fails', async () => {
      const built = buildFactory(true, true);
      factory = built.factory;
      const svcs = buildServices();
      dataRetentionService = svcs.dataRetentionService;
      lifecycleService = svcs.lifecycleService;
      weeklyInsightSchedulerService = svcs.weeklyInsightSchedulerService;
      mealAnalysisSweeperService = svcs.mealAnalysisSweeperService;

      service = new CronJobsService(
        factory,
        dataRetentionService,
        lifecycleService,
        weeklyInsightSchedulerService,
        mealAnalysisSweeperService,
      );

      await service.onModuleInit();

      expect(vi.mocked(Logger.prototype.error)).toHaveBeenCalledWith(
        expect.stringContaining('Failed to register'),
        expect.anything(),
      );
    });
  });
});
