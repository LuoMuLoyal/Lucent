# Lucent TODO

Last updated: 2026-07-13

This file keeps active backend follow-up items that are intentionally deferred.
Keep durable implementation context in the owning code comments when the TODO is tightly coupled to
one branch or security check, but do not scatter project-level follow-up lists across changelogs or
random docs.

**When a follow-up item is completed:** delete it from this file, move resulting facts to
`Lucent/docs/00-current/Current_State.md`, and record the completion in both today's
`Lucent/docs/02-logs/migration-log/YYYY-MM-DD.md` and
`Luminous/docs/03-logs/migration-log/YYYY-MM-DD.md` as cross-repo sync evidence.

## 后续可做

### 高级可观测性（基础已完成）

基础可观测性已就位（Prometheus metrics + Grafana dashboards + LLM/BullMQ 指标）。以下为进阶项：

- OpenTelemetry 分布式追踪
- 配置 Prometheus alerting rules
- 添加 synthetic uptime monitoring

### 2026-07-13 审查遗留项

以下 6 项来自 2026-07-13 全项目审查，已确认有实际价值，暂未处理：

- 对 `today-suggestion`、`assistant`、`notifications`、`security-pin`、`data-export` 五个模块进行补充审查（本次全项目扫描未覆盖）
- 提取 `safeParseLlmJson<T>()` 公共函数，统一 `medicines.service.ts`、`vision.service.ts`、`decomposition.service.ts` 等 LLM 返回的解析-验证逻辑
- 确认 `repository.transaction` 是否正确传递 `Prisma.TransactionClient`，排查嵌套事务风险（`daily-records.service.ts`）
- 提取 `safeJsonPayload()` 工具函数，消除 `as unknown as Prisma.InputJsonValue` 重复（`worker.service.ts` 等）
- 用 `fast-deep-equal` 替代 `JSON.stringify` 深比较（`meal-analysis.types.ts:293`）
- 运行 `pnpm check` 验证命名重构后的文档一致性
