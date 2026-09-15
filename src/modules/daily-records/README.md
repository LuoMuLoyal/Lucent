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
  rank 排序裁剪、失败原因码)。**结构化是真相**,文案只是它的投影。
- 提示词:`prompts/meal-analysis.prompt.ts`;调用:`services/meal-analysis/vision.service.ts`
  (结构化输出 + 超时;失败以原因码**返回**,不抛异常)。
- 落库:`services/meal-analysis/worker.service.ts` —— 写回前用
  `updateMany` 复检 `mealSourceRevision`(分析期间再编辑则丢弃本次结果),
  失败一律落 `analysis_failed` + 原因码。
- 过期回收:`services/meal-analysis/sweeper.service.ts`,由 `CronJobsService`
  每 5 分钟触发,把停留超过 `MEAL_ANALYSIS_STALE_AFTER_MS` 的 `analyzing`
  记录落成 `model_timeout`,使详情页能重试。
- 客户端唯一可编辑字段是菜名列表(`payload.mealAnalysis.dishes`,
  `source: 'user'`);其余字段服务端独占。改菜名不重算结论与区间。重试 =
  重新提交同一张图(PATCH 带一张 attachment,`revision` 递增后重新入队)。
- **读路径分两层**:列表/聚合只读投影列(`meal_analysis_status` /
  `meal_headline` / `meal_calorie_min|max|bucket` /
  `meal_analysis_failure_reason`,写入时由 `toMealAnalysisHotFields` 统一投影),
  不解析 payload JSONB;详情接口才返回完整 `payload.mealAnalysis`
  (`items` 全量 + `dishes`)。

## 依赖方向

- imports:`ConfigModule`、`PrismaModule`、`LlmRuntimeModule`、`StorageModule`、
  `LlmCommonModule`(common barrel)、`HealthEventsModule`。
- 被引用:exports `DailyRecordsService`、`DailyRecordCandidatesService`、
  `DailyRecordReaderPort`、`MealAnalysisSweeperService`;barrel 消费方
  `assistant`、`reports`、`today-analysis`、`today-suggestion`、`common/queue`。

## 内部结构

- `services/records.service.ts` — 日报 CRUD 与领域事件发布。
- `services/mapper.service.ts` — DTO ↔ Prisma/领域模型映射。
- `services/ownership.service.ts` — 记录归属校验(ADR-0009 façade)。
- `services/image-upload.service.ts` — 记录图片直传 presigned URL。
- `services/symptom-catalog.service.ts` — 症状目录(`GET daily-records/symptom-catalog`):
  码与顺序来自 `constants/symptom-catalog.constants.ts`,文案按 `Accept-Language`
  取 `symptom-catalog` i18n 命名空间。客户端保留同码兜底副本。
- `services/candidates/` — 候选编排(orchestrator)、LLM 生成(generator)、
  多语言文案(copy)。
- `services/meal-analysis/` — queue(BullMQ)、vision(多模态)、worker(落库)、
  sweeper(过期回收)。
- `services/meal-payload-writer.service.ts` — 餐食 payload 写路径(菜名清洗、
  入队占位、热列投影)。
- `repositories/daily-record.repository.ts` — 仓储 + Repository/Reader port。

## 测试承接

`daily-records.controller.spec.ts`、`repositories/daily-record.repository.spec.ts`、
`schemas/*.spec.ts`(含餐食 v2 契约与模型输出契约)、
`types/meal-analysis.types.spec.ts`(payload 读写与热列)、
`services/**/*.spec.ts`(含 vision/worker/sweeper 的失败与竞态路径)
