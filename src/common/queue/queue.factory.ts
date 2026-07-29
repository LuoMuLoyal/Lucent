/**
 * Shared BullMQ infrastructure — factory, connection helpers, and lifecycle
 * management so that individual queue services don't duplicate Redis connection
 * setup, error handling, and Worker lifecycle boilerplate.
 */
import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import type { ConnectionOptions, JobsOptions } from 'bullmq';
import { EnvKey } from '../../config/env/env-keys.enum';
import { MetricsService } from '../metrics/metrics.service';

/** Common defaults shared across all BullMQ queues. */
export const DEFAULT_QUEUE_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 5_000 },
};

/** Standard retention used for all workers. */
export const DEFAULT_WORKER_RETENTION = {
  removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 5_000 },
} as const;

/** How often queue job counts are sampled into the depth gauges. */
export const QUEUE_METRICS_POLL_INTERVAL_MS = 30_000;

export interface QueueCreateOptions<TData, TResult> {
  name: string;
  defaultJobOptions?: JobsOptions;
  workerConcurrency?: number;
  processor: (job: {
    id: string | undefined;
    name: string;
    data: TData;
  }) => Promise<TResult>;
}

interface ManagedQueue {
  queue: Queue;
  worker: Worker;
  name: string;
  metricsInterval: ReturnType<typeof setInterval>;
}

/**
 * Centralised BullMQ factory.
 *
 * - Reads `REDIS_URL` once and reuses connection options.
 * - Creates Queue + Worker pairs with unified error handling.
 * - Polls job counts into the queue depth gauges on a fixed interval.
 * - Tracks all created workers/queues for graceful shutdown.
 * - Returns `null` queue/worker when Redis is not configured, so callers
 *   can fall back to inline processing.
 */
@Injectable()
export class BullmqQueueFactory implements OnModuleDestroy {
  private readonly logger = new Logger(BullmqQueueFactory.name);
  private readonly redisUrl: string | null;
  private readonly managed: ManagedQueue[] = [];

  constructor(
    private readonly configService: ConfigService,
    private readonly metricsService: MetricsService,
  ) {
    const url = this.configService.get<string>(EnvKey.REDIS_URL);
    this.redisUrl = url && url.trim().length > 0 ? url : null;
  }

  get isAvailable(): boolean {
    return this.redisUrl != null;
  }

  createQueue<TData = unknown, TResult = void>(
    options: QueueCreateOptions<TData, TResult>,
  ): {
    queue: Queue<TData, TResult> | null;
    worker: Worker<TData, TResult> | null;
  } {
    if (!this.redisUrl) {
      this.logger.log(
        `Queue "${options.name}" disabled; REDIS_URL not configured`,
      );
      return { queue: null, worker: null };
    }

    const queueConnection = this.createConnection({ maxRetriesPerRequest: 1 });
    const workerConnection = this.createConnection({
      maxRetriesPerRequest: null,
    });

    const queue = new Queue<TData, TResult>(options.name, {
      connection: queueConnection,
      defaultJobOptions: options.defaultJobOptions ?? DEFAULT_QUEUE_OPTIONS,
    });
    queue.on('error', (error) => {
      this.logger.error(
        `Queue "${options.name}" error: ${error.message}`,
        error.stack,
      );
    });

    const worker = new Worker<TData, TResult>(
      options.name,
      async (job) => {
        return options.processor({
          id: job.id ?? undefined,
          name: job.name,
          data: job.data,
        });
      },
      {
        connection: workerConnection,
        concurrency: options.workerConcurrency ?? 1,
        ...DEFAULT_WORKER_RETENTION,
      },
    );
    worker.on('completed', () => {
      this.metricsService.recordBullmqJob(options.name, 'completed');
    });
    worker.on('failed', (job, error) => {
      this.metricsService.recordBullmqJob(options.name, 'failed');
      this.logger.error(
        `Job in "${options.name}" failed: id=${job?.id ?? 'unknown'}, ${error.message}`,
        error.stack,
        {
          queue: options.name,
          jobId: job?.id,
          attemptsMade: job?.attemptsMade,
          failedReason: error.message,
        },
      );
    });
    worker.on('error', (error) => {
      this.logger.error(
        `Worker "${options.name}" error: ${error.message}`,
        error.stack,
      );
    });

    this.managed.push({
      queue,
      worker,
      name: options.name,
      metricsInterval: this.startMetricsPolling(queue, options.name),
    });
    this.logger.log(`Queue enabled: ${options.name}`);

    return { queue, worker };
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(
      this.managed.map(async (m) => {
        clearInterval(m.metricsInterval);
        await m.worker.close();
        await m.queue.close();
      }),
    );
  }

  /**
   * Samples `queue.getJobCounts()` on a fixed interval and feeds the
   * active/waiting depth gauges. The MetricsService setters are no-ops when
   * metrics are disabled, so polling stays wired unconditionally.
   */
  private startMetricsPolling(
    queue: Queue,
    name: string,
  ): ReturnType<typeof setInterval> {
    const interval = setInterval(() => {
      void this.pollJobCounts(queue, name);
    }, QUEUE_METRICS_POLL_INTERVAL_MS);
    interval.unref();
    return interval;
  }

  private async pollJobCounts(queue: Queue, name: string): Promise<void> {
    try {
      const counts = await queue.getJobCounts('active', 'waiting');
      this.metricsService.setBullmqActiveJobs(name, counts['active'] ?? 0);
      this.metricsService.setBullmqWaitingJobs(name, counts['waiting'] ?? 0);
    } catch (error) {
      this.logger.warn(
        `Failed to poll job counts for queue "${name}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private createConnection(retryOptions: {
    maxRetriesPerRequest: number | null;
  }): ConnectionOptions {
    if (this.redisUrl == null) {
      throw new Error('REDIS_URL is not configured');
    }
    const url = new URL(this.redisUrl);
    const database = url.pathname ? Number(url.pathname.slice(1)) || 0 : 0;

    return {
      host: url.hostname,
      port: Number(url.port) || 6379,
      db: database,
      ...(url.username ? { username: url.username } : {}),
      ...(url.password ? { password: url.password } : {}),
      ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
      ...retryOptions,
    };
  }
}
