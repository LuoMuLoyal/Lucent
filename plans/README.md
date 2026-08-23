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

- [`2026-08-22-medium-to-large-migration-inventory.md`](2026-08-22-medium-to-large-migration-inventory.md)
  — 中小型到中大型过渡迁移盘点：配置、Worker/队列、Outbox、Prisma 边界、跨仓合同、数据库发布与可观测性
- [`2026-08-18-error-contract-and-neverthrow-migration-plan.md`](2026-08-18-error-contract-and-neverthrow-migration-plan.md)
  — RFC 9457 + neverthrow 错误处理硬切；2026-08-22 已进入冻结新功能的硬切窗口
- [`2026-08-23-neverthrow-migration-order.md`](2026-08-23-neverthrow-migration-order.md)
  — 错误处理硬切的 Lucent 内部迁移顺序；完成后删除
