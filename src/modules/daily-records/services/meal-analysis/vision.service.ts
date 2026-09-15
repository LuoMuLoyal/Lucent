import { Injectable, Logger } from '@nestjs/common';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { LlmSafetyPolicyService } from '../../../../common/llm/safety/llm-safety-policy.service.js';
import { normalizeNullableText } from '../../../../common/index.js';
import { LlmRuntimeService } from '../../../../llm-runtime/index.js';
import { MEAL_ANALYSIS_VISION_TIMEOUT_MS } from '../../constants/meal-analysis.constants.js';
import {
  mealAnalysisModelOutputSchema,
  toMealAnalysisDraft,
  type MealAnalysisDraft,
  type MealAnalysisFailureReason,
} from '../../schemas/meal-analysis.schema.js';
import {
  buildMealAnalysisSystemPrompt,
  buildMealAnalysisUserPrompt,
} from '../../prompts/meal-analysis.prompt.js';

export interface MealAnalysisVisionInput {
  imageUrl: string;
  /** 分析时用户的语言（`zh-CN` / `en`）：文案按它生成并随分析一起落库。 */
  locale: string;
}

/**
 * 视觉分析结果。失败是**返回值**而不是异常：调用方（worker）需要把原因码
 * 落到记录上，异常会在队列里变成重试与永久 `analyzing`（v1 的缺陷）。
 */
export type MealAnalysisVisionOutcome =
  | { ok: true; draft: MealAnalysisDraft; model: string | null }
  | { ok: false; reason: MealAnalysisFailureReason };

@Injectable()
export class MealAnalysisVisionService {
  private readonly logger = new Logger(MealAnalysisVisionService.name);

  constructor(
    private readonly llmRuntimeService: LlmRuntimeService,
    private readonly safetyPolicyService: LlmSafetyPolicyService,
  ) {}

  isConfigured(): boolean {
    return this.llmRuntimeService.hasRoleConfig('vision');
  }

  /** 一次多模态调用直出区间、菜名、排序结论与机器维度。 */
  async analyze(
    input: MealAnalysisVisionInput,
  ): Promise<MealAnalysisVisionOutcome> {
    const languageLabel = input.locale === 'zh-CN' ? '中文' : 'English';

    try {
      const model = this.llmRuntimeService.createChatModel('vision', {
        temperature: 0.1,
        maxRetries: 0,
        timeout: MEAL_ANALYSIS_VISION_TIMEOUT_MS,
      });
      const structured = model.withStructuredOutput(
        mealAnalysisModelOutputSchema,
        {
          name: 'emit_meal_analysis',
          method: 'functionCalling',
          strict: true,
        },
      );

      const raw: unknown = await structured.invoke([
        new SystemMessage(buildMealAnalysisSystemPrompt(languageLabel)),
        new HumanMessage({
          content: [
            {
              type: 'text',
              text: buildMealAnalysisUserPrompt(languageLabel),
            },
            {
              type: 'image_url',
              image_url: { url: input.imageUrl },
            },
          ],
        }),
      ]);

      // 结构化输出已经按 schema 解析过；这里再校验一次，兼容不支持
      // function calling、直接回文本的 OpenAI 兼容端点。
      const parsed = mealAnalysisModelOutputSchema.safeParse(raw);
      if (!parsed.success) {
        this.logger.warn(
          'Meal analysis model output did not match the contract schema',
        );
        return { ok: false, reason: 'invalid_output' };
      }

      const draft = this.sanitizeDraft(toMealAnalysisDraft(parsed.data));
      if (draft == null) {
        this.logger.warn(
          'Meal analysis output was empty or fully rejected by the safety filter',
        );
        return { ok: false, reason: 'invalid_output' };
      }

      return {
        ok: true,
        draft,
        model: this.llmRuntimeService.getModelName('vision'),
      };
    } catch (error) {
      const reason = classifyVisionError(error);
      this.logger.warn(
        `Meal analysis model call failed (${reason}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { ok: false, reason };
    }
  }

  /**
   * 清理模型输出：去掉标记与控制字符，丢掉不安全的文案，并在结果完全无用
   * （没有结论、没有菜名、没有区间）时返回 `null` 让上层落 `invalid_output`。
   */
  private sanitizeDraft(draft: MealAnalysisDraft): MealAnalysisDraft | null {
    const items: Array<{
      rank: unknown;
      kind: unknown;
      polarity: unknown;
      headline: string;
      detail: string;
    }> = [];
    for (const item of draft.items ?? []) {
      const headline = this.sanitizeText(item.headline);
      const detail = this.sanitizeText(item.detail);
      if (headline == null || detail == null) {
        continue;
      }
      if (
        !this.safetyPolicyService.isSafeText(headline) ||
        !this.safetyPolicyService.isSafeText(detail)
      ) {
        this.logger.warn('Meal analysis item rejected by safety filter');
        continue;
      }
      items.push({
        rank: item.rank,
        kind: item.kind,
        polarity: item.polarity,
        headline,
        detail,
      });
    }

    const dishes: Array<{ name: string; source: unknown }> = [];
    for (const dish of draft.dishes ?? []) {
      const name = this.sanitizeText(dish.name);
      if (name == null || !this.safetyPolicyService.isSafeText(name)) {
        this.logger.warn('Meal dish name rejected by safety filter');
        continue;
      }
      dishes.push({ name, source: dish.source });
    }

    if (
      items.length === 0 &&
      dishes.length === 0 &&
      draft.calorieRange == null
    ) {
      return null;
    }

    return {
      calorieRange: draft.calorieRange ?? null,
      dishes,
      items,
      facets: draft.facets ?? {},
    };
  }

  private sanitizeText(raw: unknown): string | null {
    if (typeof raw !== 'string') {
      return null;
    }

    const withoutScriptBlocks = raw
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
    const withoutMarkup = withoutScriptBlocks
      .replace(/<[^>]*>/g, '')
      .split('')
      .filter((char) => !isControlCharacter(char))
      .join('');

    return normalizeNullableText(withoutMarkup);
  }
}

function classifyVisionError(error: unknown): MealAnalysisFailureReason {
  if (!(error instanceof Error)) {
    return 'model_failed';
  }

  const name = error.name.toLowerCase();
  const message = error.message.toLowerCase();
  if (
    name.includes('timeout') ||
    name.includes('abort') ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('aborted') ||
    message.includes('etimedout')
  ) {
    return 'model_timeout';
  }
  if (name.includes('zod') || message.includes('failed to parse')) {
    return 'invalid_output';
  }
  return 'model_failed';
}

function isControlCharacter(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (
    code <= 0x08 ||
    (code >= 0x0b && code <= 0x0c) ||
    (code >= 0x0e && code <= 0x1f) ||
    code === 0x7f
  );
}
