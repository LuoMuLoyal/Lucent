import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { BullmqQueueFactory } from '../../../common/queue/queue.factory.js';
import { BaseAsyncQueueService } from '../../../common/index.js';
import { MedicinesService } from './medicines.service.js';

interface RecognitionJobData {
  userId: string;
  imageUrl: string;
}

export interface MedicineRecognitionResult {
  name: string | null;
  approvalNumber: string | null;
  specification: string | null;
  manufacturer: string | null;
}

const QUEUE_NAME = 'medicine-recognition';
const JOB_NAME = 'recognize';

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
export class MedicineRecognitionQueueService extends BaseAsyncQueueService<
  RecognitionJobData,
  MedicineRecognitionResult
> {
  private readonly medicinesService: MedicinesService;

  constructor(
    factory: BullmqQueueFactory,
    @Inject(CACHE_MANAGER) cache: Cache,
    @Inject(MedicinesService) medicinesService: MedicinesService,
  ) {
    super(QUEUE_NAME, factory, cache, 1, async (job) =>
      this.processJob(
        job,
        (data) => this.medicinesService.recognizeMedicine(data.imageUrl),
        'Medicine recognition job failed',
      ),
    );
    this.medicinesService = medicinesService;
  }

  async enqueue(userId: string, imageUrl: string): Promise<string | null> {
    if (!this.queue) {
      return null;
    }
    const job = await this.queue.add(JOB_NAME, { userId, imageUrl });
    return job.id ?? null;
  }

  async getStatus(jobId: string, userId: string) {
    return this.pollStatus(jobId, userId);
  }
}
