---
status: active
owner: backend
---

# daily-records

## 模块意图

用户每日健康记录(日报)的核心写模型:记录 CRUD,以及"照片/文本 → AI 候选
→ 餐食分析"的异步管线。它是 today-suggestion、today-analysis、reports 等
下游消费方的主要信号源。

## 边界

- 管:日报 CRUD 与 `daily-record.changed` 事件、候选生成、餐食分析队列与
  分析结果落库、记录图片直传凭证、症状目录(静态参考数据)。
- 不管:健康事件数据(经 `HealthEventsOwnershipService` 只读,health-events
  模块);对象存储与 LLM 基础设施(common);建议/分析的下游逻辑。

## 餐食分析(v2:一次多模态分析直出)

一次多模态调用产出 `{ calorieRange, dishes, items, facets }`,不再有菜品分解、
成分表接地与人工确认:

- 契约与规范化:`schemas/meal-analysis.schema.ts`(词表、上限、区间纠正、
  rank 排序裁剪、失败原因码)。**结构化是真相**,文案只是它的投影。终态只有
  `analyzing / analyzed / analysis_failed`;失败原因码是封闭词表
  (`image_count_invalid`、`vision_unavailable`、`model_failed`、`model_timeout`、
  `invalid_output`、`job_lost`),客户端按码做 l10n,不再收到英文原串。
- 提示词:`prompts/meal-analysis.prompt.ts`;调用:`services/meal-analysis/vision.service.ts`
  (结构化输出 + 超时;失败以原因码**返回**,不抛异常)。依赖失败码到落库码的
  映射在 `worker.service.ts` 的 `mealFailureReasonFor`(`DEPENDENCY_TIMEOUT` →
  `model_timeout`,`DEPENDENCY_BAD_GATEWAY` → `invalid_output`,其余 →
  `model_failed`)。
- 落库:`services/meal-analysis/worker.service.ts` —— 写回前用
  `updateMany` 复检 `mealSourceRevision`(分析期间再编辑则丢弃本次结果),
  失败一律落 `analysis_failed` + 原因码。
- 过期回收:`services/meal-analysis/sweeper.service.ts`,由 `CronJobsService`
  每 5 分钟(`MEAL_ANALYSIS_REAP_CRON`)触发,把停留超过
  `MEAL_ANALYSIS_STALE_AFTER_MS`(10 分钟,默认值;实际按次读运行时快照)的 `analyzing` 记录落成
  `analysis_failed(job_lost)`,使详情页能重试。**刻意不复用 `model_timeout`**:
  `job_lost` 表示作业没跑完就丢了(崩溃/队列丢单),`model_timeout` 表示模型调用
  自己超时——两者用户补救方式相同,但混码会让真正的模型超时告警被基础设施故障淹没。
  单轮上限 `MEAL_ANALYSIS_REAP_BATCH_SIZE`(同样按次读快照)。cron 发布新值后由
  `CronJobsService` 按 scheduler id 原地重排,失败只告警。
- 客户端唯一可编辑字段是菜名列表(`payload.mealAnalysis.dishes`,
  `source: 'user'`);其余字段服务端独占。改菜名不重算结论与区间。重试 =
  重新提交同一张图(PATCH 带一张 attachment,`revision` 递增后重新入队)。
- **读路径分两层**:列表/聚合只读投影列(`meal_analysis_status` /
  `meal_headline` / `meal_calorie_min|max|bucket` /
  `meal_analysis_failure_reason`,写入时由 `toMealAnalysisHotFields` 统一投影),
  不解析 payload JSONB;详情接口才返回完整 `payload.mealAnalysis`
  (`items` 全量 + `dishes`)。跨模块范围读同样拿得到这些列:`DailyRecordFact`
  携带全部投影字段(assistant 餐食 digest 靠它一条查询判 `analyzed` 并取
  headline/区间,只为 `items`/`dishes` 回读 payload)。

## 依赖方向

- imports:`ConfigModule`、`PrismaModule`、`LlmRuntimeModule`、`StorageModule`、
  `LlmCommonModule`(common barrel)、`HealthEventsModule`。
- 被引用:exports `DailyRecordsService`、`DailyRecordCandidatesService`、
  `DailyRecordReaderPort`、`MealAnalysisSweeperService`、餐食回收常量
  (`MEAL_ANALYSIS_REAP_CRON` / `MEAL_ANALYSIS_REAP_JOB_NAME`) 与
  `parseMealRecordPayload`;barrel 消费方 `assistant`、`reports`、
  `today-analysis`、`today-suggestion`、`common/queue`(cron-jobs 调 sweeper)。
