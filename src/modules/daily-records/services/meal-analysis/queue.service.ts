import { Injectable, Logger } from '@nestjs/common';
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
  private readonly logger = new Logger(MealAnalysisQueueService.name);
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

    try {
      // 不使用确定性 jobId：旧 revision 的冗余 job 由 worker 幂等检查跳过；
      // 失败 job 在保留期内仍可用同 revision 重新入队，而不会被同 jobId 挡住。
      await this.queue.add(MEAL_ANALYSIS_JOB_NAME, job);
    } catch (error) {
      // Redis 配置但断连时回退到同步处理，避免请求直接 500。
      this.logger.error(
        `Failed to enqueue meal analysis job, processing inline: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error instanceof Error ? error.stack : undefined,
      );
      await this.mealAnalysisWorkerService.process(job);
    }
  }
}
