---
status: active
owner: backend
---

# today-suggestion

## 模块意图

主动建议引擎:从日报、用药、健康事件、用户档案收集信号,经规则引擎生成
候选,再抑制/仲裁/生命周期管理后物化为建议卡片,必要时升级为推送通知。
采用 write-time materialization——数据变更时异步重算,GET 只读物化结果。

## 边界

- 管:信号采集、规则引擎(`SuggestionRule`)、仲裁打分、反馈抑制、建议
  生命周期、AI 文案与解释、重算队列与推送升级。
- 不管:信号原始数据写模型(daily-records / medicine-dose-logs /
  health-events);通知渠道细节(notifications);分析型输出(today-analysis)。

## 依赖方向

- imports:`PrismaModule`、`NotificationsModule`、`NotificationPreferencesModule`、
  `LlmRuntimeModule`、`LlmCommonModule`(common)、`DailyRecordsModule`、
  `MedicineDoseLogsModule`、`UserSettingsModule`、`ProductEventsModule`、
  `HealthEventsModule`。
- 被引用:barrel 导出 `LifecycleService` 与 `LIFECYCLE_REFRESH_CRON`(当前无
  直接 barrel 消费方);today-analysis 经领域事件消费其物化变更。

## 内部结构

- `services/suggestion.service.ts` — 编排入口(含 recompute)。
- `services/pipeline.service.ts` / `presentation.service.ts` — 管线编排与 DTO 呈现。
- `services/collectors/` — 4 个信号采集器(用药/日报/档案/健康事件)。
- `services/rules/` — 规则注册表与 8 条规则(medication/lifestyle/sleep/health)。
- `services/arbitration/` — 打分(scoring)、抑制(suppression)、仲裁(arbiter)。
- `services/lifecycle/` — 生命周期管理(manager)与基线判定(baseline)。
- `services/materialization/`、`services/recompute/` — 物化存储与重算三件套
  (queue/trigger/worker)。
- `services/cache/` — 信号/基线缓存与领域事件失效监听。
- `services/copy/`、`services/explanation/` — AI 文案与 AI 解释(各含队列)。
- `services/feedback/` — 反馈记录与统计(SUPPRESS 影响后续过滤)。
- `services/notification/escalation.service.ts` — 推送升级判定。

## 测试承接

`today-suggestion.controller.spec.ts`、`schemas/explanation.schema.spec.ts`、
`services/**/*.spec.ts`(arbitration/rules/collectors/lifecycle/recompute 逐文件覆盖)
