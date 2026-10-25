import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { BullmqQueueFactory } from '../../../../common/queue/queue.factory.js';
import { QUEUE_NAMES } from '../../../../common/queue/queue-names.js';
import { createDomainFailure } from '../../../../common/result/index.js';
import { DomainFailureException } from '../../../../common/result/domain-failure.exception.js';
import { ProcessExport } from '../../application/use_cases/process-export.js';
import {
  ExportQueue,
  type ExportJob,
} from '../../application/ports/export-queue.js';

export interface ExportJobData {
  exportRequestId: string;
  userId: string;
  language: string;
}

const QUEUE_NAME = QUEUE_NAMES.dataExport;
const JOB_NAME = 'export';

@Injectable()
export class BullmqExportQueue extends ExportQueue {
  private readonly queue: Queue<ExportJobData, void> | null;

  constructor(
    factory: BullmqQueueFactory,
    private readonly processor: ProcessExport,
  ) {
    super();
    const handle = factory.createQueue<ExportJobData>({
      name: QUEUE_NAME,
      runtimeKey: QUEUE_NAME,
      processor: async (job) => {
        await this.processor.process(job.data);
      },
    });
    this.queue = handle.queue;
  }

  get isConfigured(): boolean {
    return this.queue != null;
  }

  async enqueue(data: ExportJob): Promise<void> {
    if (!this.queue) {
      throw new DomainFailureException(
        createDomainFailure({
          kind: 'dependency',
          code: 'DEPENDENCY_UNAVAILABLE',
          cause: 'export_queue_not_configured',
        }),
      );
    }

    await this.queue.add(JOB_NAME, data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    });
  }
}
