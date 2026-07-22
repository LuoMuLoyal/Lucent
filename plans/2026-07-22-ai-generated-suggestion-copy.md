# AI 生成建议卡文案改造计划

## 背景

当前 Today Suggestion 规则引擎（`src/modules/today-suggestion/services/rules/*.service.ts`）直接硬编码中文文案返回给前端，导致：

1. 国际化缺失（仅支持中文）
2. 文案风格不一致（规则文案机械 vs AI 解释层文案自然）
3. 与产品设计不符（Product_AI_Design.md 要求 AI 生成提醒文案）

## 目标

将建议卡文案生成从"规则硬编码"改为"AI 动态生成"，支持多语言、风格统一、符合产品设计。

## 架构变更

### 当前流程

```
信号采集 → 规则引擎（返回完整中文文案）→ API 响应 → 前端展示
                ↓
        用户点击"AI 解释" → AI 润色（可选）
```

### 目标流程

```
信号采集 → 规则引擎（返回结构化信号 + 参数）→ AI 文案生成层 → API 响应 → 前端展示
                ↓                                    ↑
        规则只负责触发逻辑                    根据 Accept-Language 生成对应语言
```

## 实施步骤

### Phase 1: 规则引擎简化（Day 1-2）

**目标**：移除规则服务中的硬编码文案，改为返回结构化数据

**文件清单**：

- `src/modules/today-suggestion/services/rules/coverage.service.ts`
- `src/modules/today-suggestion/services/rules/missed-dose.service.ts`
- `src/modules/today-suggestion/services/rules/water-shortfall.service.ts`
- `src/modules/today-suggestion/services/rules/sleep-shortfall.service.ts`
- `src/modules/today-suggestion/services/rules/mood-sleep.service.ts`
- `src/modules/today-suggestion/services/rules/deteriorating-trend.service.ts`
- `src/modules/today-suggestion/services/rules/caffeine-sleep.service.ts`

**变更内容**：

1. **SuggestionCandidate 接口扩展**：

```typescript
// 新增字段
interface SuggestionCandidate {
  // ... 原有字段

  // 新增：文案生成模板 key
  copyTemplateKey: string;

  // 新增：文案生成参数（动态数据）
  copyParams: Record<string, string | number>;

  // 移除：不再由规则返回
  // title: string;  → 由 AI 生成
  // reason: string; → 由 AI 生成
  // boundary: string; → 由 AI 生成
}
```

2. **规则服务改造示例**（以 coverage.service.ts 为例）：

```typescript
// Before
return {
  candidateId: randomUUID(),
  // ...
  title: '健康档案信息不完整',
  reason: `缺少 ${missingLabels.join('、')}，完善后可获得更准确的建议。`,
  boundary: '完善档案有助于提供更准确的个性化建议。',
  // ...
};

// After
return {
  candidateId: randomUUID(),
  // ...
  copyTemplateKey: 'coverage.profile.incomplete',
  copyParams: {
    missingFields: missingLabels.join('、'),
    fieldCount: missingFields.length,
  },
  // ...
};
```

### Phase 2: AI 文案生成层（Day 3-5）

**目标**：新建 `SuggestionCopyService`，负责根据模板 key 和参数生成多语言文案

**新建文件**：

- `src/modules/today-suggestion/services/copy/copy.service.ts` - 文案生成主服务
- `src/modules/today-suggestion/services/copy/generator.service.ts` - LLM 生成器
- `src/modules/today-suggestion/prompts/copy.prompt.ts` - 提示词模板
- `src/modules/today-suggestion/schemas/copy.schema.ts` - 结构化输出 schema
- `src/modules/today-suggestion/constants/copy-templates.ts` - 模板定义

**实现细节**：

1. **CopyService 接口**：

