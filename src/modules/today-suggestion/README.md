# today-suggestion

Lucent 第二大 feature module（75+ files, 44+ providers）。主动建议引擎——
从用户健康数据中提取信号，通过规则引擎生成建议候选，经仲裁/抑制/反馈后
物化为持久化的建议卡片，并在满足条件时升级为推送通知。

## Pipeline 概览

```
Collectors → Rule Engine → Suppression → Arbitration → Lifecycle → Notification
    ↑                                                                  ↓
    └──── Domain Events (cache invalidation + recompute trigger) ───────┘
```

1. **Collectors** — 从 4 个数据源收集 `SuggestionSignal`：
   - `MedicationCollectorService` — 服药记录、提醒状态
   - `RecordCollectorService` — 日报记录（睡眠/饮水/情绪/体征/活动）
   - `ProfileCollectorService` — 用户健康档案
   - `HealthEventCollectorService` — 健康事件（症状/检查）

2. **Rule Engine** (`RegistryService`) — 8 条规则，每条实现 `SuggestionRule` 接口，
   在 `onModuleInit` 时注册到 registry。规则按 `SignalSource` 分类组织：

   | 子目录              | 规则                                                                            | 触发条件                  |
   | ------------------- | ------------------------------------------------------------------------------- | ------------------------- |
   | `rules/medication/` | `MissedDoseRuleService`, `CoverageRuleService`                                  | 漏服、覆盖不足            |
   | `rules/lifestyle/`  | `WaterShortfallRuleService`, `DeterioratingTrendRuleService`                    | 饮水不足、趋势恶化        |
   | `rules/sleep/`      | `SleepShortfallRuleService`, `CaffeineSleepRuleService`, `MoodSleepRuleService` | 睡眠不足、咖啡因/情绪影响 |
   | `rules/health/`     | `EventCheckInTrendRuleService`                                                  | 健康事件签到趋势          |

   每条规则返回 `SuggestionCandidate` 或 `null`。规则抛异常时 pipeline 标记 `degraded=true`。

3. **Suppression** (`SuppressionService`) — 基于用户反馈（`SUPPRESS`）过滤候选，
   调整候选优先级。

4. **Arbitration** (`ArbitrationService` + `ScoringService`) — 对候选打分、排序、
   截断为 primary / secondary / observations 三层。

5. **Lifecycle** (`LifecycleService` + `BaselineService`) — 持久化建议卡片到 DB，
   管理 `generated → active → fading → expired` 生命周期状态转换。
   `BaselineService` 判断用户是否已建立足够基线数据。

6. **Notification** (`EscalationService`) — 满足条件时（`notificationEligible && EVENT
trigger && high confidence && priorityScore >= 700`）通过 `INotificationSender`
   port 接口发送推送，使用 `createOrReplaceScoped` 去重。

## Materialization & Recompute

建议引擎采用 **write-time materialization** 模式——不是在 GET 请求时实时计算，
而是在数据变更时异步重算并物化结果。

- **MaterializationStore** (`materialization/store.service.ts`) — 管理版本化的
  物化状态行（`UserSuggestionMaterialization` 表），包含 `sourceVersion`（数据变更版本）
  和 `computedVersion`（计算完成版本）。`sourceVersion > computedVersion` 表示 stale。
- **RecomputeTriggerListener** (`recompute/trigger.listener.ts`) — 监听 6 个 domain
  events，标记 pending 并 enqueue recompute job。详见
  [event-catalog](../../../docs/01-reference/event-catalog.md)。
- **RecomputeQueueService** (`recompute/queue.service.ts`) — BullMQ direct queue，
  debounced enqueue 防止短时间多次触发。
- **SuggestionRecomputeWorkerService** (`recompute/worker.service.ts`) — Worker 消费
  recompute job，调用 `SuggestionService.recompute()` 并写回物化结果。
  支持 version follow-up（最多 3 次）处理并发版本冲突。

## Cache Layer

- **SuggestionCacheService** (`cache/suggestion-cache.service.ts`) — 两层缓存：
  - Signal cache — 缓存 collector 采集的信号（避免重复 DB 查询）
  - Baseline cache — 缓存基线状态
- **SuggestionCacheInvalidationListener** (`cache/suggestion-cache-invalidation.listener.ts`)
  — 监听 6 个 domain events，失效对应缓存。连续失败 3 次升级为 error 级别日志。

## AI Copy & Explanation

- **Copy Generation** (`copy/`) — `SuggestionCopyLlmService` + `SuggestionCopyQueueService`
  (BullMQ BaseAsync, concurrency=3) — AI 生成建议卡片文案（title/reason/boundary）。
  `SuggestionCopyService` 写入持久化结果。
- **Explanation** (`explanation/`) — `ExplanationGeneratorService` +
  `ExplanationQueueService` (BullMQ BaseAsync, concurrency=2) — AI 生成建议解释。
  `ExplanationService` 提供同步 fallback 和结果查询。

## Feedback

- **FeedbackService** (`feedback/recorder.service.ts`) — 记录用户对建议卡片的
  反馈（`ACCEPTED` / `LATER` / `NOT_APPLICABLE` / `SUPPRESS`）。`SUPPRESS` 会
  影响后续 Suppression 层的过滤逻辑。
- **FeedbackStatsService** (`feedback/stats.service.ts`) — 反馈统计。

## Module Exports

通过 `index.ts` barrel 导出：

- `LifecycleService` — 被 `daily-records` 和 `medicine-dose-logs` 模块用于
  触发建议失效（通过 domain events，非直接调用）。
- `LIFECYCLE_REFRESH_CRON` — cron 常量。

## API Endpoints

| Method | Path                                            | Description                    |
| ------ | ----------------------------------------------- | ------------------------------ |
| `GET`  | `/user/today/suggestions`                       | 获取今日建议卡片（读物化结果） |
| `POST` | `/user/today/suggestions/:id/feedback`          | 提交建议反馈                   |
| `POST` | `/user/today/suggestions/:id/explain`           | 同步获取 AI 解释               |
| `POST` | `/user/today/suggestions/:id/explain/async`     | 异步获取 AI 解释（enqueue）    |
| `GET`  | `/user/today/suggestions/explain/status/:jobId` | 轮询异步解释状态               |
| `GET`  | `/user/today/suggestions/history`               | 建议历史（报告页）             |

## Suggestion Types

5 种卡片类型（对齐 `Product_Insights`）：

| Type              | Description                        |
| ----------------- | ---------------------------------- |
| `confirmed_risk`  | 确认的风险（如漏服、健康事件恶化） |
| `compliance`      | 依从性（如覆盖不足）               |
| `trend`           | 趋势（如饮水/睡眠持续不足）        |
| `behavior_advice` | 行为建议                           |
| `coverage`        | 覆盖（如用药覆盖窗口）             |

## Dependencies

**Imports**: `DailyRecordsModule`, `MedicineDoseLogsModule`, `UserSettingsModule`,
`NotificationsModule`, `NotificationPreferencesModule`, `LlmRuntimeModule`,
`LlmCommonModule`, `ProductEventsModule`, `HealthEventsModule`, `PrismaModule`

**Domain Events Consumed**: `daily-record.changed`, `dose-log.changed`,
`reminder.changed`, `health-context.changed`, `settings.changed`, `health-event.changed`
（详见 [event-catalog](../../../docs/01-reference/event-catalog.md)）

**Domain Events Published**: `today-suggestion.materialization.changed`（仅供
today-analysis 消费）
