# AI 文案生成异步化重构计划

**日期**: 2026-07-22  
**状态**: 计划中  
**关联**: 替换原方案 `2026-07-22-ai-generated-suggestion-copy.md`

---

## 背景

原方案存在以下问题：

1. **架构违规**: 直接实例化 `ChatOpenAI`，未复用 `BaseLlmGeneratorService` + `LlmRuntimeService` 架构
2. **同步阻塞**: 每次用户打开"今日"页面都同步调用 LLM，增加延迟和成本
3. **体验问题**: 用户先看到兜底文案，过一会儿变成 AI 文案，产生"闪烁"不一致

---

## 目标

1. 使用 `BaseLlmGeneratorService` 架构统一 LLM 调用
2. **复用 `BaseAsyncQueueService` + BullMQ** 实现异步生成（与 `ExplanationQueueService` 同一模式）
3. **保留 Redis 缓存去重**——按 `templateKey + params + locale` 哈希共享文案，不同用户相同参数只调用一次 LLM
4. 消除同步阻塞，用户请求不触发 LLM 调用
5. **丰富 LLM 上下文**——向 LLM 传入 evidence、confidence、suggestionType 等信息（对齐 `ExplanationGeneratorService` 的上下文质量），使生成的文案更有依据、更贴合场景

---

## 架构设计决策

### 为什么不用 fire-and-forget + cron 轮询？

| 维度         | fire-and-forget + cron          | BullMQ 队列（本方案）                |
| ------------ | ------------------------------- | ------------------------------------ |
| 重试         | ❌ 无                           | ✅ 内置 3 次指数退避                 |
| 进程崩溃恢复 | ❌ 依赖 cron 补偿（≤5min 延迟） | ✅ BullMQ 持久化 job                 |
| 竞态风险     | ⚠️ fire-and-forget vs cron 并发 | ✅ worker 内二次 cache check         |
| 降级策略     | ❌ 无                           | ✅ Redis 不可用时同步调用            |
| 代码库先例   | ❌ 无                           | ✅ 5 个 `BaseAsyncQueueService` 子类 |

### 为什么不用 DB 持久化 AI 文案？

| 维度              | DB 持久化（每条建议独立列） | Redis 缓存去重（本方案）        |
| ----------------- | --------------------------- | ------------------------------- |
| 跨用户去重        | ❌ 每条建议独立调用 LLM     | ✅ 相同 templateKey+params 共享 |
| Observations 支持 | ❌ 无 DB 记录，无法生成     | ✅ 走 cache，不依赖 DB          |
| Schema 变更       | 4 个 nullable 列 + 索引     | 0（可选加 1 个 JSONB）          |
| Context 重建      | ❌ 有损（params 未持久化）  | ✅ job data 携带完整 context    |

---

## 新架构设计

### 核心原则

- **读时优先缓存**: 用户请求时先查 Redis cache，命中则直接返回 AI 文案
- **Cache miss 返回兜底 + 入队**: 未命中时返回兜底文案，同时向 BullMQ 队列入队异步生成
- **Worker 写回缓存**: BullMQ worker 调用 LLM 生成后写入 Redis cache（按 templateKey+params hash，1h TTL）
- **Redis 不可用时降级**: 同步调用 LLM（与 `ExplanationQueueService` 同一降级模式）

### 架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         数据流 (读路径 — 用户请求)                        │
└─────────────────────────────────────────────────────────────────────────┘

  用户请求 GET /suggestions
         │
         ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│  Suggestion     │────▶│  SuggestionCopy  │────▶│  Redis cache 查询    │
│  Service        │     │  Service         │     │  (templateKey hash)  │
└─────────────────┘     └──────────────────┘     └─────────────────────┘
                               │                        │
                    ┌──────────┴──────────┐             │
                    │ HIT                  │ MISS        │
                    ▼                      ▼             │
              返回 AI 文案          返回兜底文案          │
              (无 LLM 调用)        + enqueue BullMQ ────▶│
                                                    [后台异步]


┌─────────────────────────────────────────────────────────────────────────┐
│                         数据流 (写路径 — BullMQ Worker)                    │
└─────────────────────────────────────────────────────────────────────────┘

  BullMQ Worker (concurrency: 3)
         │
         ▼
┌──────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│  二次 cache check │────▶│  SuggestionCopy  │────▶│  存入 Redis cache   │
│  (并发去重)       │     │  LlmService      │     │  (1h TTL)           │
└──────────────────┘     │  (BaseLlmGen)    │     └─────────────────────┘
         │ HIT            └──────────────────┘
         ▼                        │ 失败
    跳过 LLM 调用                 ▼
                         BullMQ 自动重试 (3次指数退避)
                         最终失败 → 下次请求重新入队
