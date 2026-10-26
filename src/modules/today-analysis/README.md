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
- 被引用:无(无 `index.ts` 导出面;重算由 common/events 的
  `DAILY_RECORD_CHANGED` / `DOSE_LOG_CHANGED` / `HEALTH_EVENT_CHANGED` /
  `TODAY_SUGGESTION_MATERIALIZATION_CHANGED` 经
  `adapters/queue/event-consumer.ts` 消费,按 ADR-0025 走
  `today-analysis` 队列的 `event-trigger` job,无 Redis 时回退进程内直接调用)。

## 分层判定（ADR-0024，2026-10-26）

两项判定先于搬迁做出，记在这里供后来人复核。

### 判定 A：物化表**不建聚合**

`user_today_analysis_materialization` 记录「这一天算到第几版」，管的是**并发控制**
而不是业务规则。三条实证：

1. `markPending` 不检查当前状态（`capped → pending` 是正常路径）；
2. `stale` **不是存储状态而是投影** —— `toPublicStatus()` 在读出时按
   `sourceVersion > computedVersion` 算出来，表里没有这一列；
3. `claimGeneration` 的四种结果（`claimed` / `stale` / `capped` / `busy`）是**一次
   竞争的结局**，不是聚合的生命周期。

聚合的状态集必须封闭且显式；有状态是从别的字段算出来的，说明状态模型没建对，
**派生状态归查询侧**。这与 `today-suggestion` 对
`user_suggestion_materializations` 的裁决同构（那边结论是「版本只前进」，不是
「生命周期只前进」）——同一个模式不重复设计第二次。

**落地**：`infrastructure/persistence/materialization.ts`（Prisma 实现）+
`application/ports/materialization.ts`（端口）。行形状
（`types/materialization.types.ts`）跟随实现走——其中 `MaterializationReasonCode`
的值是队列事件名，属**发布语言**而非本上下文领域词汇，不上移到 `domain/`。

### 判定 B：`trigger-evaluator` 是领域规则

它决定「哪类变更值得重算分析」：维度白名单（water/meal/sleep/mood）、近 7 天至少
3 条记录、偏离基线 ≥ 0.5。这三个数字**就是产品行为**——「一天喝一杯水不该重算」
这句话本身。按 ADR-0024 与 `today-suggestion` 的 `domain/rule/thresholds.ts` 同一
口径，它们属于领域，且必须**可脱离 Prisma 单测**。

**关键**：白名单与阈值必须**同址**。当前 `event-consumer.ts` 里有一份
`DIMENSION_RECORD_KINDS`，`trigger-evaluator` 里另有一份阈值——两者分开住会导致
「白名单在 adapter、判定在 domain」的割裂，改一处漏一处。**落地时两者都进
`domain/analysis/trigger.ts`**，`event-consumer` 反向引用。

> 注意：判定 B 把 `trigger-evaluator` 移进 `domain/`，但它依赖
> `DailyRecordReaderPort`（I/O）。按 D1，领域层不得依赖端口——因此**拆分**：
> 纯判定（给定记录集合 + 今天，判断是否触发）进 `domain/`；
> 读数据的那层留在 `application/services/`，作为领域函数的调用方。

## 内部结构

四层已完整落到 ADR-0024 骨架（`plans/2026-10-26-ddd-migration-completion.md`）。

### adapters

- `http/controllers/today-analysis.controller.ts` — 读/生成/流式三组端点。
- `http/dto/` — 请求与流式响应形状。
- `acl/analysis-context.ts` — 汇聚日报/剂量/事件/用药上下文（经各上游 reader
  port）；同时产出 `TodayAnalysisContext`。**形状已移走**
  （`application/read_models/analysis-context-shape.ts`），ACL 只负责产出。
- `queue/event-consumer.ts` — 领域事件 → 重算任务，参见上文顺序约束。
- `queue/analysis.ts` — BullMQ 队列，Redis 缺失时降级同步。

### application

- `ports/` — `materialization`（判定 A）、`materialization-shapes`、
  `analysis-pipeline`（`ANALYSIS_CONTEXT_SOURCE` / `ANALYSIS_GENERATOR`）、
  `analysis-output`（LLM 输出形状）、`analysis-queue`。
- `use_cases/generate-today-analysis.ts` — 生成编排；另含命令形状。
- `services/` — `trigger-gate`（判定 B 的取数层）、`trigger-evaluator`
  （模块内注入点）、`analysis-copy`（多语言文案）。
- `read_models/` — 上下文形状、推荐卡片、响应投影、餐食占位标题。

### domain

- `analysis/trigger-gate.ts` — 判定 B：维度白名单 + 阈值 + 聚合规则。
- `analysis/materialization-vocabulary.ts` — 判定 A：生成上限、冷却与超时，
  以及 `stale`/`empty` 这两个**派生状态**的说明。

### infrastructure

- `persistence/materialization.ts` + `.types.ts` — 物化行读写。
- `llm/` — `analysis-generator`（结构化输出）、`prompts/`、`schemas/`。

### 跨上下文读的口径

本模块**不直连任何上游表**：日报与餐食解析走 `daily-records`、剂量走
`medicine-dose-logs`、提醒走 `medicine-reminders`、时区与健康档案走
`user-health-context`、AI 摘要开关走 `user-settings`，全部经各自的 port。

## 测试承接

`today-analysis.contract.spec.ts`、`adapters/**/*.spec.ts`、
`application/**/*.spec.ts`、`infrastructure/**/*.spec.ts`。
触发门禁的顺序与阈值约束由 `adapters/queue/event-consumer.spec.ts` 与
`domain/analysis/trigger-gate.ts` 的纯函数测试共同钉住。
