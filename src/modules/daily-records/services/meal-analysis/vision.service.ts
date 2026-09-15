import { Injectable, Logger } from '@nestjs/common';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { LlmSafetyPolicyService } from '../../../../common/llm/safety/llm-safety-policy.service.js';
import {
  createDomainFailure,
  err,
  fromPromise,
  mapUnknownToDependencyFailure,
  ok,
  type DomainFailure,
  type Result,
  type ResultAsync,
} from '../../../../common/result/index.js';
import { normalizeNullableText } from '../../../../common/index.js';
import { LlmRuntimeService } from '../../../../llm-runtime/index.js';
import { MEAL_ANALYSIS_VISION_TIMEOUT_MS } from '../../constants/meal-analysis.constants.js';
import {
  mealAnalysisModelOutputSchema,
  toMealAnalysisDraft,
  type MealAnalysisDraft,
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

export interface MealAnalysisVisionSuccess {
  draft: MealAnalysisDraft;
  model: string | null;
}

/**
 * 视觉分析：一次多模态调用直出区间、菜名、排序结论与机器维度。
 *
 * 失败走项目统一的 Result 边界（ADR-0012 第 3 节），错误类型是 `DomainFailure`：
 * 调用方（worker）把它翻成落库的失败原因码，而不是让异常穿过队列——v1 的
 * 「坏 JSON 降级成空结果」与「抛错后记录永久 analyzing」都出在这里。
 *
 * 依赖失败码的对应：模型超时 → `DEPENDENCY_TIMEOUT`；模型报错/不可达 →
 * `DEPENDENCY_UNAVAILABLE`；输出不合契约或被安全过滤清空 →
 * `DEPENDENCY_BAD_GATEWAY`。
 */
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

  analyze(
    input: MealAnalysisVisionInput,
  ): ResultAsync<MealAnalysisVisionSuccess, DomainFailure> {
    return fromPromise(this.invokeStructuredModel(input), (error) =>
      classifyVisionFailure(error),
    ).andThen((raw) => this.toSuccess(raw));
  }

  private async invokeStructuredModel(
    input: MealAnalysisVisionInput,
  ): Promise<unknown> {
    const languageLabel = input.locale === 'zh-CN' ? '中文' : 'English';
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

    return structured.invoke([
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
  }

  private toSuccess(
    raw: unknown,
  ): Result<MealAnalysisVisionSuccess, DomainFailure> {
    // 结构化输出已经按 schema 解析过；这里再校验一次，兼容不支持
    // function calling、直接回文本的 OpenAI 兼容端点。
    const parsed = mealAnalysisModelOutputSchema.safeParse(raw);
    if (!parsed.success) {
      this.logger.warn(
        'Meal analysis model output did not match the contract schema',
      );
      return err(
        unusableOutputFailure(
          'model output did not match the contract schema',
          parsed.error,
        ),
      );
    }

    const draft = this.sanitizeDraft(toMealAnalysisDraft(parsed.data));
    if (draft == null) {
      this.logger.warn(
        'Meal analysis output was empty or fully rejected by the safety filter',
      );
      return err(
        unusableOutputFailure('model output was unusable after sanitizing'),
      );
    }

    return ok({
      draft,
      model: this.llmRuntimeService.getModelName('vision'),
    });
  }

  /**
   * 清理模型输出：去掉标记与控制字符，丢掉不安全的文案，并在结果完全无用
   * （没有结论、没有菜名、没有区间）时返回 `null` 让上层落不可用输出。
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

/** 输出不可用（不合契约 / 被安全过滤清空）：上游给了我们不能用的东西。 */
function unusableOutputFailure(detail: string, cause?: unknown): DomainFailure {
  return createDomainFailure({
    kind: 'dependency',
    code: 'DEPENDENCY_BAD_GATEWAY',
    detail,
    ...(cause === undefined ? {} : { cause }),
  });
}

function classifyVisionFailure(error: unknown): DomainFailure {
  if (isTimeoutError(error)) {
    return createDomainFailure({
      kind: 'dependency',
      code: 'DEPENDENCY_TIMEOUT',
      detail: 'meal analysis model call timed out',
      cause: error,
    });
  }

  return mapUnknownToDependencyFailure(
    error,
    'meal analysis model call failed',
  );
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const name = error.name.toLowerCase();
  const message = error.message.toLowerCase();
  return (
    name.includes('timeout') ||
    name.includes('abort') ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('aborted') ||
    message.includes('etimedout')
  );
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