```

### 时序图

```
场景 1: 用户首次请求 (cache miss)

Client      SuggestionService     CopyService        Redis cache      BullMQ
  │               │                    │                  │              │
  │── GET ───────▶│                    │                  │              │
  │               │── getOrEnqueue ───▶│                  │              │
  │               │                    │── getCopy ──────▶│              │
  │               │                    │◀─ miss ─────────│              │
  │               │                    │                  │              │
  │               │                    │── enqueue ──────────────────────▶│
  │               │                    │── return fallback               │
  │               │◀─ fallback ────────│                  │              │
  │◀─ response ───│                    │                  │              │
  │  (兜底文案)    │                    │                  │              │
  │               │                    │                  │              │
  │               │             [BullMQ Worker 异步处理]    │              │
  │               │                    │── getCopy ──────▶│ (二次check)  │
  │               │                    │◀─ miss ─────────│              │
  │               │                    │── LLM generate ──│              │
  │               │                    │── setCopy ──────▶│ (写入cache)  │


场景 2: 用户再次请求 (cache hit)

Client      SuggestionService     CopyService        Redis cache
  │               │                    │                  │
  │── GET ───────▶│                    │                  │
  │               │── getOrEnqueue ───▶│                  │
  │               │                    │── getCopy ──────▶│
  │               │                    │◀─ HIT ──────────│
  │               │                    │── return AI copy │
  │               │◀─ AI copy ─────────│                  │
  │◀─ response ───│                    │                  │
  │  (AI 文案)    │                    │                  │


场景 3: 不同用户相同参数 (cache 共享)

用户 A 请求 "water.behind.target" + {completedCount:2, targetCount:8, ...}
  → cache miss → 兜底 + 入队 → worker 生成 → 存入 cache

用户 B 请求 "water.behind.target" + {completedCount:2, targetCount:8, ...}
  → cache HIT → 直接返回 AI 文案 (无需 LLM 调用)
```

---

## 数据结构变更

### 数据库 Schema

**不修改 `UserSuggestion` 表**。AI 文案存储在 Redis cache 中，按 `templateKey + params + locale` 哈希去重，TTL 1 小时（复用现有 `COPY_CACHE_TTL_MS`）。

如需跨 Redis 重启的持久化兜底（可选，Phase 6），加一个 JSONB 列：

```prisma
model UserSuggestion {
  // ... 现有字段 ...
  generatedCopy    Json?     @map("generated_copy") @db.JsonB
  copyGeneratedAt  DateTime? @map("copy_generated_at") @db.Timestamptz(3)
}
```

### 类型定义

```typescript
// src/modules/today-suggestion/types/copy-generation.types.ts

import type { SuggestionType, SuggestionConfidence } from './suggestion.types';
import type { EvidenceItem } from './signal.types';

/**
 * BullMQ job 数据 — 携带完整 context，无需从 DB 重建。
 *
 * 相比原方案（仅 templateKey + params），新增 evidence、confidence、
 * suggestionType、ruleId、subtype、originalTitle 等字段，使 LLM 能
 * 基于具体证据生成更有依据的文案（对齐 ExplanationGeneratorService
 * 的上下文质量）。
 *
 * 注意：cache key 仍然只按 templateKey + params + locale 计算，因为
 * evidence 是由相同 rule + 相同 params 确定性生成的，不影响去重。
 */
export interface CopyJobData {
  // ── 原有字段 ──
  templateKey: string;
  params: Record<string, string | number>;
  locale: string;
  tone?: 'gentle' | 'direct' | 'professional';

  // ── 新增：丰富 LLM 上下文（对齐 ExplanationGeneratorService）──
  /** 建议类型，影响文案语气和措辞策略 */
  suggestionType: SuggestionType;
  /** 置信度，高置信度可用更确定语气，低置信度需更谨慎 */
  confidence: SuggestionConfidence;
  /** 规则 ID，供 LLM 参考建议来源 */
  ruleId: string;
  /** 子类型（如 'water', 'sleep', 'caffeine'），辅助 LLM 理解场景 */
  subtype?: string;
  /** 证据列表，LLM 的 reason 应引用其中的具体数据 */
  evidence: EvidenceItem[];
  /** 规则生成的原始标题，供 LLM 参考（不要求输出一致） */
  originalTitle: string;
  /** 规则生成的原始原因，供 LLM 参考 */
  originalReason: string;
  /** 规则生成的原始边界声明，供 LLM 参考 */
  originalBoundary: string;
}

