import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { BullmqQueueFactory } from '../../../../common/queue/queue.factory';
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

@Injectable()
export class MealAnalysisQueueService {
  private readonly queue: Queue<MealAnalysisJobData, void> | null;

  constructor(
    factory: BullmqQueueFactory,
    private readonly mealAnalysisWorkerService: MealAnalysisWorkerService,
  ) {
    const handle = factory.createQueue<MealAnalysisJobData>({
      name: MEAL_ANALYSIS_QUEUE_NAME,
      workerConcurrency: 1,
      processor: async (job) => {
        await this.mealAnalysisWorkerService.process(job.data);
      },
    });
    this.queue = handle.queue;
  }

  async enqueue(job: MealAnalysisJobData): Promise<void> {
    if (!this.queue) {
      await this.mealAnalysisWorkerService.process(job);
      return;
    }

    const jobId = `${job.recordId}:${String(job.sourceRevision)}`;
    await this.queue.add(MEAL_ANALYSIS_JOB_NAME, job, { jobId });
  }
}
