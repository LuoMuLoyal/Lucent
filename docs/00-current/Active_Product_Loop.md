---
status: active
owner: backend
quadrant: reference
updated: 2026-08-10
---

# Active Product Loop — Health Event Contract / Proactive Suggestion Runtime

Last updated: 2026-08-10

## 当前状态

Health Event Contract 已完成后端合同、持久化、所有权校验、领域事件和 OpenAPI 导出；Proactive Suggestion Runtime 已完成 Task 4 的后台重算接线。

- `health-events` ownership module 已接入应用模块和 `/user` 路由树；数据库 migration 保存事件、每日 check-in、事件与当前用药的关联，并限制同一用户同时只有一个 active event。
- 用户只能显式开始和结束事件；结束必须选择 `improved`、`unchanged` 或 `worsened`。每日 check-in 使用同一枚举，每个事件与自然日最多一条并允许更正。
- 所有查询、详情、写入和关联记录/用药操作都按认证用户 ownership 过滤；事件结束后保留历史关联，但禁止建立新的关联。
- 日期按用户 profile timezone 归属；缺失或无效 timezone 使用 `Asia/Shanghai`。响应返回带 offset 的 ISO 8601 时间点和 `YYYY-MM-DD` 日期。
- create、end、check-in 仅在 repository 写入成功后发射一次 `health-event.changed`，失败或校验拒绝不发射。
- `docs/openapi.json` 已导出六个健康事件操作、状态/结果枚举及可空 `healthEventId` 字段；Luminous 已据此重新生成 Flutter client。
- 建议重算由 `RecomputeQueueService` 交给 `SuggestionRecomputeWorkerService` 执行；worker 完成采集、规则、仲裁、模板呈现、cache/持久化并标记 `ready`，异常标记 `failed`，新 source version 到达时最多有界追赶 3 次。建议卡和 materialization 都带 source-version fence，旧版本不能覆盖新版本的 active cards。
- `GET /today/suggestions` 只读取 materialization、cache 和持久化 active cards，不再调用 pipeline 或 LLM；响应包含 `materializationStatus`、`sourceVersion`、`computedAt` 和 `retryAfterSeconds`，支持 `empty/pending/ready/stale/failed`。

## 验证状态

- 健康事件定向测试：`pnpm test -- src/modules/health-events`，4 个文件、32 tests 通过。
- PostgreSQL live acceptance：`pnpm test:e2e -- test/e2e/health-events/health-events.e2e-spec.ts`，1 file、1 test 通过；真实流程覆盖用户 A 的症状/当前用药关联、用户 B 的读取和关联隔离、第二个 active 事件冲突、check-in、结束和历史读取。
- 全仓 `pnpm lint:check`（`--max-warnings=0`）、`pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm docs:check` 通过。
- migration `20260809000000_add_health_events` 已分别应用到 development `127.0.0.1:15432/lucent` 和 test `127.0.0.1:5432/lucent`；live E2E 运行在 test runtime，开发库只完成 migration 状态确认。
- live E2E 在用户 A 首次读取 active event 时确认没有 check-in，随后只有显式 check-in/end API 改变状态；因此没有发现系统建议绕过用户确认写入事件状态的路径。
- Proactive Suggestion Runtime Task 4 定向测试：9 个 spec、123 tests 通过；`pnpm typecheck`、`pnpm lint:check`（`--max-warnings=0`）、`pnpm format:check`、`pnpm build`、`pnpm exec prisma validate` 和 `git diff --check` 通过。OpenAPI 已重新导出，语义 diff 为 27 行。新增 `20260809020000_add_suggestion_source_version` 已应用到 development/test PostgreSQL；worker 对已完成同版本任务幂等短路，materialization 失败写入仅作用于 pending 状态。

## 下一阶段

下一阶段是 Proactive Suggestion Runtime Task 5：把成功 recompute 后的 baseline observation 接入生产写入，并验证覆盖率、幂等键和失败降级边界。
