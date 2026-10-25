/**
 * 过期 `analyzing` 回收的调度适配器（cron 每 5 分钟一次，由 `CronJobsService` 触发）。
 *
 * 这里只做两件事：按**调用时刻**读运行时配置（`staleAfterMs` / `batchSize`），
 * 然后把单轮回收交给 `MealAnalysisPipeline`。判定规则、失败码与幂等都在应用层，
 * 保证「worker 落失败」与「回收器落失败」不会漂移成两套语义。
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import { EnvKey } from '../../../../config/env/env-keys.enum.js';
import { RuntimeConfigService } from '../../../../config/runtime/runtime-config.service.js';
import type { RuntimeConfigPort } from '../../../../config/runtime/runtime-config.types.js';
import {
  MEAL_ANALYSIS_REAP_BATCH_SIZE,
  MEAL_ANALYSIS_STALE_AFTER_MS,
} from '../../constants/meal-analysis.constants.js';
import { MealAnalysisPipeline } from '../../application/services/meal-analysis-pipeline.js';
import type { ReapSettings } from '../../application/services/meal-analysis-job.js';

@Injectable()
export class MealAnalysisSweeper {
  constructor(
    private readonly pipeline: MealAnalysisPipeline,
    @Optional()
    @Inject(RuntimeConfigService)
    private readonly runtimeConfig?: RuntimeConfigPort,
  ) {}

  /**
   * 单轮的过期窗口与批量上限，**按次读**运行时快照：发布新配置后下一次回收就生效，
   * 而不是等进程重启。
   */
  private readSettings(): ReapSettings {
    const values = this.runtimeConfig?.getSnapshot().values;
    return {
      staleAfterMs:
        values?.[EnvKey.MEAL_ANALYSIS_STALE_AFTER_MS] ??
        MEAL_ANALYSIS_STALE_AFTER_MS,
      batchSize:
        values?.[EnvKey.MEAL_ANALYSIS_REAP_BATCH_SIZE] ??
        MEAL_ANALYSIS_REAP_BATCH_SIZE,
    };
  }

  async reapStaleAnalyses(): Promise<number> {
    return this.pipeline.reapStale(this.readSettings());
  }
}
