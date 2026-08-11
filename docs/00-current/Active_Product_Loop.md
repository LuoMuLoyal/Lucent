---
status: active
owner: backend
quadrant: reference
updated: 2026-08-11
---

# Active Product Loop — Health Event Contract / Proactive Suggestion Runtime

Last updated: 2026-08-11

## 当前状态

Health Event Contract 已完成后端合同、持久化、所有权校验、领域事件和 OpenAPI 导出；Proactive Suggestion Runtime 已完成 Task 7 的后台重算、baseline observation、reminder slot 评估和 Today Analysis 物化接线。

- `health-events` ownership module 已接入应用模块和 `/user` 路由树；数据库 migration 保存事件、每日 check-in、事件与当前用药的关联，并限制同一用户同时只有一个 active event。
- 用户只能显式开始和结束事件；结束必须选择 `improved`、`unchanged` 或 `worsened`。每日 check-in 使用同一枚举，每个事件与自然日最多一条并允许更正。
- 所有查询、详情、写入和关联记录/用药操作都按认证用户 ownership 过滤；事件结束后保留历史关联，但禁止建立新的关联。
- 日期按用户 profile timezone 归属；缺失或无效 timezone 使用 `Asia/Shanghai`。响应返回带 offset 的 ISO 8601 时间点和 `YYYY-MM-DD` 日期。
- create、end、check-in 仅在 repository 写入成功后发射一次 `health-event.changed`，失败或校验拒绝不发射。
- `docs/openapi.json` 已导出六个健康事件操作、状态/结果枚举及可空 `healthEventId` 字段；Luminous 已据此重新生成 Flutter client。
- 建议重算由 `RecomputeQueueService` 交给 `SuggestionRecomputeWorkerService` 执行；worker 完成采集、规则、仲裁、模板呈现、cache/持久化并标记 `ready`，异常标记 `failed`，新 source version 到达时最多有界追赶 3 次。建议卡和 materialization 都带 source-version fence，旧版本不能覆盖新版本的 active cards。
- `GET /today/suggestions` 只读取 materialization、cache 和持久化 active cards，不再调用 pipeline 或 LLM；响应包含 `materializationStatus`、`sourceVersion`、`computedAt` 和 `retryAfterSeconds`，支持 `empty/pending/ready/stale/failed`。
- 成功 recompute 使用同一批 collector signals 写入 baseline observation；仅显式提供 observed value 且 coverage sufficient 的 signal 会写入（包括明确覆盖的 `0`），按 `userId + dimension + localDate` 幂等。
- baseline 写入失败不会丢弃已生成建议，已生成建议仍可读取；materialization 保留固定错误码 `BASELINE_OBSERVATION_FAILED`，不标记为 ready。
- Medication collector 按 reminder slot 评估 `planned/taken/skipped/unconfirmed/overdueUnconfirmed`，用 `now()` 与用户 profile timezone 组合 `scheduledFor + scheduledTime`；无效时区回退 `Asia/Shanghai`，DST gap 和无效日期不伪造 overdue。
- dose-log reader 投影带出 `reminderId`；有 reminderId 的日志精确匹配槽位，历史无 reminderId 的日志仅在 medicine+scheduledTime 唯一时 fallback。同药多槽位不再按 medicineId 折叠，missed-dose rule 只消费 `overdueUnconfirmed`，文案保持待确认语义。
- Today Analysis 使用 `userId + localDate + sourceVersion` 的 BullMQ job id 合并触发；普通 daily record 不触发，只有 symptom record、health-event create/end、symptom check-in、dose log 和合格的 suggestion materialization 版本进入分析队列。`GET /today-analysis` 只读历史物化结果，不调用 LLM。
- Today Analysis materialization 持久化 `sourceVersion`、`computedVersion`、`computedAt`、`generationCount` 和失败状态；每个自然日最多生成 3 次，手动刷新有 5 分钟冷却，旧结果在 `stale/pending/failed` 状态下继续可读。
- Suggestion recompute 已接入低基数 Prometheus 指标：enqueue、dedupe、job duration、ready/failed 和 stale age；标签不包含 userId、日期或健康内容。

