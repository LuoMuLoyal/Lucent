import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { BullmqQueueFactory } from '../../../common/queue/queue.factory';
import { DataExportProcessorService } from './processor.service';

interface DataExportJobData {
  exportRequestId: string;
  userId: string;
  language: string;
}

const QUEUE_NAME = 'data-export';
const JOB_NAME = 'export';

@Injectable()
export class DataExportQueueService {
  private readonly queue: Queue<DataExportJobData, void> | null;

  constructor(
    factory: BullmqQueueFactory,
    private readonly processor: DataExportProcessorService,
  ) {
    const handle = factory.createQueue<DataExportJobData>({
      name: QUEUE_NAME,
      workerConcurrency: 1,
      processor: async (job) => {
        await this.processor.process(job.data);
      },
    });
    this.queue = handle.queue;
  }

  get isConfigured(): boolean {
    return this.queue != null;
  }

  async enqueue(data: DataExportJobData): Promise<void> {
    if (!this.queue) {
      throw new Error('Data export queue is not configured');
    }

    await this.queue.add(JOB_NAME, data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    });
  }
}
