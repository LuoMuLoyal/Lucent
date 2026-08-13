---
status: active
owner: backend
quadrant: reference
updated: 2026-08-13
---

# Lucent TODO

Last updated: 2026-08-13

This file keeps active backend follow-up items that are intentionally deferred.
Keep durable implementation context in the owning code comments when the TODO is tightly coupled to
one branch or security check, but do not scatter project-level follow-up lists across changelogs or
random docs.

**When a follow-up item is completed:** delete it from this file, move resulting facts to
the relevant `Lucent/docs/00-current/*.md` state file, and record the completion in both today's
`Lucent/docs/02-logs/migration-log/YYYY-MM-DD.md` and
`Luminous/docs/03-logs/migration-log/YYYY-MM-DD.md` as cross-repo sync evidence.

## 后续可做

### 产品闭环重构（已决策，Workstream 1 已完成）

Review Experience（Workstream 1）已完成收口：健康事件读模型、四段 section 服务、三个 review endpoint、第五 Tab「回顾」主路径与 `/report` 兼容路由均已落地。剩余条目属 **Visit Summary and Product Measurement（Workstream 2）**，总计划见 `Luminous/plans/2026-08-07-product-loop-program.md`，执行计划见 `Luminous/plans/2026-08-07-visit-summary-and-product-measurement.md`。

- **报告出口降级（剩余部分，Workstream 2）**：hospital/monthly/print/clinic share 已保留兼容并从默认回顾内容移入「更多」（已完成）；仍待修正 clinic summary 固定 `last_30_days` 却不读取近期记录、`findings` 永远为空，以及 share URL 缺少 `/user` 的合同错误
- **闭环测量（Workstream 2）**：以最小化、可审计事件记录建议曝光/处理、健康事件起止与结果确认、回顾打开、摘要预览、导出请求和分享链接访问；不得把请求生成成功等同于医生查看或用户获益

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

基础可观测性已就位（Prometheus metrics + Grafana dashboards + LLM/BullMQ 指标 + Alertmanager 告警规则）。以下为进阶项：

- OpenTelemetry 分布式追踪
- 添加 synthetic uptime monitoring
