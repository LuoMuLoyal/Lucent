import { Queue } from 'bullmq';
import type { ServerResponse } from 'node:http';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { I18nService } from 'nestjs-i18n';
import { MetricsService } from '../../../src/common/metrics/metrics.service.js';
import { BullmqQueueFactory } from '../../../src/common/queue/queue.factory.js';
import {
  CRON_QUEUE_NAME,
  CronJobsService,
  REMINDER_QUEUE_NAME,
} from '../../../src/common/queue/cron-jobs.service.js';
import { RedisService } from '../../../src/common/redis/redis.service.js';
import { SseConnectionRegistry } from '../../../src/common/api/sse/sse-connection-registry.service.js';
import { SseProblemDetailsMapper } from '../../../src/common/api/sse/sse-problem-details.js';
import { ProblemCatalog } from '../../../src/common/api/problem-catalog.js';
import { DataRetentionService } from '../../../src/modules/data-retention/index.js';
import { LifecycleService } from '../../../src/modules/today-suggestion/index.js';
import { ReminderSchedulerService } from '../../../src/modules/medicine-reminders/index.js';
import { WeeklyInsightSchedulerService } from '../../../src/modules/notification-preferences/index.js';
import { EnvKey } from '../../../src/config/env/env-keys.enum.js';

/**
 * Startup/shutdown ordering integration test (NestJS 12 lifecycle audit).
 *
 * NestJS 12 invokes lifecycle hooks per component-hierarchy level instead
 * of strict module instantiation order, so cross-provider ordering
 * assumptions must hold explicitly. These tests pin the behavior the
 * upgrade depends on:
 *
 * 1. Redis readiness is config-derived (not hook-order derived): the queue
 *    factory and cron service enable themselves when REDIS_URL is present.
 * 2. Cron repeatable schedulers are registered in Redis during
 *    `onModuleInit` (idempotent `upsertJobScheduler`).
 * 3. On shutdown, SSE connections receive a terminal event and are closed
 *    via `beforeApplicationShutdown`, before module destroy hooks run.
 */

const SCHEDULER_IDS = [
  'data-retention-cleanup',
  'lifecycle-refresh',
  'reminder-dispatch',
  'weekly-insight',
];