/** LLM generator 的 context（与 job data 同构） */
export type CopyGenerationContext = CopyJobData;

/** LLM generator 的 prompt copy */
export interface CopyPromptCopy {
  tone: 'gentle' | 'direct' | 'professional';
  userIntro: string;
  constraints: string;
  factsLabel: string;
}
```

### Cache key 设计说明

cache key 仍然按 `templateKey + params + locale` 哈希计算，**不包含** evidence 等新增字段。原因：

- evidence 由 rule + params 确定性生成——相同 templateKey + 相同 params 必然产生相同 evidence
- 因此 evidence 不影响去重语义
- 保持 cache key 简短稳定，避免 evidence 数组序列化导致的 key 膨胀

---

## 实施步骤

### Phase 1: 创建 `SuggestionCopyLlmService`（替换 `CopyGeneratorService`）

**新建文件** `src/modules/today-suggestion/services/copy/copy-llm-generator.service.ts`：

```typescript
import { Injectable } from '@nestjs/common';
import { BaseLlmGeneratorService } from '../../../../common/llm/base-llm-generator.service';
import { LlmCircuitBreakerService } from '../../../../common/llm/llm-circuit-breaker.service';
import { LlmRuntimeService } from '../../../../llm-runtime';
import { MetricsService } from '../../../../common/metrics/metrics.service';
import {
  GeneratedCopySchema,
  type GeneratedCopy,
} from '../../schemas/copy.schema';
import type { CopyGenerationContext, CopyPromptCopy } from '../../types';
import {
  buildCopySystemPrompt,
  buildCopyUserPrompt,
} from '../../prompts/copy.prompt';

/**
 * LLM generator for suggestion card copy.
 *
 * Extends BaseLlmGeneratorService to use structured-output function calling
 * with a Zod schema, following the same pattern as ExplanationGeneratorService.
 *
 * 与原 CopyGeneratorService 的关键区别：
 * - 不再直接实例化 ChatOpenAI，复用 LlmRuntimeService 的 model role 配置
 * - buildUserPrompt 传入完整 context（evidence, confidence, suggestionType...），
 *   而非仅 templateKey + params，使 LLM 能基于具体证据生成更有依据的文案
 */
@Injectable()
export class SuggestionCopyLlmService extends BaseLlmGeneratorService<
  CopyGenerationContext,
  CopyPromptCopy,
  GeneratedCopy
> {
  protected readonly schema = GeneratedCopySchema;
  protected readonly modelRole = 'language' as const;
  protected readonly options = {
    toolName: 'generate_suggestion_copy',
    streamName: 'SuggestionCopy',
  } as const;

  constructor(
    llmRuntimeService: LlmRuntimeService,
    metricsService: MetricsService,
    circuitBreaker: LlmCircuitBreakerService,
  ) {
    super(llmRuntimeService, metricsService, circuitBreaker);
  }

  protected buildSystemPrompt(): string {
    return buildCopySystemPrompt({ locale: 'zh-CN', tone: 'gentle' });
  }

  protected buildUserPrompt(
    context: CopyGenerationContext,
    promptCopy: CopyPromptCopy,
  ): string {
    // 传入完整 context（evidence, confidence, suggestionType 等）
    return buildCopyUserPrompt(context, promptCopy);
  }
}
```

**修改** `prompts/copy.prompt.ts`——`buildCopyUserPrompt` 签名变更，接收完整 context：

```typescript
import type { CopyGenerationContext } from '../types/copy-generation.types';
import type { CopyPromptCopy } from '../types/copy-generation.types';

/**
 * Builds the user prompt for copy generation.
 *
 * 传入完整 context（evidence, confidence, suggestionType 等），
 * 使 LLM 能基于具体证据生成更有依据的文案。
 */