```typescript
@Injectable()
export class SuggestionCopyService {
  constructor(
    private readonly generatorService: CopyGeneratorService,
    private readonly cacheService: SuggestionCacheService,
  ) {}

  async generate(
    templateKey: string,
    params: Record<string, string | number>,
    options: {
      locale: string; // 'zh-CN' | 'en-US' | ...
      tone?: 'gentle' | 'direct'; // 语气风格
    },
  ): Promise<{
    title: string;
    reason: string;
    boundary: string;
    actionLabel: string;
    aiGenerated: boolean;
  }> {
    // 1. 检查缓存（templateKey + params hash + locale）
    // 2. 命中缓存直接返回
    // 3. 未命中调用 LLM 生成
    // 4. 写入缓存（TTL 1小时）
  }
}
```

2. **提示词设计**：

```typescript
// prompts/copy.prompt.ts
export function buildCopySystemPrompt(): string {
  return `You are a health assistant copywriter. Generate suggestion card copy based on the provided template key and parameters.

Rules:
1. Generate in the user's preferred language (locale)
2. Tone should be gentle, objective, never absolute
3. Title: max 20 characters, action-oriented
4. Reason: 1-2 sentences explaining why
5. Boundary: 1 sentence clarifying limitations
6. ActionLabel: max 6 characters, verb-first

Templates:
- coverage.profile.incomplete: User profile missing fields
- missed.dose.pending: Medicine reminder overdue
- water.behind.target: Water intake below target
- sleep.shortfall: Sleep duration insufficient
- ... (其他模板定义)`;
}
```

3. **模板定义**：

```typescript
// constants/copy-templates.ts
export const COPY_TEMPLATES: Record<
  string,
  {
    description: string;
    requiredParams: string[];
    optionalParams?: string[];
  }
> = {
  'coverage.profile.incomplete': {
    description: 'Profile completeness coverage card',
    requiredParams: ['missingFields', 'fieldCount'],
  },
  'missed.dose.pending': {
    description: 'Overdue medication reminder',
    requiredParams: ['medicineName', 'timeLabel', 'hoursOverdue'],
  },
  // ...
};
```

### Phase 3: 集成到建议生成流程（Day 6-7）

**目标**：在 `SuggestionService.generate()` 中调用 AI 文案生成

**修改文件**：

- `src/modules/today-suggestion/services/suggestion.service.ts`

**变更内容**：

```typescript
@Injectable()
export class SuggestionService {
  constructor(
    // ... 原有依赖
    private readonly copyService: SuggestionCopyService,
  ) {}

  async generate(
    userId: string,
    date?: string,
    excludeIds?: string[],
    options?: {
      locale?: string; // 从请求头传入
    },
  ): Promise<TodaySuggestionsDataDto> {
    // ... 原有流程获取 candidates

    // 新增：为每个 candidate 生成文案
    const itemsWithCopy = await Promise.all(
      candidates.map(async (candidate) => {
        const copy = await this.copyService.generate(
          candidate.copyTemplateKey,
          candidate.copyParams,
          {
            locale: options?.locale ?? 'zh-CN',
            tone: 'gentle',
          },
        );

        return {
          ...candidate,
          title: copy.title,
          reason: copy.reason,
          boundary: copy.boundary,
          primaryAction: {
            ...candidate.primaryAction,
            label: copy.actionLabel,
          },
          aiGenerated: copy.aiGenerated,
        };
      }),
    );

    // ... 后续流程
  }
}
```

### Phase 4: API 层适配（Day 8）

**目标**：Controller 接收 `Accept-Language` 并传递给 Service

**修改文件**：

- `src/modules/today-suggestion/today-suggestion.controller.ts`

**变更内容**：

```typescript
@Get()
@ApiOperation({ summary: 'Get today suggestions' })
async getSuggestions(
  @CurrentUser() user: CurrentUserDto,
  @Query() query: SuggestionQueryDto,
  @Headers('accept-language') acceptLanguage?: string,  // 新增
): Promise<Envelope<TodaySuggestionsDataDto>> {
  const data = await this.suggestionService.generate(
    user.userId,
    query.date,
    query.excludeIds,
    { locale: acceptLanguage },
  );
  return successEnvelope(data);
}
```

### Phase 5: 降级策略与缓存（Day 9-10）

**目标**：确保 AI 服务不可用时仍有文案可用

**实现**：

