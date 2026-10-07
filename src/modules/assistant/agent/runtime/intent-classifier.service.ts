import { Injectable, Logger } from '@nestjs/common';
import { BaseLlmGeneratorService } from '../../../../common/llm/generators/base-llm-generator.service.js';
import { LlmCircuitBreakerService } from '../../../../common/llm/safety/llm-circuit-breaker.service.js';
import { MetricsService } from '../../../../common/metrics/metrics.service.js';
import { LlmRuntimeService } from '../../../../llm-runtime/index.js';
import {
  buildIntentRouterSystemPrompt,
  buildIntentRouterUserPrompt,
} from '../../prompts/intent-router.prompt.js';
import {
  assistantToolSelectionSchema,
  type AssistantToolSelectionOutput,
} from '../../schemas/intent-routing.schema.js';
import type {
  AssistantContextSource,
  AssistantToolName,
} from '../../tools/shared/tool-types.js';
import type { AssistantToolRoutingOutcome } from './classify.js';

/**
 * 模块级 logger：契约里的 catch 必须能直接调用 `logger.warn`（自定义规则 error-handling/no-silent-catch 按字面量匹配 	his.logger / logger.warn，换名字会被判成静默 catch）。
 */
const logger = new Logger('AssistantIntentClassifierService');

export type { AssistantToolRoutingOutcome };

/**
 * 一次路由调用的输入。
 *
 * `candidateTools` 由调用方算好并随 context 一起传进来，因为候选集既是提示词的
 * 一部分（用户提示词里列出的工具目录），也是**硬上限**（输出与它求交）。
 */
export interface AssistantToolRoutingContext {
  userMessage: string;
  locale: string;
  enabledContextSources: readonly AssistantContextSource[];
  candidateTools: readonly AssistantToolName[];
}

/**
 * 路由结果类型的定义在 `classify.ts`（纯类型、无 Nest 依赖），这里只做转发，
 * 便于调用方从"选择器"这一个入口拿到它。
 */

/**
 * 每轮工具选择器。
 *
 * 走 `BaseLlmGeneratorService`（结构化输出 + 重试 + 熔断 + 指标 + OTel span 都由基类
 * 实现一次），角色是 `language`：与 Cypher 生成同属"文本理解 → 结构化输出"，
 * 且**不需要任何新增环境变量**。
 *
 * 契约：`selectTools()` **永不抛**。路由失败必须变成一次可观测的降级，而不是把
 * 整轮对话打挂 —— 用户此刻要的仍然是一个回答。
 */
@Injectable()
export class AssistantIntentClassifierService extends BaseLlmGeneratorService<
  AssistantToolRoutingContext,
  // 无本地化文案副本（提示词全英文），空对象占位。
  Record<string, never>,
  AssistantToolSelectionOutput
> {
  protected readonly schema = assistantToolSelectionSchema;
  protected readonly modelRole = 'language';
  protected readonly options = {
    toolName: 'AssistantToolSelection',
    streamName: 'Assistant tool selection',
  } as const;

  public constructor(
    llmRuntimeService: LlmRuntimeService,
    private readonly metrics: MetricsService,
    circuitBreaker: LlmCircuitBreakerService,
  ) {
    super(llmRuntimeService, metrics, circuitBreaker);
  }

  /**
   * 基类把"当前 `modelRole` 是否配置"的访问器命名为 `hasAnalysisModel()`
   * （历史命名）；本服务用的是 `language` 角色，调用点要一个诚实的名字。
   */
  hasLanguageModel(): boolean {
    return this.hasAnalysisModel();
  }

  /**
   * 选出本轮要绑定的工具，并与候选集合求交。
   *
   * 候选集是**硬上限**：用户没开启的个人数据来源、以及 sidecar 不可用的工具
   * 早已不在 `candidateTools` 里（调用方负责算，见 `graph.ts`）。模型即使报出
   * 集合外的名字（幻觉或提示注入）也会在这里被丢掉并留痕。
   */
  async selectTools(
    userMessage: string,
    locale: string,
    enabledContextSources: readonly AssistantContextSource[],
    candidateTools: readonly AssistantToolName[],
  ): Promise<AssistantToolRoutingOutcome> {
    const candidates = [...candidateTools];

    if (candidates.length === 0) {
      // 没有任何可用工具：不调模型，空集是确定答案（调用方会走 no_match）。
      this.metrics.recordAssistantIntentRouting('llm');
      return { source: 'llm', tools: [] };
    }

    if (!this.hasLanguageModel()) {
      return this.degrade('the routing model role is not configured');
    }

    try {
      const output = await this.generate(
        {
          userMessage,
          locale,
          enabledContextSources,
          candidateTools: candidates,
        },
        {},
      );
      const allowed = new Set(candidates);
      const outside = output.tools.filter((tool) => !allowed.has(tool));
      if (outside.length > 0) {
        logger.warn(
          `Assistant tool selection returned tools outside the candidate set: ${outside.join(', ')}; dropped.`,
        );
      }
      const tools = output.tools.filter((tool) => allowed.has(tool));
      this.metrics.recordAssistantIntentRouting('llm');
      return { source: 'llm', tools };
    } catch (error) {
      // 显式留痕：no-silent-catch 要求 catch 里看得见日志（`degrade` 另记一条降级
      // 日志，这里记的是**原因**）。
      const reason = error instanceof Error ? error.message : String(error);
      logger.warn(`Assistant tool selection failed, degrading: ${reason}`);
      return this.degrade(reason);
    }
  }

  private degrade(reason: string): AssistantToolRoutingOutcome {
    // 降级必须留痕：它是异常态，不是兜底常态。持续出现说明路由角色没配好、
    // 或熔断长期打开 —— 那时每轮都会绑上全部工具（能用，但更贵、更易误调）。
    logger.warn(
      `Assistant tool selection degraded to all available tools: ${reason}`,
    );
    this.metrics.recordAssistantIntentRouting('degraded_all_tools');
    return { source: 'degraded_all_tools', reason };
  }

  protected buildSystemPrompt(): string {
    return buildIntentRouterSystemPrompt();
  }

  protected buildUserPrompt(
    context: AssistantToolRoutingContext,
    _promptCopy: Record<string, never>,
  ): string {
    return buildIntentRouterUserPrompt(context);
  }
}