export function buildCopyUserPrompt(
  context: CopyGenerationContext,
  copy: CopyPromptCopy,
): string {
  return [
    copy.userIntro,
    copy.tone,
    copy.constraints,
    copy.factsLabel,
    JSON.stringify(
      {
        templateKey: context.templateKey,
        suggestionType: context.suggestionType,
        confidence: context.confidence,
        ruleId: context.ruleId,
        ...(context.subtype != null ? { subtype: context.subtype } : {}),
        params: context.params,
        evidence: context.evidence,
        originalTitle: context.originalTitle,
        originalReason: context.originalReason,
        originalBoundary: context.originalBoundary,
      },
      null,
      2,
    ),
  ].join('\n');
}
```

**同时修改** `buildCopySystemPrompt`——在 Rules 部分新增对 evidence/confidence/suggestionType 的指导规则：

```typescript
// 在现有 Rules 列表末尾追加：
// 8. Reason should reference specific items from the evidence array when available
// 9. For high confidence suggestions, use more direct language; for low confidence, hedge appropriately
// 10. suggestionType indicates the card's priority: confirmed_risk/compliance are urgent, behavior_advice is encouraging, coverage is informational
// 11. Use originalReason/originalBoundary as semantic reference, but improve phrasing — do not copy verbatim
```

LLM 收到的完整输入示例（以"饮水不足"为例）：

```
┌─ System Prompt ────────────────────────────────────────┐
│ 角色定位: "health assistant copywriter"                 │
│ 语言/语气/输出格式/规则 — 同现有，不变                    │
└────────────────────────────────────────────────────────┘

┌─ User Prompt ──────────────────────────────────────────┐
│ 请为以下健康建议卡生成更自然的中文文案。                    │
│ 语气应温和、客观...                                      │
│ 只能基于提供的 evidence 生成内容，不得虚构数据。            │
│ Suggestion context:                                    │
│ {                                                      │
│   "templateKey": "water.behind.target",                │
│   "suggestionType": "behavior_advice",                 │
│   "confidence": "medium",                              │
│   "ruleId": "water_behind_target",                     │
│   "subtype": "water",                                  │
│   "params": {                                          │
│     "completedCount": 2,                               │
│     "targetCount": 8,                                  │
│     "remainingCount": 6,                               │
│     "completionRate": 25,                              │
│     "consecutiveDays": 3                               │
│   },                                                   │
│   "evidence": [                                        │
│     { "kind": "record", "label": "当前杯数", "value": "2 杯" },   │
│     { "kind": "record", "label": "目标杯数", "value": "8 杯" },   │
│     { "kind": "baseline", "label": "近期记录天数", "value": "3 天" }│
│   ],                                                   │
│   "originalTitle": "今日饮水还差 6 杯",                  │
│   "originalReason": "今日已记录 2 杯，目标 8 杯...",      │
│   "originalBoundary": "饮水建议仅供参考..."              │
│ }                                                      │
└────────────────────────────────────────────────────────┘
```

对比原方案（仅传入 `templateKey` + `params`），LLM 现在可以：

- 从 `evidence` 中引用"近 3 天"等基线数据，使 reason 更有依据
- 根据 `confidence: medium` 使用适当谨慎的语气
- 根据 `suggestionType: behavior_advice` 选择鼓励性而非警告性措辞
- 参考 `originalReason` 保持语义一致同时优化表达

**保留现有文件**：

- `schemas/copy.schema.ts` — Zod schema 不变
- `constants/copy-templates.ts` — 模板注册表不变
- `constants/copy-fallback.ts` — 兜底文案不变

### Phase 2: 创建 `SuggestionCopyQueueService`（模仿 `ExplanationQueueService`）

**新建文件** `src/modules/today-suggestion/services/copy/copy-queue.service.ts`：

```typescript
import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { BullmqQueueFactory } from '../../../../common/queue/queue.factory';
import { BaseAsyncQueueService } from '../../../../common/queue';
import {
  SuggestionCopyService,
  type CopyGenerationResult,
} from './copy.service';
import type { CopyJobData } from '../../types';

const QUEUE_NAME = 'suggestion-copy-generation';
const JOB_NAME = 'generate-copy';

/**
 * BullMQ queue for async suggestion copy generation.
 *
 * When Redis is available, `enqueue()` adds a job to the queue and the worker
 * processes it in the background. The result is stored in the copy cache.
 *
 * When Redis is not available, `isConfigured` is false and callers should
 * fall back to the synchronous `SuggestionCopyService.generateSync()` method.
 *
 * This mirrors the ExplanationQueueService pattern exactly.
 */
@Injectable()
export class SuggestionCopyQueueService extends BaseAsyncQueueService<
  CopyJobData,
  CopyGenerationResult
