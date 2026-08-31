---
status: active
owner: backend
---

# today-analysis

## 模块意图

"今日分析"引擎:监听数据变更领域事件,异步重算并物化当日的 AI 健康分析
(LLM 结构化输出),支持版本化 materialization 与无 Redis 降级。与
today-suggestion 互补——分析面向解读,建议面向行动。

## 边界

- 管:分析上下文组装、LLM 生成、物化存储、重算触发与异步队列、推荐卡片、
  SSE 流式输出。
- 不管:建议卡片引擎(today-suggestion);信号数据写模型(daily-records /
  medicine-dose-logs / medicine-reminders)。

## 依赖方向

- imports:`LlmRuntimeModule`、`LlmCommonModule`(common)、`AssistantModule`
  (历史 AI 摘要存档)、`NotificationsModule`、`PrismaModule`、
  `DailyRecordsModule`、`MedicineDoseLogsModule`、`MedicineRemindersModule`。
- 被引用:无(module 不导出服务;重算由 `today-suggestion.materialization.changed`
  等领域事件经 common/events 驱动)。

## 内部结构

- `services/analysis.service.ts` — `TodayAnalysisService`:生成入口与流式摘要。
- `services/analysis-queue.service.ts` — BullMQ 异步队列,Redis 缺失时降级同步。
- `services/pipeline/context.service.ts` — 汇聚日报/剂量/事件/用药上下文。
- `services/pipeline/generator.service.ts` — LLM 结构化输出生成。
- `services/pipeline/copy.service.ts` — 多语言文案(i18n)。
- `services/pipeline/recommendations.service.ts` — 内置健康指南推荐。
- `services/materialization/store.service.ts` — 版本化物化状态(claim/stale)。
- `services/recompute/trigger.listener.ts` — 监听领域事件触发重算。

## 测试承接

`today-analysis.contract.spec.ts`、`today-analysis.controller.spec.ts`、
`schemas/analysis.schema.spec.ts`、`services/**/*.spec.ts`
