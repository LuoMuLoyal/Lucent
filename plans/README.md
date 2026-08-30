# Lucent Plans

Use this directory for active, repo-local execution plans that are too detailed for the backend docs.

## What Goes Here

- multi-step backend implementation plans
- API/deployment/import task checklists that are still actively driving work
- temporary review or handoff notes for a specific Lucent task

## What Does Not Go Here

- runtime or setup facts: put those in `docs/01-reference/environment.md` or `README.md`
- API contract details: keep those in code plus generated `docs/openapi.json`
- shared contract boundaries: keep those in `docs/01-reference/contracts/*.md`
- completed plans that no longer drive work

## Naming

Use task-specific names such as:

```text
YYYY-MM-DD-short-task-name.md
```

## Lifecycle

1. Create or update the plan here while the task is active.
2. Execute and verify the task.
3. Move durable decisions into the owning docs.
4. Delete the plan file once it stops being the active execution source.

## Current Plans

- [`2026-08-30-module-boundary-hygiene-audit.md`](2026-08-30-module-boundary-hygiene-audit.md)
  — 模块边界卫生审计与修复 + 微服务式管理实践：补全 index.ts 导出，修复 6 处跨模块深引用，推广 port 接口隔离（`INotificationSender`/`IUserSettingsReader` 等，约 15 处直接注入改 port），事件契约文档化（6 事件 × 21 监听器），可选补 3 个复杂模块 README
- [`2026-08-28-medicine-risk-graph-plan.md`](2026-08-28-medicine-risk-graph-plan.md)
  — 药品风险检查图数据结构引入：Phase 1 关系化 JSONB（PG18），Phase 2 SQL/PGQ 图查询（PG19 GA 后）
- [`2026-08-24-config-yaml-migration-plan.md`](2026-08-24-config-yaml-migration-plan.md)
  — .env → .env + YAML 共存：非敏感配置迁移到 `config/*.yaml`，敏感变量保留 `.env`
- [`2026-08-24-observability-victoria-migration-plan.md`](2026-08-24-observability-victoria-migration-plan.md)
  — 可观测性栈迁移：Prometheus/Grafana → VictoriaMetrics + VictoriaLogs + VictoriaTraces，BullMQ OTel span 补全
- [`2026-08-24-coolify-deployment-restructure-plan.md`](2026-08-24-coolify-deployment-restructure-plan.md)
  — 部署重构：deploy.ts + Compose + Nginx → Coolify + Traefik（**待通过**）
- [`2026-08-22-medium-to-large-migration-inventory.md`](2026-08-22-medium-to-large-migration-inventory.md)
  — 中小型到中大型过渡迁移盘点：配置、Worker/队列、Outbox、Prisma 边界、跨仓合同、数据库发布与可观测性
- [`2026-08-23-better-auth-mobile-jwt-reassessment.md`](2026-08-23-better-auth-mobile-jwt-reassessment.md)
  — Better Auth 主认证迁移计划：替代手写 auth，保持移动端 JWT 合同不变
- [`2026-08-22-better-auth-feasibility.md`](2026-08-22-better-auth-feasibility.md)
  — Better Auth 可行性调研：确认可替代部分认证基础设施，但需适配层
- [`2026-08-18-error-contract-and-neverthrow-migration-plan.md`](2026-08-18-error-contract-and-neverthrow-migration-plan.md)
  — RFC 9457 + neverthrow 错误处理硬切；2026-08-22 已进入冻结新功能的硬切窗口
- [`2026-08-14-saas-modules-and-node-monorepo.md`](2026-08-14-saas-modules-and-node-monorepo.md)
  — SaaS 化后端模块与 Node monorepo 合并计划（0.1.0 后启动）
- [`2026-08-02-rnacos-runtime-config-tuning.md`](2026-08-02-rnacos-runtime-config-tuning.md)
  — rnacos 动态运行时配置与调优：餐食识别/队列/缓存参数热更新
- [`2026-07-24-worker-separation-and-cron-repeatable.md`](2026-07-24-worker-separation-and-cron-repeatable.md)
  — BullMQ Worker 进程分离：`WORKER_MODE` 环境变量拆分 api/worker 进程
