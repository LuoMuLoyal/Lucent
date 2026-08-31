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
  菜品模板学习、记录图片直传凭证。
- 不管:健康事件数据(经 `HealthEventsOwnershipService` 只读,health-events
  模块);对象存储与 LLM 基础设施(common);建议/分析的下游逻辑。

## 依赖方向

- imports:`ConfigModule`、`PrismaModule`、`LlmRuntimeModule`、`StorageModule`、
  `LlmCommonModule`(common barrel)、`HealthEventsModule`。
- 被引用:exports `DailyRecordsService`、`DailyRecordCandidatesService`、
  `DailyRecordReaderPort`;barrel 消费方 `assistant`、`reports`、
  `today-analysis`、`today-suggestion`。

## 内部结构

- `services/records.service.ts` — 日报 CRUD 与领域事件发布。
- `services/mapper.service.ts` — DTO ↔ Prisma/领域模型映射。
- `services/ownership.service.ts` — 记录归属校验(ADR-0009 façade)。
- `services/image-upload.service.ts` — 记录图片直传 presigned URL。
- `services/candidates/` — 候选编排(orchestrator)、LLM 生成(generator)、
  多语言文案(copy)。
- `services/meal-analysis/` — 餐食分析:BullMQ 队列(queue)、视觉识别
  (vision)、worker 消费、营养匹配(matcher)。
- `services/meal-dish/` — 菜品分解(decomposition)与模板学习(template-learning)。
- `services/meal-ingredient/grounding.service.ts` — 食材营养 grounding。
- `repositories/daily-record.repository.ts` — 仓储 + Repository/Reader port。

## 测试承接

`daily-records.controller.spec.ts`、`repositories/daily-record.repository.spec.ts`、
`schemas/daily-record-candidates.schema.spec.ts`、`services/**/*.spec.ts`