## 验证状态

- 健康事件定向测试：`pnpm test -- src/modules/health-events`，4 个文件、32 tests 通过。
- PostgreSQL live acceptance：`pnpm test:e2e -- test/e2e/health-events/health-events.e2e-spec.ts`，1 file、1 test 通过；真实流程覆盖用户 A 的症状/当前用药关联、用户 B 的读取和关联隔离、第二个 active 事件冲突、check-in、结束和历史读取。
- 全仓 `pnpm lint:check`（`--max-warnings=0`）、`pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm docs:check` 通过。
- migration `20260809000000_add_health_events` 已分别应用到 development `127.0.0.1:15432/lucent` 和 test `127.0.0.1:5432/lucent`；live E2E 运行在 test runtime，开发库只完成 migration 状态确认。
- live E2E 在用户 A 首次读取 active event 时确认没有 check-in，随后只有显式 check-in/end API 改变状态；因此没有发现系统建议绕过用户确认写入事件状态的路径。
- Proactive Suggestion Runtime Task 4 定向测试：9 个 spec、123 tests 通过；`pnpm typecheck`、`pnpm lint:check`（`--max-warnings=0`）、`pnpm format:check`、`pnpm build`、`pnpm exec prisma validate` 和 `git diff --check` 通过。OpenAPI 已重新导出，语义 diff 为 27 行。新增 `20260809020000_add_suggestion_source_version` 已应用到 development/test PostgreSQL；worker 对已完成同版本任务幂等短路，materialization 失败写入仅作用于 pending 状态。
- Proactive Suggestion Runtime Task 5 定向测试：7 个 spec、86 tests 通过；`pnpm typecheck`、`pnpm exec prisma validate`、`pnpm prisma:generate` 和 development/test migration deploy 通过。新增 baseline observation 唯一约束已应用到两个本地 PostgreSQL 数据库。
- Proactive Suggestion Runtime Task 6 定向测试：3 个 spec、54 tests 通过；today-suggestion 模块回归 37 个文件、400 tests 通过；`pnpm typecheck`、`pnpm lint:check`（`--max-warnings=0`）、`pnpm format:check`、`pnpm build` 和 `git diff --check` 通过。覆盖用户时区、非法时区 fallback、DST gap/fold、无效日期、reminderId 精确匹配、历史日志歧义和混合 reminder summary。
- Proactive Suggestion Runtime Task 7 定向测试：today-analysis 10 个 spec、102 tests 通过；today-suggestion、health-events、daily-records、medicine-dose-logs 回归 61 个 spec、622 tests 通过。`pnpm exec prisma validate`、`pnpm prisma:generate`、`pnpm typecheck`、`pnpm lint:check --max-warnings=0`、`pnpm build` 和 development/test migration deploy 通过。
- Proactive Suggestion Runtime Task 8 已完成：Luminous Today 消费 `ready/stale/pending/failed/empty`，GET 只读，事件去抖刷新、resume sourceVersion 检查、cold-start cache 保留和 FIFO 请求串行均已覆盖定向测试。
- Proactive Suggestion Runtime Task 9 已完成：Lucent 低基数运行时指标、全量验证和文档 checkpoint 已完成；PostgreSQL + Redis live acceptance 覆盖记录写入后的 worker 物化、首个只读 GET，以及连续 10 次写入后的版本收敛。
- Task 9 验证：相关定向测试 4 个 spec、49 tests；Today suggestion API E2E 11 tests；临时 live acceptance 1 test；全量 `pnpm test`、`pnpm lint:check`、`pnpm typecheck`、`pnpm build`、`pnpm format:check`、Prisma validate、docs check/verify/links 均通过。

## 下一阶段

下一阶段进入 Sparse Record Semantics：统一服药槽位、饮水 ml/coverage、睡眠片段和 unknown 语义；Proactive Suggestion Runtime 保留为已完成的服务端主动重算基础。