1. **硬编码兜底文案**（多语言）：

```typescript
// constants/copy-fallback.ts
export const COPY_FALLBACK: Record<
  string,
  Record<
    string,
    {
      title: string;
      reason: string;
      boundary: string;
    }
  >
> = {
  'coverage.profile.incomplete': {
    'zh-CN': {
      title: '健康档案信息不完整',
      reason: '完善档案后可获得更准确的建议。',
      boundary: '完善档案有助于提供更准确的个性化建议。',
    },
    'en-US': {
      title: 'Health profile incomplete',
      reason: 'Complete your profile for more accurate suggestions.',
      boundary: 'A complete profile helps us provide personalized guidance.',
    },
  },
  // ...
};
```

2. **CopyService 降级逻辑**：

```typescript
async generate(...) {
  try {
    // 尝试 AI 生成
    return await this.generateWithAI(...);
  } catch (error) {
    this.logger.warn('AI copy generation failed, using fallback', error);
    // 降级到硬编码多语言文案
    return this.getFallbackCopy(templateKey, options.locale);
  }
}
```

3. **Redis 缓存**：

- Key: `suggestion:copy:{templateKey}:{paramsHash}:{locale}`
- TTL: 1 小时（文案不常变化）
- 缓存 AI 生成结果，减少 LLM 调用成本

### Phase 6: 测试与验证（Day 11-12）

**单元测试**：

- `copy.service.spec.ts` - 测试生成逻辑、降级策略
- `generator.service.spec.ts` - 测试 LLM 调用
- 更新规则服务测试 - 验证只返回结构化数据

**集成测试**：

- `today-suggestion.e2e-spec.ts` - 验证完整流程
- 测试不同 locale 返回对应语言
- 测试 AI 失败时降级正常

**验证清单**：

- [ ] 中文环境返回中文文案
- [ ] 英文环境返回英文文案
- [ ] AI 服务关闭时返回兜底文案
- [ ] 缓存命中时不再调用 LLM
- [ ] 文案风格统一、语气温和

## 数据结构变更

### SuggestionItemDto（API 响应）

```typescript
// 新增字段
interface SuggestionItemDto {
  // ... 原有字段

  /** 文案是否由 AI 生成 */
  aiGenerated: boolean;

  /** 文案生成使用的模板 key */
  copyTemplateKey: string;

  /** 文案生成参数（调试用） */
  copyParams?: Record<string, unknown>;
}
```

## 性能考虑

1. **并发生成**：使用 `Promise.all` 并行生成多个建议卡的文案
2. **缓存策略**：Redis 缓存 1 小时，相同参数直接返回
3. **流式响应**：首屏建议卡文案预生成，不阻塞 API 响应
4. **LLM 成本**：缓存命中率预计 >80%（用户每天看到的建议类型有限）

## 回滚方案

如 AI 生成效果不佳，可快速回滚到 Phase 1 之前的版本：

1. 恢复规则服务中的硬编码文案
2. 移除 `copyService.generate()` 调用
3. 保留 `aiGenerated: false` 标记

## 相关文档更新

- [ ] `docs/00-current/Today_Suggestion_Engine.md` - 更新架构图和流程说明
- [ ] `docs/01-product/Product_AI_Design.md` - 确认实现符合产品设计
- [ ] `docs/openapi.json` - 更新 API 响应字段（自动导出）

## 依赖

- LLM Runtime 服务需支持 `language` 角色模型
- Redis 缓存服务（已存在）
- 多语言兜底文案需产品/设计确认

## 风险

| 风险                      | 概率 | 影响 | 缓解措施                             |
| ------------------------- | ---- | ---- | ------------------------------------ |
| AI 生成文案质量不稳定     | 中   | 高   | 兜底文案 + 人工审核流程              |
| LLM 调用延迟影响 API 响应 | 低   | 中   | 缓存 + 异步预生成                    |
| 多语言覆盖不全            | 中   | 中   | 先支持 zh-CN/en-US，其他语言逐步添加 |
| 成本超支                  | 低   | 低   | 缓存策略 + 用量监控                  |
