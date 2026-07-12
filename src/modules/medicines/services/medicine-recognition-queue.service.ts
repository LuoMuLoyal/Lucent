import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import type { Queue, Job } from 'bullmq';
import { BullmqQueueFactory } from '../../../common/queue/queue.factory';
import { MedicinesService } from './medicines.service';

interface RecognitionJobData {
  imageUrl: string;
}

export interface MedicineRecognitionResult {
  name: string | null;
  approvalNumber: string | null;
  specification: string | null;
  manufacturer: string | null;
}

interface RecognitionJobResult {
  status: 'completed' | 'failed';
  result?: MedicineRecognitionResult;
  error?: string;
}

const QUEUE_NAME = 'medicine-recognition';
const JOB_NAME = 'recognize';
const RESULT_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * BullMQ queue for async medicine box image recognition.
 *
 * When Redis is available, `enqueue()` adds a job to the queue and the worker
 * processes it in the background. The result is stored in the cache so the
 * client can poll `getStatus()`.
 *
 * When Redis is not available, `isConfigured` is false and callers should
 * fall back to the synchronous `MedicinesService.recognizeMedicine()` method.
 */
@Injectable()
export class MedicineRecognitionQueueService {
  private readonly logger = new Logger(MedicineRecognitionQueueService.name);
  private readonly queue: Queue<
    RecognitionJobData,
    RecognitionJobResult
  > | null;

  constructor(
    factory: BullmqQueueFactory,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly medicinesService: MedicinesService,
  ) {
    const handle = factory.createQueue<
      RecognitionJobData,
      RecognitionJobResult
    >({
      name: QUEUE_NAME,
      workerConcurrency: 1,
      processor: async (job) => {
        return this.processJob(job);
      },
    });
    this.queue = handle.queue;
  }

  get isConfigured(): boolean {
    return this.queue != null;
  }

  async enqueue(imageUrl: string): Promise<string | null> {
    if (!this.queue) {
      return null;
    }

    const job = await this.queue.add(JOB_NAME, { imageUrl });
    return job.id ?? null;
  }

  async getStatus(jobId: string): Promise<{
    status: 'pending' | 'completed' | 'failed';
    result?: MedicineRecognitionResult;
    error?: string;
  } | null> {
    const cached = await this.cache.get<RecognitionJobResult>(
      this.resultKey(jobId),
    );
    if (cached != null) {
      return {
        status: cached.status,
        ...(cached.result != null ? { result: cached.result } : {}),
        ...(cached.error != null ? { error: cached.error } : {}),
      };
    }

    if (!this.queue) {
      return null;
    }

    const job = (await this.queue.getJob(jobId)) as Job<
      RecognitionJobData,
      RecognitionJobResult
    > | null;
    if (job == null) {
      return null;
    }

    const state = await job.getState();
    if (state === 'completed') {
      const result = job.returnvalue;
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- returnvalue may be undefined at runtime
      if (result != null) {
        return {
          status: result.status,
          ...(result.result != null ? { result: result.result } : {}),
          ...(result.error != null ? { error: result.error } : {}),
        };
      }
      return { status: 'completed' };
    }

    if (state === 'failed') {
      return {
        status: 'failed',
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- failedReason may be undefined at runtime
        error: job.failedReason ?? 'Unknown error',
      };
    }

    return { status: 'pending' };
  }

  private async processJob(job: {
    id: string | undefined;
    data: RecognitionJobData;
  }): Promise<RecognitionJobResult> {
    try {
      const result = await this.medicinesService.recognizeMedicine(
        job.data.imageUrl,
      );
      const jobResult: RecognitionJobResult = { status: 'completed', result };
      if (job.id != null) {
        await this.cache.set(this.resultKey(job.id), jobResult, RESULT_TTL_MS);
      }
      return jobResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Medicine recognition job failed: ${message}`);
      const jobResult: RecognitionJobResult = {
        status: 'failed',
        error: message,
      };
      if (job.id != null) {
        await this.cache.set(this.resultKey(job.id), jobResult, RESULT_TTL_MS);
      }
      return jobResult;
    }
  }

  private resultKey(jobId: string): string {
    return `async-job:${QUEUE_NAME}:${jobId}`;
  }
}
