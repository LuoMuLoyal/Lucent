# Lucent TODO

Last updated: 2026-07-10

This file keeps active backend follow-up items that are intentionally deferred.
Keep durable implementation context in the owning code comments when the TODO is tightly coupled to
one branch or security check, but do not scatter project-level follow-up lists across changelogs or
random docs.

**When a follow-up item is completed:** delete it from this file, move resulting facts to
`Luminous/docs/00-current/Current_State.md`, and record the completion in both today's
`Lucent/docs/02-logs/migration-log/YYYY-MM-DD.md` and
`Luminous/docs/03-logs/migration-log/YYYY-MM-DD.md` as cross-repo sync evidence.

## 后续可做

### 数据层

- 为 assistant、auth 模块补充 Repository 抽象层（daily-records 已完成）
- 将 DailyRecordsService 的现有 Prisma 调用迁移到 DailyRecordRepositoryPort

### 可观测性（暂时搁置）

- OpenTelemetry 分布式追踪
- 接入 recordBullmqJob() / recordLlmCall() / recordLlmTokens()
- 配置 Prometheus alerting rules
- 添加 synthetic uptime monitoring
