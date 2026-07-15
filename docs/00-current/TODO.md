# Lucent TODO

Last updated: 2026-07-15

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

以下 2 项来自 2026-07-13 全项目审查，7-15 已完成 4 项（safeParseLlmJson、嵌套事务、深比较、pnpm check），剩余待处理：

- 对 `auth`、`assistant`、`reports`、`medicines`、`today-suggestion` 五个模块进行补充审查（逐模块产出审查报告，审查维度：IDOR/注入/越权、错误处理/边界/超时、N+1/索引、类型安全/重复代码/死代码）
- 提取 `safeJsonPayload()` 工具函数，消除 `as unknown as Prisma.InputJsonValue` 重复（`worker.service.ts` 等）
