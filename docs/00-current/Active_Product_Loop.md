---
status: active
owner: backend
quadrant: reference
updated: 2026-08-09
---

# Active Product Loop — Health Event Contract

Last updated: 2026-08-09

## 当前状态

Health Event Contract 已完成后端合同、持久化、所有权校验、领域事件和 OpenAPI 导出。

- `health-events` ownership module 已接入应用模块和 `/user` 路由树；数据库 migration 保存事件、每日 check-in、事件与当前用药的关联，并限制同一用户同时只有一个 active event。
- 用户只能显式开始和结束事件；结束必须选择 `improved`、`unchanged` 或 `worsened`。每日 check-in 使用同一枚举，每个事件与自然日最多一条并允许更正。
- 所有查询、详情、写入和关联记录/用药操作都按认证用户 ownership 过滤；事件结束后保留历史关联，但禁止建立新的关联。
- 日期按用户 profile timezone 归属；缺失或无效 timezone 使用 `Asia/Shanghai`。响应返回带 offset 的 ISO 8601 时间点和 `YYYY-MM-DD` 日期。
- create、end、check-in 仅在 repository 写入成功后发射一次 `health-event.changed`，失败或校验拒绝不发射。
- `docs/openapi.json` 已导出六个健康事件操作、状态/结果枚举及可空 `healthEventId` 字段；Luminous 已据此重新生成 Flutter client。

## 验证状态

- 健康事件定向测试：`pnpm test -- src/modules/health-events`，4 个文件、32 tests 通过。
- 全仓 `pnpm lint:check`（`--max-warnings=0`）、`pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm docs:check` 通过。
- 本轮仍未完成真实 PostgreSQL acceptance flow：本地 `127.0.0.1:15432` 不可连接，因此未声称验证第二个 active event 的数据库拒绝写入，也未声称完成用户 A/B 的 live API 隔离流程。

## 下一阶段

下一阶段是 Proactive Suggestion Runtime：记录、dose log、reminder 和健康事件写入应触发有界重算；Today GET 只读取已有结果，并明确正常、缺失、陈旧和失败状态。
