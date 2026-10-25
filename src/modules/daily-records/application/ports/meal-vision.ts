/**
 * 餐食分析用的视觉模型端口（出站）。
 *
 * ## 为什么错误是 `DomainFailure` 而不是异常
 *
 * ADR-0012：模型调用是**可预期的外部依赖**，超时/不可达/输出不合契约都是正常
 * 失败分支，必须走 Result 边界，否则异常会穿过队列，记录永久停在 `analyzing`
 * （v1 的缺陷）。失败码到落库原因码的映射在应用层
 * `application/services/meal-analysis-pipeline.ts` 里。
 *
 * ## 端口形状
 *
 * 只认识「一张图 + 语言 → 草稿」，不认识 prompt、模型名、超时与安全过滤——
 * 那些都是基础设施的实现细节（`infrastructure/llm/`）。
 */
import type {
  DomainFailure,
  ResultAsync,
} from '../../../../common/result/index.js';
import type { MealAnalysisDraft } from '../../domain/meal/meal-analysis.js';

export interface MealAnalysisVisionInput {
  imageUrl: string;
  /** 分析时用户的语言（`zh-CN` / `en`）：文案按它生成并随分析一起落库。 */
  locale: string;
}

export interface MealAnalysisVisionSuccess {
  draft: MealAnalysisDraft;
  model: string | null;
}

export abstract class MealVisionModel {
  /** 是否配置了可用的视觉模型（未配置时 worker 直接落 `vision_unavailable`）。 */
  abstract isConfigured(): boolean;

  /**
   * 分析一张图。
   *
   * 依赖失败码的对应：模型超时 → `DEPENDENCY_TIMEOUT`；模型报错/不可达 →
   * `DEPENDENCY_UNAVAILABLE`；输出不合契约或被安全过滤清空 →
   * `DEPENDENCY_BAD_GATEWAY`。
   */
  abstract analyze(
    input: MealAnalysisVisionInput,
  ): ResultAsync<MealAnalysisVisionSuccess, DomainFailure>;
}
