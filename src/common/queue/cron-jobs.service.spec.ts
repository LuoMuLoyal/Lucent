import { Logger } from '@nestjs/common';
import type { BullmqQueueFactory } from './queue.factory';
import type { DataRetentionService } from '../../modules/data-retention/services/data-retention.service';
import type { LifecycleService } from '../../modules/today-suggestion/services/lifecycle/manager.service';
import type { ReminderSchedulerService } from '../../modules/medicine-reminders/services/scheduler.service';
import type { WeeklyInsightSchedulerService } from '../../modules/notification-preferences/services/weekly-insight-scheduler.service';
import {
  CronJobsService,
  CRON_QUEUE_NAME,
  REMINDER_QUEUE_NAME,
} from './cron-jobs.service';

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

function buildServices() {
  return {
    dataRetentionService: {
      cleanupExpiredData: vi.fn().mockResolvedValue(undefined),
    } as unknown as DataRetentionService,
    lifecycleService: {
      refreshLifecycleStates: vi.fn().mockResolvedValue(undefined),
    } as unknown as LifecycleService,
    reminderSchedulerService: {
      dispatchDueReminders: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReminderSchedulerService,
    weeklyInsightSchedulerService: {
      runTick: vi.fn().mockResolvedValue(undefined),
    } as unknown as WeeklyInsightSchedulerService,
  };
}

describe('CronJobsService', () => {
  let factory: BullmqQueueFactory;
  let captured: CapturedQueue[];
  let dataRetentionService: DataRetentionService;
  let lifecycleService: LifecycleService;
  let reminderSchedulerService: ReminderSchedulerService;
  let weeklyInsightSchedulerService: WeeklyInsightSchedulerService;
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
      reminderSchedulerService = svcs.reminderSchedulerService;
      weeklyInsightSchedulerService = svcs.weeklyInsightSchedulerService;

      service = new CronJobsService(
        factory,
        dataRetentionService,
        lifecycleService,
        reminderSchedulerService,
        weeklyInsightSchedulerService,
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
      reminderSchedulerService = svcs.reminderSchedulerService;
      weeklyInsightSchedulerService = svcs.weeklyInsightSchedulerService;

      service = new CronJobsService(
        factory,
        dataRetentionService,
        lifecycleService,
        reminderSchedulerService,
        weeklyInsightSchedulerService,
      );

      await service.onModuleInit();
    });

    it('creates two queues with correct names', () => {
      expect(captured).toHaveLength(2);
      expect(captured.map((c) => c.name)).toContain(CRON_QUEUE_NAME);
      expect(captured.map((c) => c.name)).toContain(REMINDER_QUEUE_NAME);
    });

    it('sets workerConcurrency on the cron queue', () => {
      const cronQ = captured.find((c) => c.name === CRON_QUEUE_NAME);
      expect(cronQ?.workerConcurrency).toBe(2);
    });

    it('does not set workerConcurrency on the reminder queue', () => {
      const reminderQ = captured.find((c) => c.name === REMINDER_QUEUE_NAME);
      expect(reminderQ?.workerConcurrency).toBeUndefined();
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

    it('registers reminder scheduler on reminder queue', () => {
      const reminderQ = captured.find((c) => c.name === REMINDER_QUEUE_NAME);
      expect(reminderQ?.upsertJobScheduler).toHaveBeenCalledWith(
        'reminder-dispatch',
        expect.objectContaining({ tz: 'UTC' }),
        expect.objectContaining({ name: 'reminder-dispatch' }),
      );
    });

    it('does not register reminder scheduler on cron queue', () => {
      const cronQ = captured.find((c) => c.name === CRON_QUEUE_NAME);
      expect(cronQ?.upsertJobScheduler).not.toHaveBeenCalledWith(
        'reminder-dispatch',
        expect.anything(),
        expect.anything(),
      );
    });

    it('removes stale reminder-dispatch scheduler from cron queue', () => {
      const cronQ = captured.find((c) => c.name === CRON_QUEUE_NAME);
      expect(cronQ?.removeJobScheduler).toHaveBeenCalledWith(
        'reminder-dispatch',
      );
    });

    it('does not register data-retention or lifecycle on reminder queue', () => {
      const reminderQ = captured.find((c) => c.name === REMINDER_QUEUE_NAME);
      expect(reminderQ?.upsertJobScheduler).toHaveBeenCalledTimes(1);
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
      reminderSchedulerService = svcs.reminderSchedulerService;
      weeklyInsightSchedulerService = svcs.weeklyInsightSchedulerService;

      service = new CronJobsService(
        factory,
        dataRetentionService,
        lifecycleService,
        reminderSchedulerService,
        weeklyInsightSchedulerService,
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
      await cronProcessor({
        id: '4',
        name: 'reminder-dispatch',
        data: {},
      });
      expect(
        reminderSchedulerService.dispatchDueReminders,
      ).not.toHaveBeenCalled();
    });

    it('dispatches weekly-insight to WeeklyInsightSchedulerService', async () => {
      await cronProcessor({
        id: '5',
        name: 'weekly-insight',
        data: {},
      });
      expect(weeklyInsightSchedulerService.runTick).toHaveBeenCalledOnce();
    });
  });

  describe('reminder queue processor', () => {
    let reminderProcessor: ProcessorFn;

    beforeEach(async () => {
      const built = buildFactory(true);
      factory = built.factory;
      captured = built.captured;
      const svcs = buildServices();
      dataRetentionService = svcs.dataRetentionService;
      lifecycleService = svcs.lifecycleService;
      reminderSchedulerService = svcs.reminderSchedulerService;
      weeklyInsightSchedulerService = svcs.weeklyInsightSchedulerService;

      service = new CronJobsService(
        factory,
        dataRetentionService,
        lifecycleService,
        reminderSchedulerService,
        weeklyInsightSchedulerService,
      );

      await service.onModuleInit();
      reminderProcessor = captured.find(
        (c) => c.name === REMINDER_QUEUE_NAME,
      )!.processor;
    });

    it('dispatches reminder-dispatch to ReminderSchedulerService', async () => {
      await reminderProcessor({
        id: '1',
        name: 'reminder-dispatch',
        data: {},
      });
      expect(
        reminderSchedulerService.dispatchDueReminders,
      ).toHaveBeenCalledOnce();
    });

    it('logs warning for unknown job name', async () => {
      await reminderProcessor({
        id: '2',
        name: 'unknown-job',
        data: {},
      });
      expect(vi.mocked(Logger.prototype.warn)).toHaveBeenCalledWith(
        expect.stringContaining('unknown-job'),
      );
    });

    it('does not dispatch data-retention-cleanup', async () => {
      await reminderProcessor({
        id: '3',
        name: 'data-retention-cleanup',
        data: {},
      });
      expect(dataRetentionService.cleanupExpiredData).not.toHaveBeenCalled();
    });
  });

  describe('registerSchedulers error handling', () => {
    it('logs error when upsertJobScheduler fails', async () => {
      const built = buildFactory(true, true);
      factory = built.factory;
      const svcs = buildServices();
      dataRetentionService = svcs.dataRetentionService;
      lifecycleService = svcs.lifecycleService;
      reminderSchedulerService = svcs.reminderSchedulerService;
      weeklyInsightSchedulerService = svcs.weeklyInsightSchedulerService;

      service = new CronJobsService(
        factory,
        dataRetentionService,
        lifecycleService,
        reminderSchedulerService,
        weeklyInsightSchedulerService,
      );

      await service.onModuleInit();

      expect(vi.mocked(Logger.prototype.error)).toHaveBeenCalledWith(
        expect.stringContaining('Failed to register'),
        expect.anything(),
      );
    });
  });
});
