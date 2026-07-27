# Today Suggestion Engine

## 概述

后端主动建议引擎，替代前端硬编码的 Today 页建议卡逻辑。按 `Product_Insights` 支持 5 类卡片，具备双触发链、冷启动基线、卡片生命周期、反馈驱动抑制。

## 架构

```
信号采集层 (Collectors)
    ↓
规则引擎 (Rules → Registry)
    ↓
反馈抑制 (Suppression)
    ↓
仲裁器 (Arbitration + Scoring)
    ↓
生命周期管理 (Lifecycle + Baseline)
    ↓
通知升级 (Escalation)
    ↓
DTO 映射 → API 响应
    ↓
AI 解释层 (Explanation, 按需调用, 不阻塞首屏)
```

## API 端点

- `GET /user/today/suggestions` — 获取今日建议卡
  - Query: `date` (可选, YYYY-MM-DD), `excludeIds` (可选, 已 dismiss 的建议 ID)
  - Response: `{ primary, secondary[], observations[] }`
- `POST /user/today/suggestions/:id/feedback` — 提交建议卡反馈
  - Body: `{ feedback: 'accepted' | 'later' | 'not_applicable' | 'suppress' }`
  - Response: `{ suggestionId, feedback, appliedEffect, expiresAt? }`
- `POST /user/today/suggestions/:id/explain` — 获取 AI 增强解释
  - Header: `Accept-Language` (可选, 用于本地化)
  - Response: `{ suggestionId, reason, boundary, aiGenerated }`
  - 不阻塞首屏：规则引擎先返回结构化卡片，前端按需请求 AI 解释
- `GET /user/today/suggestions/history` — 获取建议历史（供 Report 页回顾区）
  - Query: `startDate` (可选, 默认 30 天前), `endDate` (可选, 默认今天), `lifecycleState` (可选), `type` (可选), `limit` (可选, 默认 100, 最大 500)
  - Response: `{ items[], total, startDate, endDate }`

## 模块位置

- `src/modules/today-suggestion/`

## 卡片类型

| 类型   | 枚举值            | 规则                                                                                             | 说明                                          |
| ------ | ----------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| 依从卡 | `compliance`      | `missed_dose_pending`                                                                            | 到时未确认用药                                |
| 行为卡 | `behavior_advice` | `water_behind_target`, `sleep_shortfall`, `caffeine_sleep_correlation`, `mood_sleep_correlation` | 饮水/睡眠不足, 咖啡因-睡眠关联, 情绪-睡眠关联 |
| 趋势卡 | `trend`           | `deteriorating_symptom`                                                                          | 症状恶化趋势                                  |
| 说明卡 | `coverage`        | `coverage_explanation`                                                                           | 档案不完整/今日无记录                         |
| 风险卡 | `confirmed_risk`  | （Phase 3+）                                                                                     | 明确规则风险                                  |

## 冷启动基线

- 维度: water_intake, sleep_duration, symptom_severity, mood, caffeine_intake, medication_adherence
- 最少连续记录天数: 3 天
- 基线建立前，behavior/trend 类规则不出卡

## 反馈驱动抑制

用户反馈真实影响后续出卡：

| 反馈类型         | 效果               | 持续时间 | 例外                     |
| ---------------- | ------------------ | -------- | ------------------------ |
| `accepted`       | 同类卡 +10% 积极度 | 永久     | 无                       |
| `later`          | 同规则卡延后       | 4 小时   | 严重度升级则立即重新出现 |
| `not_applicable` | 同类卡降权 -30%    | 7 天     | 更高严重度证据则恢复     |
| `suppress`       | 同类卡强抑制       | 30 天    | 更高严重度新证据则恢复   |

## 通知升级

高优先级事件触发卡自动升级为通知：

- 条件：`notificationEligible` + `triggerType=event` + `confidence=high` + `priorityScore>=700`
- 去重：按 `(suggestionType, date)` 去重，避免通知轰炸
- 使用 `NotificationsService.createOrReplaceScoped()` 发送
- 操作顺序：使用原子条件 `updateMany({ where: { id, notificationSentAt: null } })` 抢占通知槽位（`count=0` 表示已被其他并发请求处理，直接跳过），成功后再发送通知。如果通知发送失败，建议已标记为已通知，防止重复发送
- **双通道投递**：站内通知后，额外调用 `PushDeliveryService.sendToUser()` 向已注册设备
  发送推送通知（best-effort，未配置 FCM/APNs 时为 no-op stub）。`EscalationService` 内部用户查询已迁移到 `prisma.nonDeleted` API。

