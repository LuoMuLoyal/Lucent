import { Injectable } from '@nestjs/common';
import { BaseLlmGeneratorService } from '../../../../common/llm/generators/base-llm-generator.service.js';
import { LlmCircuitBreakerService } from '../../../../common/llm/safety/llm-circuit-breaker.service.js';
import { MetricsService } from '../../../../common/metrics/metrics.service.js';
import { LlmRuntimeService } from '../../../../llm-runtime/index.js';
import {
  buildOntologyCypherSystemPrompt,
  buildOntologyCypherUserPrompt,
} from './cypher.prompt.js';
import {
  ontologyCypherSchema,
  type OntologyCypherContext,
  type OntologyCypherOutput,
} from './cypher.schema.js';

/**
 * 把问题翻译成只读 Cypher 的生成器（计划 §3.5 ②）。
 *
 * 走 `BaseLlmGeneratorService` 而不是自己调模型：结构化输出、重试、熔断、
 * 指标与 OTel span 都已经在基类里实现一次，重复实现只会让这三件事各自漂移。
 *
 * 角色是 `language`（文本理解 → 结构化输出），与"餐食候选"等同属生成类任务；
 * 未配置该角色时工具层返回"未配置"信封，而不是抛错。
 */
@Injectable()
export class OntologyCypherGeneratorService extends BaseLlmGeneratorService<
  OntologyCypherContext,
  // 本生成器没有本地化文案副本（提示词全英文，图谱也是英文侧），空对象占位。
  Record<string, never>,
  OntologyCypherOutput
> {
  protected readonly schema = ontologyCypherSchema;
  protected readonly modelRole = 'language';
  protected readonly options = {
    toolName: 'OntologyCypherQuery',
    streamName: 'Ontology Cypher generation',
  } as const;

  public constructor(
    llmRuntimeService: LlmRuntimeService,
    metricsService: MetricsService,
    circuitBreaker: LlmCircuitBreakerService,
  ) {
    super(llmRuntimeService, metricsService, circuitBreaker);
  }

  /**
   * 基类把"当前 `modelRole` 是否配置"的访问器命名为 `hasAnalysisModel()`；
   * 本生成器用的是 `language` 角色，调用点需要一个诚实的名字。
   */
  hasLanguageModel(): boolean {
    return this.hasAnalysisModel();
  }

  protected buildSystemPrompt(): string {
    return buildOntologyCypherSystemPrompt();
  }

  protected buildUserPrompt(
    context: OntologyCypherContext,
    _promptCopy: Record<string, never>,
  ): string {
    return buildOntologyCypherUserPrompt(context);
  }
}
