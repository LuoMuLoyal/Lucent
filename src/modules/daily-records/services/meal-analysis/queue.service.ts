import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import type { ConnectionOptions, JobsOptions, Job } from 'bullmq';
import { EnvKey } from '../../../../config/env-keys.enum';
import {
  MEAL_ANALYSIS_JOB_NAME,
  MEAL_ANALYSIS_QUEUE_NAME,
} from '../../constants/meal-analysis.constants';
import { MealAnalysisWorkerService } from '../meal-analysis/worker.service';

interface MealAnalysisJobData {
  userId: string;
  recordId: string;
  sourceRevision: number;
}

type MealAnalysisJobName = typeof MEAL_ANALYSIS_JOB_NAME;

interface RedisRetryOptions {
  maxRetriesPerRequest: number | null;
}

@Injectable()
export class MealAnalysisQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MealAnalysisQueueService.name);
  private queue: Queue<MealAnalysisJobData, void, MealAnalysisJobName> | null =
    null;
  private worker: Worker<
    MealAnalysisJobData,
    void,
    MealAnalysisJobName
  > | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly mealAnalysisWorkerService: MealAnalysisWorkerService,
  ) {}

  onModuleInit(): void {
    const redisUrl = this.configService.get<string>(EnvKey.REDIS_URL);
    if (!redisUrl) {
      this.logger.log(
        'Meal analysis queue disabled; REDIS_URL is not configured',
      );
      return;
    }

    const queueConnection = this.createConnection(redisUrl, {
      maxRetriesPerRequest: 1,
    });
    const workerConnection = this.createConnection(redisUrl, {
      maxRetriesPerRequest: null,
    });

    this.queue = new Queue<MealAnalysisJobData, void, MealAnalysisJobName>(
      MEAL_ANALYSIS_QUEUE_NAME,
      {
        connection: queueConnection,
        defaultJobOptions: this.defaultJobOptions(),
      },
    );
    this.queue.on('error', (error) => {
      this.logger.error(
        `Meal analysis queue error: ${error.message}`,
        error.stack,
      );
    });

    this.worker = new Worker<MealAnalysisJobData, void, MealAnalysisJobName>(
      MEAL_ANALYSIS_QUEUE_NAME,
      (job) => this.processJob(job),
      {
        connection: workerConnection,
        concurrency: 1,
        removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
        removeOnFail: { age: 7 * 24 * 60 * 60, count: 5000 },
      },
    );
    this.worker.on('failed', (job, error) => {
      const jobId = job?.id ?? 'unknown';
      this.logger.error(`Meal analysis job failed: id=${jobId}`, error.stack);
    });
    this.worker.on('error', (error) => {
      this.logger.error(
        `Meal analysis worker error: ${error.message}`,
        error.stack,
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  async enqueue(job: MealAnalysisJobData): Promise<void> {
    if (!this.queue) {
      await this.mealAnalysisWorkerService.process(job);
      return;
    }

    const jobId = `${job.recordId}:${String(job.sourceRevision)}`;
    await this.queue.add(MEAL_ANALYSIS_JOB_NAME, job, { jobId });
  }

  private async processJob(
    job: Job<MealAnalysisJobData, void, MealAnalysisJobName>,
  ): Promise<void> {
    await this.mealAnalysisWorkerService.process(job.data);
  }

  private defaultJobOptions(): JobsOptions {
    return {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
      removeOnFail: { age: 7 * 24 * 60 * 60, count: 5000 },
    };
  }

  private createConnection(
    redisUrl: string,
    retryOptions: RedisRetryOptions,
  ): ConnectionOptions {
    const url = new URL(redisUrl);
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
