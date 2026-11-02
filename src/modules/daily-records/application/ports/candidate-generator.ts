/**
 * 候选生成与文案的出站端口（应用层词汇）。
 *
 * ## 为什么用抽象类而不是 interface
 *
 * NestJS 的 DI token 需要运行时的值；interface 在编译后被擦除。抽象类既能当
 * 类型用，又能当 token 用（与 `MealVisionModel` 同一模式）。
 *
 * ## 依赖方向
 *
 * 编排（`application/use_cases/generate-candidates.ts`）只依赖这两个端口；
 * 模型实现在 `infrastructure/llm/`，文案实现在 `application/services/candidate-copy.ts`。
 * 这修掉了原先用例直接 import `adapters/http/dto/candidates/*` 的反向依赖。
 */
import type {
  DailyRecordCandidateData,
  DailyRecordCandidateItem,
} from './record-candidates.js';

export interface CandidateGenerationContext {
  text: string;
  occurredAt: string;
  timezone: string | null;
}

export interface CandidateGenerationResult {
  items: DailyRecordCandidateItem[];
}

export abstract class CandidateGenerator {
  /** 是否配置了可用的语言模型（未配置时用例直接回 503，而不是降级）。 */
  abstract isConfigured(): boolean;

  /** 生成候选；模型或契约失败时抛错，由用例降级成兜底候选。 */
  abstract generate(
    context: CandidateGenerationContext,
    locale: string,
  ): Promise<CandidateGenerationResult>;
}

/** 候选文案（多语言提示语与兜底文案）。 */
export abstract class CandidateCopyPort {
  abstract resolveLocale(language: string | undefined): string;
  abstract serviceUnavailable(locale: string): string;
  abstract confirmationHint(locale: string): string;
  abstract buildFallback(
    text: string,
    occurredAt: string,
    locale: string,
  ): DailyRecordCandidateData;
}