## 生命周期定时刷新

建议卡状态不再仅依赖用户请求触发，`@Cron` 定时任务每 5 分钟自动刷新：

| 转换             | 条件                       | 常量                                                            |
| ---------------- | -------------------------- | --------------------------------------------------------------- |
| ACTIVE → FADING  | `activatedAt` 超过 8 小时  | `SUGGESTION_ACTIVE_DURATION_MS`                                 |
| FADING → EXPIRED | `activatedAt` 超过 12 小时 | `SUGGESTION_ACTIVE_DURATION_MS + SUGGESTION_FADING_DURATION_MS` |

- 常量定义在 `constants/lifecycle.constants.ts`
- `LifecycleService.refreshLifecycleStates()` 由 `@nestjs/schedule` 的 `@Cron` 装饰器驱动

## 安全与运维

### API 限流

全局 `ThrottlerGuard`（100 req/min），建议引擎端点额外配置：

| 端点                                   | 限流                      |
| -------------------------------------- | ------------------------- |
| `POST /today/suggestions/:id/feedback` | 20 次/分钟                |
| `POST /today/suggestions/:id/explain`  | 5 次/分钟（LLM 成本控制） |

### 反馈事务

`FeedbackService.recordFeedback` 中的「创建反馈记录 + 更新建议状态」包裹在 `prisma.$transaction` 中，确保原子性。

## AI 解释层

按需为复杂建议卡生成 AI 增强的 `reason` 和 `boundary` 自然语言变体。

- 设计原则：规则优先，AI 仅解释 — 不创建或覆盖建议，只生成更自然的文案
- 所有 LLM 输出必须基于 `evidence[]`，禁止生成 evidence 之外的内容
- 所有 LLM 输出经过 `LlmSafetyPolicyService` 安全检查（禁止诊断/处方/停药等表述）
- 不阻塞首屏：前端先拿到规则生成的卡片，AI 解释按需加载
- 模型未配置或调用失败时，回退到持久化的 AI/兜底文案
- 继承 `BaseLlmGeneratorService`，使用 `language` 角色模型，结构化输出 (Zod schema)

## 数据库表

- `user_suggestions` — 建议持久化
- `user_suggestion_baselines` — 冷启动基线
- `user_suggestion_feedbacks` — 反馈记录

## 缓存策略

三层 Redis 缓存，减少重复计算开销：

| 缓存层       | Key 格式                                                    | TTL    | 失效条件                                                                     |
| ------------ | ----------------------------------------------------------- | ------ | ---------------------------------------------------------------------------- |
| 信号缓存     | `today_suggestion:signals:{userId}:{date}`                  | 5 分钟 | domain event 触发（record/dose-log/reminder/health-context/settings 写路径） |
| 建议结果缓存 | `today_suggestion:suggestions:{userId}:{date}:{excludeKey}` | 3 分钟 | domain event 触发或用户提交反馈时失效（清除所有 excludeKey 变体）            |
| 基线状态缓存 | `today_suggestion:baseline:{userId}`                        | 1 小时 | reminder/health-context/settings 写路径 domain event 触发                    |

- 使用全局 `CacheModule`（Keyv + Redis），与 `MedicinesCacheService` 模式一致
- `SuggestionCacheService` 封装 get/set/invalidate 操作
- `SuggestionCacheInvalidationListener` 通过 `@OnEvent` 订阅 5 个 domain event（`DAILY_RECORD_CHANGED` / `DOSE_LOG_CHANGED` / `REMINDER_CHANGED` / `HEALTH_CONTEXT_CHANGED` / `SETTINGS_CHANGED`），触发缓存失效，资源模块不再反向依赖聚合层
- `buildExcludeKey()` 确保不同 excludeIds 组合生成不同缓存 key
- 缓存失效通过 excludeKeys registry 追踪所有已使用的 excludeKey 变体，确保 `invalidateSignals` / `invalidateSuggestions` 能清除所有缓存条目而非仅 `none` 变体

## 反馈数据驱动 threshold 调整

在静态反馈抑制之上，新增动态 score 倍率调整：

