# Lucent Plans

Use this directory for active, repo-local execution plans that are too detailed for the backend docs.

## What Goes Here

- multi-step backend implementation plans
- API/deployment/import task checklists that are still actively driving work
- temporary review or handoff notes for a specific Lucent task

## What Does Not Go Here

- runtime or setup facts: put those in `docs/reference/environment-variables.md` or `README.md`
- API contract details: keep those in code plus generated `docs/reference/generated/openapi.json`
- shared contract boundaries: keep those in the owning module's README plus ADRs
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

- [`2026-09-02-agentic-proactive-evolution.md`](2026-09-02-agentic-proactive-evolution.md)
  — Agentic → Proactive → 伴身演进后端任务清单:AI 上下文统一、proposal 服务域化、today/review/reminders 提案工具、BullMQ 事件总线与依从性触发器、跨端会话一致(远期)
- [`2026-08-28-medicine-risk-graph-plan.md`](2026-08-28-medicine-risk-graph-plan.md)
  — 药品风险检查图数据结构引入:Phase 1 关系化 JSONB(PG18),Phase 2 SQL/PGQ 图查询(PG19 GA 后)
- [`2026-08-24-coolify-deployment-restructure-plan.md`](2026-08-24-coolify-deployment-restructure-plan.md)
  — 部署重构:deploy.ts + Compose + Nginx → Coolify + Traefik(**待通过**)
- [`2026-08-22-medium-to-large-migration-inventory.md`](2026-08-22-medium-to-large-migration-inventory.md)
  — 中小型到中大型过渡迁移盘点:配置、Worker/队列、Outbox、Prisma 边界、跨仓合同、数据库发布与可观测性
- [`2026-08-14-saas-modules-and-node-monorepo.md`](2026-08-14-saas-modules-and-node-monorepo.md)
  — SaaS 化后端模块与 Node monorepo 合并计划(0.1.0 后启动)
- [`2026-08-02-rnacos-runtime-config-tuning.md`](2026-08-02-rnacos-runtime-config-tuning.md)
  — rnacos 动态运行时配置与调优:餐食识别/队列/缓存参数热更新
- [`2026-07-24-worker-separation-and-cron-repeatable.md`](2026-07-24-worker-separation-and-cron-repeatable.md)
  — BullMQ Worker 进程分离:`WORKER_MODE` 环境变量拆分 api/worker 进程

已完成的计划按约定直接删除,持久决策落 ADR(`docs/reference/adr/`)与迁移日志。