describe('startup and shutdown ordering (e2e)', () => {
  let moduleRef: TestingModule;
  let redisUrl: string;
  // The module is compiled once in beforeAll and closed exactly once: the SSE
  // test below owns the shutdown (it closes the module to observe the
  // `beforeApplicationShutdown` hook), so afterAll only acts as the cleanup
  // fallback for filtered/aborted runs — a second close here would re-run the
  // shutdown hooks and break the assertions.
  let moduleClosed = false;

  beforeAll(async () => {
    redisUrl = process.env[EnvKey.REDIS_URL] ?? 'redis://127.0.0.1:6379';
    process.env[EnvKey.REDIS_URL] = redisUrl;
    delete process.env['OPENAPI_EXPORT_SKIP_REDIS'];

    moduleRef = await Test.createTestingModule({
      providers: [
        RedisService,
        BullmqQueueFactory,
        CronJobsService,
        SseConnectionRegistry,
        SseProblemDetailsMapper,
        MetricsService,
        { provide: ConfigService, useValue: makeConfigService(redisUrl) },
        {
          provide: ProblemCatalog,
          useValue: {
            build: vi.fn().mockReturnValue({
              type: 'about:blank',
              title: 'Error',
              status: 500,
            }),
            isKnown: vi.fn().mockReturnValue(false),
            matchesStatus: vi.fn().mockReturnValue(false),
          },
        },
        {
          provide: I18nService,
          useValue: {
            translate: vi.fn().mockReturnValue('Error'),
            t: vi.fn().mockReturnValue('Error'),
          },
        },
        {
          provide: DataRetentionService,
          useValue: makeSchedulerStub(),
        },
        { provide: LifecycleService, useValue: makeSchedulerStub() },
        {
          provide: ReminderSchedulerService,
          useValue: makeSchedulerStub(),
        },
        {
          provide: WeeklyInsightSchedulerService,
          useValue: makeSchedulerStub(),
        },
      ],
    }).compile();
  });

  afterAll(async () => {
    if (!moduleClosed) {
      await moduleRef.close();
    }
  });

  it('enables Redis-dependent providers from configuration, not hook order', () => {
    const redisService = moduleRef.get(RedisService);
    const factory = moduleRef.get(BullmqQueueFactory);

    // ConfigService resolves REDIS_URL in the constructor, so both
    // providers report availability before any hook has run.
    expect(factory.isAvailable).toBe(true);
    expect(redisService.isAvailable).toBe(false); // client connects in onModuleInit
  });

  it('connects Redis and registers cron repeatable schedulers during init', async () => {
    await moduleRef.init();

    const redisService = moduleRef.get(RedisService);
    expect(redisService.isAvailable).toBe(true);

    const cronQueue = new Queue(CRON_QUEUE_NAME, {
      connection: parseUrl(redisUrl),
    });
    const reminderQueue = new Queue(REMINDER_QUEUE_NAME, {
      connection: parseUrl(redisUrl),
    });

    try {
      const cronSchedulers = await cronQueue.getJobSchedulers();
      const reminderSchedulers = await reminderQueue.getJobSchedulers();
      const registered = [...cronSchedulers, ...reminderSchedulers].map(
        (s) => s.key,
      );
      for (const id of SCHEDULER_IDS) {
        expect(registered).toContain(id);
      }
    } finally {
      await cronQueue.close();
      await reminderQueue.close();
    }
  });

  it('closes tracked SSE connections on shutdown via beforeApplicationShutdown', async () => {
    // Ensure lifecycle hooks are wired even when this test runs in isolation
    // (init() is idempotent — NestApplicationContext guards on isInitialized).
    await moduleRef.init();

    const registry = moduleRef.get(SseConnectionRegistry);
    const { response, write, end } = makeFakeSseResponse();

    registry.register(response, 'en');
    expect(registry.size).toBe(1);

    // Single shutdown: Nest dispatches `beforeApplicationShutdown` to the
    // registry, which writes the terminal SSE event and ends the stream.
    await moduleRef.close();
    moduleClosed = true;

    // closeAll ran during shutdown: exactly one terminal event stream (write
    // of the `event: error` frame plus its data payload), one end, and the
    // registry emptied by closeAll — not by any later dispose pass.
    expect(end).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith('event: error\n');
    expect(write.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(registry.size).toBe(0);
  });
});

// ── Helpers ───────────────────────────────────────────────────────────

interface FakeSseResponse {
  response: ServerResponse;
  emitter: EventTarget;
  write: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
}

/**
 * Minimal `ServerResponse` stand-in for shutdown assertions. Mirrors the
 * mock factory in `sse-connection-registry.service.spec.ts`: `write`/`end`
 * are vi.fn()s so the test can assert how the shutdown path notified the
 * stream (call counts and frames) instead of poking writableEnded flags.
 */
function makeFakeSseResponse(): FakeSseResponse {
  const emitter = new EventTarget();
  const response = emitter as unknown as ServerResponse;
  const write = vi.fn().mockReturnValue(true);
  const end = vi.fn().mockReturnValue(response);
  Object.assign(response, {
    write,
    end,
    // Mirror ServerResponse's `once` API used by the registry for the
    // 'close' disconnect hook; EventTarget only has addEventListener.
    once: (type: string, listener: () => void) => {
      emitter.addEventListener(type, listener, { once: true });
    },
    writableEnded: false,
    destroyed: false,
  });
  return { response, emitter, write, end };
}

function parseUrl(url: string): { host: string; port: number } {
  const parsed = new URL(url);
  return { host: parsed.hostname, port: Number(parsed.port || 6379) };
}

function makeSchedulerStub(): Record<string, ReturnType<typeof vi.fn>> {
  return {
    cleanupExpiredData: vi.fn().mockResolvedValue(undefined),
    refreshLifecycleStates: vi.fn().mockResolvedValue(undefined),
    dispatchDueReminders: vi.fn().mockResolvedValue(undefined),
    runTick: vi.fn().mockResolvedValue(undefined),
  };
}

function makeConfigService(redisUrl: string): Partial<ConfigService> {
  const redisUrlKey: string = EnvKey.REDIS_URL;
  const otelEnabledKey: string = EnvKey.OTEL_ENABLED;
  return {
    get: vi.fn().mockImplementation((key: string) => {
      if (key === redisUrlKey) {
        return redisUrl;
      }
      if (key === otelEnabledKey) {
        return 'false';
      }
      if (key === 'OPENAPI_EXPORT_SKIP_REDIS') {
        return 'false';
      }
      return undefined;
    }),
    getOrThrow: vi.fn().mockImplementation((key: string) => {
      if (key === 'yaml') {
        return {
          metrics: { enabled: false, path: '/metrics' },
          log: { slowQueryThresholdMs: 5000, slowRequestThresholdMs: 5000 },
        };
      }
      throw new Error(`Config key not mocked: ${key}`);
    }),
  };
}