- `FeedbackStatsService` 统计每条规则过去 30 天的反馈数据（accept/suppress 比率）
- 最小样本量 5 条反馈后开始生效
- 高 accept 率（≥50%）→ score 倍率上浮（最高 1.5x）
- 高 suppress 率（≥50%）→ score 倍率下降（最低 0.5x）
- 样本不足或比率均衡时倍率 = 1.0（无影响）
- 在 `SuppressionService.filterAndAdjust` 中应用：静态反馈调整 → 动态倍率调整

## A/B 规则版本

支持同一规则注册多个版本，按用户哈希分流：

- `RuleVersionRegistry`：注册/选择规则版本
- `setDistribution(ruleId, ratio)`：设置新版本流量比例（0–1）
- `forceVersion(ruleId, version)`：强制全量使用指定版本（覆盖分布）
- `selectVersion(ruleId, userId)`：基于 FNV-1a 哈希确定性选择，同一用户始终看到同一版本
- 当前所有规则为单版本注册，架构已就绪供后续 A/B 测试使用

## 实现状态

- [x] Phase 1: 规则引擎骨架 + missed-dose + water-shortfall
- [x] Phase 2: 5 类卡片 + 冷启动基线 + 生命周期 + sleep/trend/coverage 规则
- [x] Phase 3: 反馈驱动抑制 + 通知升级
- [x] Phase 4: AI 解释层（信号组合规则在 Phase 5 实现）
- [x] Phase 5: 信号组合（caffeine-sleep 关联规则）+ 历史回顾 API
- [x] Phase 6: 缓存策略 + 反馈驱动 threshold 调整 + A/B 规则版本 + mood-sleep 信号组合规则
- [x] 审查修复: 反馈事务 + 生命周期定时刷新 + 通知顺序 + API 限流 + 类型安全

## 前端接入状态

- [x] Phase 1: OpenAPI 导出 + Flutter API 客户端生成 + 网络层注册
- [x] Phase 2: Domain 实体层 + Remote Data Source + Repository 清理
- [x] Phase 3: Riverpod Provider + UI 重构（主卡/次卡/观察项）
- [x] Phase 4: 反馈按钮接入 + AI 解释按需加载
- [x] Phase 5: 深层链接导航（`_openRoute` → `primaryAction.route`）
- [ ] Phase 5 剩余: Report 页历史建议回顾接入 `GET /today/suggestions/history`（data source 已就绪，无 UI 消费；Report 页当前使用通知接口替代）

## 2026-07-22 路由修复

- `coverage.service.ts` 的 `primaryAction.route` 从 `/mine/health-context` 改为 `/mine/profile/edit`，修复前端点击"去完善"按钮时路由不存在的问题。前端已存在 `/mine/profile/edit` 页面（ProfileEditPage），功能与"完善健康档案"一致。

## 2026-07-22 i18n 硬编码清理

- 规则服务中的 evidence `label` 和 action `label` 从硬编码中文字符串改为 locale-neutral 的 i18n key（如 `current_count`、`go_record`）
- `SuggestionService.toDto()` 注入 `I18nService`，在 DTO 映射时按 `Accept-Language` 本地化 evidence label、enum value 和 action label
- 最终兜底文案从 `suggestion.service.ts` 和 `copy.service.ts` 中的硬编码中文改为 i18n 调用（`today-suggestion.fallback.*`）
- LLM Prompt 指令文案从 `isZh` 三元分支改为 i18n 调用（`today-suggestion.prompt.*`）
- System Prompt 中的中文词汇示例替换为英文等价描述，消除语言偏置
- `copy-llm-generator.service.ts` 中硬编码的 `locale: 'zh-CN'` 移除，system prompt 不再依赖 locale
- 翻译文件位于 `src/i18n/zh-CN/today-suggestion.json` 和 `src/i18n/en/today-suggestion.json`

## AI 文案生成层

为建议卡异步生成 AI 驱动的 `title`, `reason`, `boundary`, `actionLabel` 文案。

### 架构

```
用户请求 GET /suggestions
    ↓
SuggestionCopyService.getOrEnqueue(queue)
    ↓ 查 Redis cache
    ├─ HIT → 返回 AI 文案（无 LLM 调用）
    └─ MISS → 返回兜底文案 + 入队 BullMQ
                    ↓ [后台异步]
              SuggestionCopyQueueService (BullMQ Worker, concurrency: 3)
                    ↓ 二次 cache check（并发去重）
                    ↓ SuggestionCopyLlmService.generate()（BaseLlmGeneratorService）
                    ↓ 存入 Redis cache（TTL 1h）
```