> {
  constructor(
    factory: BullmqQueueFactory,
    @Inject(CACHE_MANAGER) cache: Cache,
    private readonly copyService: SuggestionCopyService,
  ) {
    super(QUEUE_NAME, factory, cache, 3, async (job) =>
      this.processJob(
        job,
        (data) => this.copyService.generateViaLlm(data),
        'Suggestion copy generation job failed',
      ),
    );
  }

  async enqueue(data: CopyJobData): Promise<string | null> {
    if (!this.queue) {
      return null;
    }
    const job = await this.queue.add(JOB_NAME, data);
    return job.id ?? null;
  }
}
```

### Phase 3: 重构 `SuggestionCopyService`（读时缓存 + 写时入队）

**修改** `src/modules/today-suggestion/services/copy/copy.service.ts`：

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { SuggestionCopyLlmService } from './copy-llm-generator.service';
import { SuggestionCopyQueueService } from './copy-queue.service';
import { SuggestionCacheService } from '../cache/suggestion-cache.service';
import { getFallbackCopy, validateCopyTemplate } from '../../constants';
import type { CopyJobData, CopyPromptCopy } from '../../types';

export interface CopyGenerationResult {
  title: string;
  reason: string;
  boundary: string;
  actionLabel: string;
  aiGenerated: boolean;
  fromCache: boolean;
}

export interface CopyGenerationRequest {
  templateKey: string;
  params: Record<string, string | number>;
  locale: string;
  tone?: 'gentle' | 'direct' | 'professional';
  // 新增：丰富 LLM 上下文
  suggestionType: SuggestionType;
  confidence: SuggestionConfidence;
  ruleId: string;
  subtype?: string;
  evidence: EvidenceItem[];
  originalTitle: string;
  originalReason: string;
  originalBoundary: string;
}

@Injectable()
export class SuggestionCopyService {
  private readonly logger = new Logger(SuggestionCopyService.name);

  constructor(
    private readonly llmService: SuggestionCopyLlmService,
    private readonly cache: SuggestionCacheService,
    private readonly queue: SuggestionCopyQueueService,
  ) {}

  // ─── 读路径：用户请求时调用 ───

  /**
   * 读路径入口。优先查 Redis cache，命中则返回 AI 文案；
   * 未命中则返回兜底文案，同时向 BullMQ 入队异步生成。
   *
   * 不阻塞用户请求，不直接调用 LLM（Redis 可用时）。
   */
  async getOrEnqueue(
    request: CopyGenerationRequest,
  ): Promise<CopyGenerationResult> {
    const { templateKey, params, locale, tone = 'gentle' } = request;

    // 1. 验证模板
    const validation = validateCopyTemplate(templateKey, params);
    if (!validation.valid) {
      this.logger.warn(
        `Invalid copy template params for ${templateKey}: ${validation.missing?.join(', ') ?? 'unknown'}`,
      );
      return this.getFallbackResult(templateKey, locale);
    }

    // 2. 查 Redis cache
    const cacheKey = this.buildCacheKey(templateKey, params, locale);
    const cached = await this.cache.getCopy(cacheKey);
    if (cached) {
      return {
        title: cached.title,
        reason: cached.reason,
        boundary: cached.boundary,
        actionLabel: cached.actionLabel,
        aiGenerated: true,
        fromCache: true,
      };
    }

    // 3. Cache miss — 入队异步生成（携带完整 context）
    if (this.queue.isConfigured) {
      await this.queue.enqueue({
        templateKey,
        params,
        locale,
        tone,
        suggestionType: request.suggestionType,
        confidence: request.confidence,
        ruleId: request.ruleId,
        ...(request.subtype != null ? { subtype: request.subtype } : {}),
        evidence: request.evidence,
        originalTitle: request.originalTitle,
        originalReason: request.originalReason,
        originalBoundary: request.originalBoundary,
      });
    }

    // 4. 返回兜底文案（Redis 不可用时由调用方决定是否同步调用）
    return this.getFallbackResult(templateKey, locale);
  }

  /**
   * 批量读路径。对每个 candidate 并行调用 getOrEnqueue。
   */
  async getOrEnqueueBatch(
    requests: CopyGenerationRequest[],
  ): Promise<Map<string, CopyGenerationResult>> {
    const results = new Map<string, CopyGenerationResult>();
    await Promise.all(
      requests.map(async (request) => {
        const result = await this.getOrEnqueue(request);
        results.set(request.templateKey, result);
      }),
    );
    return results;
  }

  // ─── 写路径：BullMQ worker 调用 ───

  /**
   * Worker 执行入口。由 BullMQ worker 调用，实际执行 LLM 生成。
   *
   * 包含二次 cache check（并发去重：多个相同 job 只执行一次 LLM 调用）。
   */
  async generateViaLlm(data: CopyJobData): Promise<CopyGenerationResult> {
    const cacheKey = this.buildCacheKey(
      data.templateKey,
      data.params,
      data.locale,
    );

    // 二次 cache check — 并发去重
    const cached = await this.cache.getCopy(cacheKey);
    if (cached) {
      return {
        title: cached.title,
        reason: cached.reason,
        boundary: cached.boundary,
        actionLabel: cached.actionLabel,
        aiGenerated: true,
        fromCache: true,
      };
    }

    // 检查 LLM 是否可用
    if (!this.llmService.hasAnalysisModel()) {
      this.logger.warn('LLM not configured, skipping copy generation');
      return this.getFallbackResult(data.templateKey, data.locale);
    }

    // 调用 LLM 生成（传入完整 context）
    const generated = await this.llmService.generate(
      data, // CopyJobData 即 CopyGenerationContext，包含完整信息
      this.buildPromptCopy(data.tone ?? 'gentle', data.locale),
    );

    // 存入 cache
    await this.cache.setCopy(cacheKey, generated);

    return {
      title: generated.title,
      reason: generated.reason,
      boundary: generated.boundary,
      actionLabel: generated.actionLabel,
      aiGenerated: true,
      fromCache: false,
    };
  }

  // ─── 降级路径：Redis 不可用时同步调用 ───

  /**
   * 同步调用 LLM（Redis 不可用时的降级路径）。
   * 由 SuggestionService 在 queue.isConfigured === false 时调用。
   */
  async generateSync(
    request: CopyGenerationRequest,
  ): Promise<CopyGenerationResult> {
    const { templateKey, params, locale, tone = 'gentle' } = request;

    const validation = validateCopyTemplate(templateKey, params);
    if (!validation.valid) {
      return this.getFallbackResult(templateKey, locale);
    }

    // 仍然先查 cache（可能 Redis 还在但 BullMQ 不可用）
    const cacheKey = this.buildCacheKey(templateKey, params, locale);
    const cached = await this.cache.getCopy(cacheKey);
    if (cached) {
      return { ...cached, aiGenerated: true, fromCache: true };
    }

    if (!this.llmService.hasAnalysisModel()) {
      return this.getFallbackResult(templateKey, locale);
    }

    try {
      const generated = await this.llmService.generate(
        request, // CopyGenerationRequest 即完整 context
        this.buildPromptCopy(tone, locale),
      );
      await this.cache.setCopy(cacheKey, generated);
      return {
        title: generated.title,
        reason: generated.reason,
        boundary: generated.boundary,
        actionLabel: generated.actionLabel,
        aiGenerated: true,
        fromCache: false,
      };
    } catch (error) {
      this.logger.error(
        `Sync copy generation failed for ${templateKey}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return this.getFallbackResult(templateKey, locale);
    }
  }

  /**
   * 批量同步调用（Redis 不可用时的降级路径）。
   */
  async generateSyncBatch(
    requests: CopyGenerationRequest[],
  ): Promise<Map<string, CopyGenerationResult>> {
    const results = new Map<string, CopyGenerationResult>();
    await Promise.all(
      requests.map(async (request) => {
        const result = await this.generateSync(request);
        results.set(request.templateKey, result);
      }),
    );
    return results;
  }

  // ─── 私有方法 ───

  private buildPromptCopy(
    tone: 'gentle' | 'direct' | 'professional',
    locale: string,
  ): CopyPromptCopy {
    const isZh = locale.startsWith('zh');
    return {
      tone,
      userIntro: isZh
        ? '请为以下健康建议卡生成更自然的中文文案。'
        : 'Generate natural copy for the following health suggestion card.',
      constraints: isZh
        ? '只能基于提供的参数生成内容，不得虚构数据。'
        : 'Use ONLY the provided parameters. Do not invent data.',
      factsLabel: 'Suggestion context:',
    };
  }

  private getFallbackResult(
    templateKey: string,
    locale: string,
  ): CopyGenerationResult {
    const fallback = getFallbackCopy(templateKey, locale);
    if (fallback) {
      return {
        title: fallback.title,
        reason: fallback.reason,
        boundary: fallback.boundary,
        actionLabel: fallback.actionLabel,
        aiGenerated: false,
        fromCache: false,
      };
    }
    this.logger.error(`No fallback copy found for template: ${templateKey}`);
    return {
      title: '建议',
      reason: '系统检测到相关健康信号。',
      boundary: '此建议仅供参考，不能替代专业医疗意见。',
      actionLabel: '查看',
      aiGenerated: false,
      fromCache: false,
    };
  }

  private buildCacheKey(
    templateKey: string,
    params: Record<string, string | number>,
    locale: string,
  ): string {
    const sortedParams = Object.entries(params)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${String(v)}`)
      .join('|');
    const keyString = `${templateKey}:${locale}:${sortedParams}`;
    return createHash('sha256').update(keyString).digest('hex').slice(0, 32);
  }
}
```

### Phase 4: 删除原 `CopyGeneratorService`

**删除文件** `src/modules/today-suggestion/services/copy/generator.service.ts`：

该文件直接实例化 `ChatOpenAI`，违反架构规范。其职责由 `SuggestionCopyLlmService`（extends `BaseLlmGeneratorService`）替代。

**修改** `src/modules/today-suggestion/services/copy/index.ts`：

```typescript
export { SuggestionCopyService } from './copy.service';
export type {
  CopyGenerationResult,
  CopyGenerationRequest,
} from './copy.service';
export { SuggestionCopyLlmService } from './copy-llm-generator.service';
export { SuggestionCopyQueueService } from './copy-queue.service';
```

### Phase 5: 修改 `SuggestionService`（改动较小）

**修改** `src/modules/today-suggestion/services/suggestion.service.ts`：

**1. 构造函数注入 `SuggestionCopyQueueService`**：

```typescript
constructor(
  // ... 其他依赖
  private readonly copyService: SuggestionCopyService,
  private readonly copyQueue: SuggestionCopyQueueService,
) {}
```

**2. 构建 copyRequests 时传入完整 candidate 信息**（原来仅传 templateKey + params）：

```typescript
// 原来 (仅 templateKey + params):
const copyRequests: CopyGenerationRequest[] = allCandidates.map((c) => ({
  templateKey: c.copyGeneration.templateKey,
  params: c.copyGeneration.params,
  locale,
  tone: 'gentle',
}));

// 改为 (传入 evidence, confidence, suggestionType 等):
const copyRequests: CopyGenerationRequest[] = allCandidates.map((c) => ({
  templateKey: c.copyGeneration.templateKey,
  params: c.copyGeneration.params,
  locale,
  tone: 'gentle',
  // 新增：丰富 LLM 上下文
  suggestionType: c.type,
  confidence: c.confidence,
  ruleId: c.ruleId,
  ...(c.subtype != null ? { subtype: c.subtype } : {}),
  evidence: c.evidence.map((e) => ({ ...e })),
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- 迁移期间仍读取 legacy 字段
  originalTitle: c.title,
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- 迁移期间仍读取 legacy 字段
  originalReason: c.reason,
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- 迁移期间仍读取 legacy 字段
  originalBoundary: c.boundary,
}));
```

**3. 替换调用方式**（同步阻塞 → 读时缓存 + 异步入队）：

```typescript
// 原来 (同步阻塞):
const copyResults = await this.copyService.generateBatch(copyRequests);

// 改为 (读时缓存 + 异步入队):
const copyResults = this.copyQueue.isConfigured
  ? await this.copyService.getOrEnqueueBatch(copyRequests)
  : await this.copyService.generateSyncBatch(copyRequests);
```

`toDto` 方法**完全不变**——它已经正确处理 `copy` 为 `undefined` 时的兜底逻辑。

### Phase 6: 更新模块配置

**修改** `src/modules/today-suggestion/today-suggestion.module.ts`：

```typescript
// 移除:
import { CopyGeneratorService } from './services/copy/generator.service';

// 新增:
import { SuggestionCopyLlmService } from './services/copy/copy-llm-generator.service';
import { SuggestionCopyQueueService } from './services/copy/copy-queue.service';

@Module({
  imports: [
    // ... 现有 imports (ScheduleModule.forRoot 已在 app.module.ts 注册)
    // BullMQ 基础设施由 QueueModule 提供，需确认是否已导入
  ],
  providers: [
    // ... 现有 providers
    // 移除: CopyGeneratorService
    // 新增:
    SuggestionCopyLlmService,
    SuggestionCopyQueueService,
    // SuggestionCopyService 保留（已存在）
  ],
})
export class TodaySuggestionModule {}
```

### Phase 7: 环境变量配置

**无需新增环境变量**。复用现有 LLM 配置（`language` role）。

### Phase 8: 测试

1. **单元测试**:
   - `SuggestionCopyLlmService` — 继承 `BaseLlmGeneratorService` 的 schema/toolName/modelRole 配置
   - `SuggestionCopyService.getOrEnqueue` — cache hit / cache miss / 入队逻辑（验证完整 context 传递）
   - `SuggestionCopyService.generateViaLlm` — 二次 cache check + LLM 调用 + cache 写入
   - `SuggestionCopyService.generateSync` — 降级路径
   - `SuggestionCopyQueueService` — enqueue / isConfigured
   - `buildCopyUserPrompt` — 验证 evidence、confidence、suggestionType 正确序列化到 prompt

2. **集成测试**:
   - Cache miss → 入队 → worker 生成 → cache 写入 → 下次请求 cache hit
   - Redis 不可用 → 降级同步调用
   - 相同 templateKey+params 的不同用户共享 cache
   - 验证 LLM 收到的 context 包含 evidence/confidence/suggestionType

3. **性能测试**:
   - 用户请求延迟：cache hit < 5ms，cache miss < 10ms（仅 cache 查询 + 兜底返回）
   - Worker 吞吐量：concurrency 3，单 job ~2-5s

---

## 性能对比

| 指标              | 原同步方案                       | 新异步方案 (BullMQ + cache 去重)                            |
| ----------------- | -------------------------------- | ----------------------------------------------------------- |
| 用户请求延迟      | 500-2000ms (LLM 同步调用)        | **< 10ms** (cache 查询 + 兜底返回)                          |
| 首次文案质量      | AI 生成（仅 templateKey+params） | 兜底文案 → 后台几秒内生成 AI 文案（含 evidence/confidence） |
| LLM 上下文丰富度  | templateKey + params             | **evidence + confidence + suggestionType + 原始文案**       |
| LLM 调用成本      | 每次用户请求                     | **相同 templateKey+params 只调 1 次**                       |
| 重试能力          | 无                               | BullMQ 3 次指数退避                                         |
| 进程崩溃恢复      | 无                               | BullMQ 持久化 job                                           |
| Observations 支持 | ✅                               | ✅ (走 cache，不依赖 DB)                                    |
| 降级策略          | 无                               | Redis 不可用时同步调用                                      |

---

## 风险与缓解

| 风险                                     | 影响                     | 缓解措施                                             |
| ---------------------------------------- | ------------------------ | ---------------------------------------------------- |
| LLM 生成失败                             | 始终使用兜底文案         | BullMQ 自动重试 3 次；兜底文案质量已保证             |
| Redis 重启丢失 cache                     | 文案暂时回退为兜底       | 下次请求重新入队生成；可选 DB 持久化（Phase 6 可选） |
| 首次请求看到兜底文案                     | 用户体验略差             | Worker 几秒内完成；前端可延迟 re-fetch               |
| 建议结果缓存 (3min) 导致 AI 文案延迟可见 | 用户在缓存过期前看到兜底 | 前端可在 `aiGenerated: false` 的卡片上延迟 re-fetch  |
| 并发入队相同 job                         | 重复 LLM 调用            | Worker 内二次 cache check 去重                       |

---

## 关于"闪烁"问题

本方案无法完全消除首次请求的兜底→AI 文案切换（任何异步方案都无法完全避免）。但相比 cron 轮询方案，BullMQ worker 通常在**几秒内**完成生成，下次请求（建议结果缓存 3 分钟过期后）即可获得 AI 文案。

进一步消除闪烁可考虑前端方案（不在本次后端重构范围内）：

- 客户端在 `aiGenerated: false` 的卡片上延迟 3~5 秒后静默 re-fetch
- 或像 explanation 一样暴露 `GET /suggestions/:id/copy` 端点，客户端按需轮询

---

## 文档更新

- [ ] `Lucent/docs/Today_Suggestion_Engine.md` — 更新 copy generation 架构图和流程
- [ ] `Lucent/docs/0X-logs/migration-log/2026-07-22.md` — 记录变更

---

## 回滚方案

如需回滚：

1. 恢复 `CopyGeneratorService`（从 git 历史恢复）
2. 恢复 `SuggestionService` 中的 `copyService.generateBatch` 调用
3. 恢复 `today-suggestion.module.ts` 中的 provider 注册
4. 删除新建的 `SuggestionCopyLlmService` 和 `SuggestionCopyQueueService`
5. 无 DB schema 变更需要回滚

---

## 后续优化 (可选)

1. **DB 持久化兜底**: 加 `generatedCopy Json?` 列，worker 生成后同时写 cache + DB，Redis 重启后可从 DB 恢复
2. **System prompt 按 suggestionType 分化**: 不同建议类型使用不同语气策略（如 `confirmed_risk` 用更严肃语气，`behavior_advice` 用更鼓励语气）
3. **文案版本控制**: 记录文案历史，支持 A/B 测试
4. **智能刷新**: 根据用户反馈自动触发文案重新生成
5. **批量预生成**: 基于预测模型，提前生成可能需要的文案
6. **多语言优化**: 根据用户 locale 选择不同生成策略
