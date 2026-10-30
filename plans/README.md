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

已完成的计划按约定直接删除

## Current Plans

> 更新于 2026-10-30。每份计划的状态以文件自身头部的状态段为准；此处只列当前仍在驱动工作、
> 或已裁决暂缓但保留触发条件的计划。

| 计划                                                                                                                       | 状态                                   | 备注                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`2026-10-30-user-interface-layouts.md`](2026-10-30-user-interface-layouts.md)                                             | **后端已实施**                         | 界面布局的后端权威存储，解锁客户端「可组合 tab」的多设备一致。新增资源 `/layouts`（`GET` 全部 / `GET` 单个 / `PUT` 乐观写入），一张表 `layouts(user_id, surface)`，`payload` 是客户端自定义 JSON、**服务端不解释**，只校验 `schemaVersion` 区间与 `version` 单调 + 409 冲突。`tab_chrome` 与页面布局共用同一资源。生成式布局端点（`/layouts/:surface/generate` SSE）**明确不含**——它属 assistant 域，单独立项。估 4 天 |
| [`2026-10-26-ddd-migration-completion.md`](2026-10-26-ddd-migration-completion.md)                                         | **待评审**                             | DDD 四层收尾：拆 `reports`(6875 行) / `today-analysis`(3099 行)、补完半拆的 `user`、校正三处已撒谎的 module README。**明确不含 MQ 引入与事件原子性改造**（ADR-0025 已裁决不引入 Kafka/RabbitMQ，前置是微服务裁决）                                                                                                                                                                                                     |
| [`2026-10-24-medication-intelligence-plan.md`](2026-10-24-medication-intelligence-plan.md)                                 | **草案，待评审；P0 阻塞**              | 用药智能：关系查询地基 + 机理冲突解释 / 用药全景 / 半衰期感知漏服。**dev 库关系表为空（0 行），P0 数据就绪前不启动 P1–P3**                                                                                                                                                                                                                                                                                             |
| [`2026-10-21-ddd-refactor-backend.md`](2026-10-21-ddd-refactor-backend.md)                                                 | **进行中：`medicines` 已迁移**         | 标准 DDD 首批：Identity & Access / Medicine Catalog / Daily Guidance / AI Assistant；先落 ADR-0024、上下文映射与聚合边界，再按上下文迁移；公开 OpenAPI 零 diff                                                                                                                                                                                                                                                         |
| [`2026-10-18-nestjs-microservices-monorepo.md`](2026-10-18-nestjs-microservices-monorepo.md)                               | **未开工，待裁决**                     | 绞杀者渐进：Traefik 边缘逐片切出 identity/health/medicine/assistant/insights/notifications/content + admin BFF；P0.5 命名硬切一次；TS + Python（仅 `services/ontology`）、Turborepo 多语言任务图、RabbitMQ、每服务独立 database、service JWT、`apps/legacy` 标准布局；Nomad + rnacos 部署                                                                                                                              |
| [`2026-10-07-assistant-intent-routing-and-retrieval-fixes.md`](2026-10-07-assistant-intent-routing-and-retrieval-fixes.md) | P0–P2 已落地，**只剩运维项**           | F3 图谱重导（`export_subgraph.py` 参数化 → 按生产库重导 → 灌 Neo4j）+ 发新镜像部署                                                                                                                                                                                                                                                                                                                                     |
| [`2026-09-17-local-embedding-model-selection.md`](2026-09-17-local-embedding-model-selection.md)                           | **收敛为单一未决项**                   | 三条嵌入线都已被现有方案填上；只剩「是否迁本地自托管」，前置是 GPU 与吞吐基准                                                                                                                                                                                                                                                                                                                                          |
| [`2026-09-06-rag-hybrid-search-upgrade.md`](2026-09-06-rag-hybrid-search-upgrade.md)                                       | **未开工，范围已收窄**                 | 中文两路已随 LightRAG 落地迁走，只剩 DrugBank 英文通道 FTS + RRF                                                                                                                                                                                                                                                                                                                                                       |
| [`2026-08-28-medicine-risk-graph-plan.md`](2026-08-28-medicine-risk-graph-plan.md)                                         | Phase 1/2 **未开工**；Phase 3/4 已作废 | Phase 3 移交 LightRAG 计划、Phase 4 移交 Semantica/Neo4j（ADR-0021/0022）                                                                                                                                                                                                                                                                                                                                              |
| [`2026-09-16-lightrag-introduction-plan.md`](2026-09-16-lightrag-introduction-plan.md)                                     | **实施完毕，指针页**                   | 剩余事项唯一台账在 `docs/TODO.md`「2026-09-18 LightRAG 中文散文检索」                                                                                                                                                                                                                                                                                                                                                  |
| [`2026-09-02-agentic-proactive-evolution.md`](2026-09-02-agentic-proactive-evolution.md)                                   | Phase 0 起未开工                       | P0-1 的混合检索部分已由 rag-hybrid 计划单独立项                                                                                                                                                                                                                                                                                                                                                                        |
| [`2026-08-22-medium-to-large-migration-inventory.md`](2026-08-22-medium-to-large-migration-inventory.md)                   | 六项 Task 均未开工                     | Task 1 暂缓；rnacos 已于 2026-10-19 单独重开                                                                                                                                                                                                                                                                                                                                                                           |
| [`2026-07-24-worker-separation-and-cron-repeatable.md`](2026-07-24-worker-separation-and-cron-repeatable.md)               | **暂缓，未开工**                       | 触发条件：`bullmq_waiting_jobs` 持续非零，或 p95 与队列高峰相关                                                                                                                                                                                                                                                                                                                                                        |
| [`2026-08-29-acorn9-migration.md`](2026-08-29-acorn9-migration.md)                                                         | 阻塞中                                 | 等 acorn 9 上游发布；`package.json` 仍是 `^8.18.0`                                                                                                                                                                                                                                                                                                                                                                     |
| [`product-regulatory-positioning.md`](product-regulatory-positioning.md)                                                   | active                                 | 产品监管定位（A 路径），非执行计划                                                                                                                                                                                                                                                                                                                                                                                     |

## 已退役/已移交的计划

- `2026-09-30-admin-console.md`、`2026-09-10-staging-native-pm2-traefik.md`、
  `2026-08-14-saas-modules-and-node-monorepo.md`、`2026-09-27-apache-age-introduction-plan.md`、
  `2026-09-29-neo4j-graph-store-migration-plan.md`、`2026-09-01-nestjs12-upgrade-plan.md`、
  `2026-10-16-backend-engineering-capabilities.md` 等
  已按生命周期删除（实施完毕文件已删），历史记录见当日迁移日志。

## 与其它目录的关系

- 未完成项的唯一台账是 `docs/TODO.md`——计划文件只写「怎么做」，不复制待办清单。
- operationId 不由任何查找表维护：它是端点自身的属性，写在 handler 的
  `@ApiOperation({ operationId })` 上。原 `plans/_naming-lookup.json` 已删除，
  导出时的唯一性与「标注 ↔ operation」对账见 `docs/howto/sync-openapi-client.md`。