### 设计原则

- **读时优先缓存**：用户请求时先查 Redis cache，命中则直接返回 AI 文案
- **Cache miss 返回兜底 + 入队**：未命中时返回兜底文案，同时向 BullMQ 队列入队异步生成
- **Worker 写回缓存**：BullMQ worker 调用 LLM 生成后写入 Redis cache（按 templateKey+params+locale hash，1h TTL）
- **Redis 不可用时降级**：同步调用 LLM（与 `ExplanationQueueService` 同一降级模式）
- **无循环依赖**：`SuggestionCopyService` 不构造函数注入 `SuggestionCopyQueueService`，而是由 `SuggestionService` 在调用 `getOrEnqueueBatch()` 时将 queue 作为方法参数传入（`CopyQueueLike` 接口），与 `ExplanationService` 模式一致
- **跨用户去重**：相同 templateKey+params+locale 的请求共享同一 cache 条目
- LLM 上下文丰富：传入 evidence、confidence、suggestionType 等信息，使生成的文案更有依据
- 继承 `BaseLlmGeneratorService`，使用 `language` 角色模型，结构化输出 (Zod schema)
- 模型未配置或调用失败时，回退到预写兜底文案
- 规则不再生成硬编码文案（`title`/`reason`/`boundary` 已从 `SuggestionCandidate` 中删除）
- `persistActive` 将 AI/兜底文案写入 DB `title`/`reason`/`boundary` 列，历史接口直接读取
- 通知升级使用 AI/兜底文案作为标题和内容

### 核心组件

| 组件                       | 文件                                          | 职责                                             |
| -------------------------- | --------------------------------------------- | ------------------------------------------------ |
| SuggestionCopyLlmService   | `services/copy/copy-llm-generator.service.ts` | LLM 生成器（extends BaseLlmGeneratorService）    |
| SuggestionCopyQueueService | `services/copy/copy-queue.service.ts`         | BullMQ 异步队列（extends BaseAsyncQueueService） |
| SuggestionCopyService      | `services/copy/copy.service.ts`               | 编排缓存查询、入队、降级逻辑                     |
| Copy Templates             | `constants/copy-templates.ts`                 | 定义模板参数规范                                 |
| Copy Fallback              | `constants/copy-fallback.ts`                  | 多语言兜底文案                                   |
| Copy Prompts               | `prompts/copy.prompt.ts`                      | LLM 提示词工程                                   |
| Copy Schema                | `schemas/copy.schema.ts`                      | 结构化输出校验                                   |

### 文案生成流程

1. **读路径**（用户请求）：`SuggestionCopyService.getOrEnqueue()` 按以下优先级获取文案：
   - 缓存命中 → 直接返回 AI 文案
   - 缓存未命中 → 返回兜底文案 + 入队 BullMQ 异步生成
2. **写路径**（BullMQ Worker）：`SuggestionCopyService.generateViaLlm()`：
   - 二次 cache check（并发去重）
   - 调用 LLM → 解析结构化输出 → 写入缓存
   - LLM 失败 → BullMQ 自动重试（3 次指数退避）
3. **降级路径**（Redis 不可用）：`SuggestionCopyService.generateSync()`：
   - 同步调用 LLM → 写入缓存
   - LLM 失败 → 返回兜底文案
4. **兜底策略**：兜底文案支持 `zh-CN` 和 `en-US`，按 `Accept-Language` 匹配

### 缓存策略

- Key: `today_suggestion:copy:{hash(templateKey+params+locale)}`
- TTL: 1 小时（文案不常变化）
- Cache key 不包含 evidence 等上下文字段（evidence 由 rule+params 确定性生成，不影响去重）
- Cache key 不包含 userId（跨用户共享）。这是有意设计——copy 文案仅来源于规则逻辑（evidence 值、建议类型等），不包含用户敏感信息。`buildCacheKey()` 方法注释中明确禁止在 params 中传入 userId 等用户敏感数据

### 配置项

复用现有 LLM 配置（`language` role），无需额外环境变量。
