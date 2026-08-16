---
status: active
owner: backend
quadrant: reference
updated: 2026-08-14
---

# Lucent TODO

Last updated: 2026-08-14

This file keeps active backend follow-up items that are intentionally deferred.
Keep durable implementation context in the owning code comments when the TODO is tightly coupled to
one branch or security check, but do not scatter project-level follow-up lists across changelogs or
random docs.

**When a follow-up item is completed:** delete it from this file, move resulting facts to
the relevant `Lucent/docs/00-current/*.md` state file, and record the completion in both today's
`Lucent/docs/02-logs/migration-log/YYYY-MM-DD.md` and
`Luminous/docs/03-logs/migration-log/YYYY-MM-DD.md` as cross-repo sync evidence.

## 后续可做

### F-6 提醒组整组 upsert 审查 P2 遗留（2026-08-16，不阻塞）

- P2-1 `src/modules/medicine-reminders/services/reminders.service.spec.ts`「rollback」用例的 mock 未执行事务回调，只验证失败不发事件、未真正验证回滚语义（回滚由 Prisma `$transaction` 保证，repository spec 已验委托）。验收：mock 的 transaction 实现执行回调并断言 tx 内调用，或加注释说明覆盖边界。
- P2-3 同槽 id 重复未拒绝，last-write-wins。验收：如需拒绝可在 service 加重复 id 校验（badRequest）。

### F-8 提醒文案 i18n 审查 P2 遗留（2026-08-16，不阻塞）

- P2-4 `docs-openapi` 规则对 `docs/01-reference/contracts/**` 的 docs_any_of 仅指向 toolchain.md，编辑 reminder-contract.md 会持续打印非阻塞提示。验收：评估 doc-map `docs-openapi` 规则 any_of 是否应包含 reminder-contract 相关文档，或接受提示。

### B2：环境数据接入真实天气 API（P3）

静态环境数据已标注 `dataSource: 'static'`（`src/modules/environment/config/reference.ts`）。
v1.1.0 接入真实天气/空气质量 API（和风天气/彩云天气等），替换 6 个区域静态配置文件。

### B3：多实例限流验证（P3）

`ThrottlerConfigService` 已实现 Redis-backed 限流存储（`REDIS_URL` 存在时启用）。
v2.0.0 水平扩展时需验证多实例限流计数器在 Redis 中的正确性。

### B4：账户删除级联清理（P3）

`DataRetentionService` 已实现 `@Cron` 清理管道（过期会话/通知/反馈抑制）和软删除账户 30 天后硬删除。
仍缺：账户删除流程增加匿名化数据导出 → 数据可移植性 JSON 导出（GDPR/PIPL 合规）。

### 高级可观测性（基础已完成）

基础可观测性已就位（Prometheus metrics + Grafana dashboards + LLM/BullMQ 指标 + Alertmanager 告警规则 + OpenTelemetry 分布式追踪：`src/tracing.ts`、`trace-context.utils.ts`、base-llm-generator 集成）。以下为进阶项：

- 添加 synthetic uptime monitoring
