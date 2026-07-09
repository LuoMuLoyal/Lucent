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

## AI 解释层

按需为复杂建议卡生成 AI 增强的 `reason` 和 `boundary` 自然语言变体。

- 设计原则：规则优先，AI 仅解释 — 不创建或覆盖建议，只生成更自然的文案
- 所有 LLM 输出必须基于 `evidence[]`，禁止生成 evidence 之外的内容
- 所有 LLM 输出经过 `LlmSafetyPolicyService` 安全检查（禁止诊断/处方/停药等表述）
- 不阻塞首屏：前端先拿到规则生成的卡片，AI 解释按需加载
- 模型未配置或调用失败时，回退到规则原始文案
- 继承 `BaseLlmGeneratorService`，使用 `language` 角色模型，结构化输出 (Zod schema)

## 数据库表

- `user_suggestions` — 建议持久化
- `user_suggestion_baselines` — 冷启动基线
- `user_suggestion_feedbacks` — 反馈记录

## 缓存策略

三层 Redis 缓存，减少重复计算开销：

| 缓存层       | Key 格式                                                    | TTL    | 失效条件                  |
| ------------ | ----------------------------------------------------------- | ------ | ------------------------- |
| 信号缓存     | `today_suggestion:signals:{userId}:{date}`                  | 5 分钟 | 新记录/剂量日志创建时失效 |
| 建议结果缓存 | `today_suggestion:suggestions:{userId}:{date}:{excludeKey}` | 3 分钟 | 用户提交反馈时失效        |
| 基线状态缓存 | `today_suggestion:baseline:{userId}`                        | 1 小时 | 新基线建立时失效          |

- 使用全局 `CacheModule`（Keyv + Redis），与 `MedicinesCacheService` 模式一致
- `SuggestionCacheService` 封装 get/set/invalidate 操作
- `buildExcludeKey()` 确保不同 excludeIds 组合生成不同缓存 key

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