- 队列名不写死:本模块只从 `common/queue/queue-names.ts` 的 `QUEUE_NAMES`
  派生出 `MEAL_ANALYSIS_QUEUE_NAME`(`constants/meal-analysis.constants.ts`),
  新增/改名队列必须先登记进 `QUEUE_NAMES`。

## 内部结构（四层，ADR-0024）

- `domain/record/` — `DailyRecord` 聚合根（归属判定、payload 形状不变量）、
  `record-kind.ts`（领域 kind 词表，与 Prisma enum 逐字一致）、`occurred-at.ts`
  （日期值对象）、`record-row.ts`（行投影）、`records.ts`（写侧仓储端口）。
- `domain/meal/` — 餐食分析值对象与规范化规则（`meal-analysis.ts`）、
  封闭维度词表（`meal-facets.ts`）、分析管线载入端口（`meal-analyses.ts`）。
  **无外部依赖**：契约校验是手写判定（zod 版本留在 adapters 供 OpenAPI 使用）。
- `application/use_cases/` — `create-record` / `update-record` / `delete-record` /
  `get-record` / `list-records` / `get-summary` / `generate-candidates`。
- `application/services/` — 用例共用编排：`meal-analysis-pipeline`（分析管线，
  worker 与回收器同一实现）、`record-write-effects`（入队 + 缓存失效）、
  `record-ownership`（归属）、`meal-payload`（菜名清洗与热列投影）、
  `candidate-copy`（候选多语言文案）、`records-facade.service`（跨模块门面）。
- `application/ports/` — 出站/读侧端口：`records-query`（ADR-0009 reader port）、
  `meal-vision`、`attachment-urls`、`meal-analysis-jobs`、`record-change-events`、
  `candidate-generator`、`candidate-contract`（zod 契约，adapters 反向引用）。
- `application/read_models/` — `record-list`（wire 形状）、`record-item`（行 → 条目投影）、
  `record-fact`（跨模块事实投影）。
- `adapters/http/` — `daily-records.controller.ts` + `dto/`（zod，无 `.dto` 后缀）
  - `image-upload.service.ts` + `symptom-catalog.service.ts`。
- `adapters/queue/` — `meal-analysis-queue`（BullMQ processor + 入队端口实现）、
  `meal-analysis-sweeper`（cron 触发，按次读运行时配置）。
- `infrastructure/persistence/` — `records`（`PrismaRecords`）、
  `record-queries`（reader port + 分析条件写）、`record-mapper`、`attachment-urls`。
- `infrastructure/llm/` — `meal-vision`（多模态 + 结构化输出 + 安全过滤）、
  `candidate-generator` + `candidate-generator-binding`、`schemas-meal-analysis`、
  `prompts/`。

## 依赖方向（四层）

- `domain/**` 只 import 同 `domain/` 树内的文件（`ddd-domain-purity`）；
  需要外部类型时把类型定义在 domain 内。
- `application/**` 不 import 任何模块的 `infrastructure|adapters`，也不直连 Prisma；
  需要传输形状时定义在 `application/ports/` 或 `application/services/write-input.ts`，
  由 adapter 反向引用。
- 跨模块只经根 barrel；`today-suggestion` / `reports` / `today-analysis` / `assistant`
  取 `DailyRecordReaderPort` / `DailyRecordFact` / `MealAnalysisItemKind` /
  `DailyRecordsService` / `DailyRecordCandidatesService`。
- `common/queue`(cron-jobs) 调 sweeper：barrel 保留 `MealAnalysisSweeperService`
  别名（类名 `MealAnalysisSweeper`）。
- 队列名不写死：本模块只从 `common/queue/queue-names.ts` 的 `QUEUE_NAMES`
  派生出 `MEAL_ANALYSIS_QUEUE_NAME`（`constants/meal-analysis.constants.ts`），
  新增/改名队列必须先登记进 `QUEUE_NAMES`。

## 测试承接

`adapters/http/daily-records.controller.spec.ts`、
`domain/meal/meal-analysis.spec.ts`（payload 读写与热列）、
`infrastructure/persistence/legacy-repository.spec.ts`、
`infrastructure/llm/*.spec.ts`（含 vision 失败路径与模型输出契约）、
`application/use_cases/record-use-cases.spec.ts`（创建/更新/删除的归属、校验、
附件替换与跨日失效）、`application/services/*.spec.ts`。
