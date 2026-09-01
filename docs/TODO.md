---
status: active
owner: backend
quadrant: reference
updated: 2026-09-01
---

# Lucent TODO

本文件是唯一 TODO 台账,条目完成即删行。

Last updated: 2026-09-01

This file keeps active backend follow-up items that are intentionally deferred.
Keep durable implementation context in the owning code comments when the TODO is tightly coupled to
one branch or security check, but do not scatter project-level follow-up lists across changelogs or
random docs.

**When a follow-up item is completed:** delete it from this file, and record the completion in
today's `Lucent/docs/logs/migration-log/YYYY-MM-DD.md`(跨仓事项在各自仓库的迁移日志留痕)。

### B5：风险检查候选预检的错误可观测性（P3，2026-08-16 F-9 审查 P2）

`MedicineRiskCheckService.evaluateStaticCheck` 候选详情解析失败时，非 NotFound 异常被 `badRequest('候选药品资料不可用…')` 包装为 400 且原始错误不记录日志（`services/risk/risk-check.service.ts`）。建议：抛错前 `logger.warn` 记录原始 error，或将上游知识库服务类异常转 502/503；验收：候选资料不可用时仍显式失败，且日志可定位原始异常。

### B6：候选预检与药品详情知识缓存的交互口径（P3，2026-08-16 F-9 审查 P2）

候选预检通过 `getDetailWithCache(candidate.id, {source}, false)` 取详情，miss 时会写入药品详情知识缓存（`services/medicines.service.ts`）；「预检不落库」口径仅指 risk-check records 与 records 缓存（已确认不触碰）。验收：确认该口径并在必要时文档化；无行为改动。

## 文档治理观察期(2026-08-31,来源:doc-governance-overhaul 计划,文件已删)

### G1:doc-map 覆盖映射机制整体退役(--report 两周观察后)

`pnpm docs:check --report` 现仅打印覆盖映射报告不阻断。两周观察期内无阻断痛点即删除
buildReport/renderReport 报告路径、`docs/doc-map.yaml` 与 `docs:check` 脚本条目
(check-docs-updated.ts 保留 `--verify` 结构检查);若期间发现仍需映射,回退本项并重新评估。

### G2:arch:check 观察期规则转级(warn → error,一周评估)

基线(2026-08-31):依赖图 R1=7(product-events spec 深引 today-suggestion)、R2=0、
R3=12(common/queue → 4 模块)、R4=1(medicines cache spec 直引 keyv)、R5=0、循环依赖 5 环;
eslint.arch W1=0、W2=12(service 裸 throw)、W3=1033(magic numbers)、W4=54(测试 `: any`);
AST C1=849(DTO 缺 `@Is*`)、C2=111(端点缺显式鉴权)。逐条清理后分批转 error,
全部清零后启用 `check-ast-conventions.ts --strict`。

### G3:CI 增加 openapi.json 一致性 diff 校验

lucent-ci.yml 现仅在 E2E 前重导出 spec 供契约测试;增加
`git diff --exit-code docs/reference/generated/openapi.json` 步骤,使"代码已改但忘记提交
重导出产物"在 CI 失败(README 的 CI 叙述已按此写,补齐实现)。

### G4:契约-代码差异清单(Phase 0 审计遗留)

逐项裁决实现或从契约/文档移除:user-settings `waterTargetCount` 契约缺失;
environment 为简化实现(静态数据,关联 B2);`GET /environment/advice` 未实现;
周报 push 通知通道未实现。

## 后续可做

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
