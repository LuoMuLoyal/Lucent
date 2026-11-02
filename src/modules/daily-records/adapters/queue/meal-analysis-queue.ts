/**
 * 餐食分析队列消费者（入站适配器）。
 *
 * ## 为什么 processor 与出站端口是同一个类
 *
 * processor 是**交付层**的东西：它把队列载荷翻译成应用层作业交给
 * `MealAnalysisPipeline`。端口 `MealAnalysisJobs`（出站）也由它实现——入队与消费
 * 共用同一个队列句柄，拆成两个类只会让「同一队列的两个句柄」需要额外的注入配置。
 *
 * ## 两条容错约定
 *
 * - 未配置队列（本地/测试）时同步执行：队列是性能优化，不是业务前置条件。
 * - 入队失败（Redis 断连）时同样回退同步执行，避免请求直接 500。
 */
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { BullmqQueueFactory } from '../../../../common/queue/queue.factory.js';
import {
  MEAL_ANALYSIS_JOB_NAME,
  MEAL_ANALYSIS_QUEUE_NAME,
} from '../../constants/meal-analysis.constants.js';
import { MealAnalysisJobs } from '../../application/ports/meal-analysis-jobs.js';
import type { MealAnalysisJob } from '../../application/services/meal-analysis-job.js';
import { MealAnalysisPipeline } from '../../application/services/meal-analysis-pipeline.js';

@Injectable()
export class MealAnalysisQueue extends MealAnalysisJobs {
  private readonly logger = new Logger(MealAnalysisQueue.name);
  private readonly queue: Queue<MealAnalysisJob, void> | null;

  constructor(
    factory: BullmqQueueFactory,
    private readonly pipeline: MealAnalysisPipeline,
  ) {
    super();
    const handle = factory.createQueue<MealAnalysisJob>({
      name: MEAL_ANALYSIS_QUEUE_NAME,
      runtimeKey: MEAL_ANALYSIS_QUEUE_NAME,
      processor: async (job) => {
        await this.pipeline.analyze(job.data);
      },
    });
    this.queue = handle.queue;
  }

  async enqueue(job: MealAnalysisJob): Promise<void> {
    if (!this.queue) {
      await this.pipeline.analyze(job);
      return;
    }

    try {
      // 不使用确定性 jobId：旧 revision 的冗余 job 由 pipeline 的幂等检查跳过；
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
      await this.pipeline.analyze(job);
    }
  }
}
