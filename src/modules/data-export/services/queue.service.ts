import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { ConnectionOptions, Job } from 'bullmq';
import { Queue, Worker } from 'bullmq';
import { DataExportProcessorService } from './processor.service';

interface DataExportJobData {
  exportRequestId: string;
  userId: string;
  language: string;
}

const QUEUE_NAME = 'data-export';

@Injectable()
export class DataExportQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DataExportQueueService.name);
  private queue: Queue<DataExportJobData> | null = null;
  private worker: Worker<DataExportJobData> | null = null;

  constructor(private readonly processor: DataExportProcessorService) {}

  onModuleInit() {
    const redisUrl = process.env['REDIS_URL'];
    if (!redisUrl) {
      this.logger.warn(
        'REDIS_URL is not configured; data export queue is disabled',
      );
      return;
    }

    const connection: ConnectionOptions = { url: redisUrl };

    this.queue = new Queue<DataExportJobData>(QUEUE_NAME, { connection });

    this.worker = new Worker<DataExportJobData>(
      QUEUE_NAME,
      async (job: Job<DataExportJobData>) => {
        await this.processor.process(job.data);
      },
      {
        connection: { ...connection, maxRetriesPerRequest: null },
        concurrency: 1,
        autorun: true,
      },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `Export job ${job?.id ?? 'unknown'} failed: ${err.message}`,
      );
    });

    this.logger.log('Data export queue initialized');
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
  }

  get isConfigured(): boolean {
    return this.queue != null;
  }

  async enqueue(data: DataExportJobData): Promise<void> {
    if (!this.queue) {
      throw new Error('Data export queue is not configured');
    }

    await this.queue.add('export', data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    });
  }
}
