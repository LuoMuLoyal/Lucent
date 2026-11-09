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

> 更新于 2026-11-09。每份计划的状态以文件自身头部的状态段为准；此处只列当前仍在驱动工作、
> 或已裁决暂缓但保留触发条件的计划。

| 计划                                                                                                           | 状态                                   | 备注                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`2026-11-09-onsides-neo4j-import.md`](2026-11-09-onsides-neo4j-import.md)                                     | **草案，待评审**                       | OnSides 3.1.1（693 万条关系）导入 Neo4j。前置依赖 `product-regulatory-positioning` 的数据源裁决                                                                                                                                                                                           |
| [`2026-10-24-medication-intelligence-plan.md`](2026-10-24-medication-intelligence-plan.md)                     | **草案，待评审；P0 阻塞**              | 用药智能：关系查询地基 + 机理冲突解释 / 用药全景 / 半衰期感知漏服。**dev 库关系表为空（0 行），P0 数据就绪前不启动 P1–P3**                                                                                                                                                                |
| [`2026-10-18-nestjs-microservices-monorepo.md`](2026-10-18-nestjs-microservices-monorepo.md)                   | **未开工，待裁决**                     | 绞杀者渐进：Traefik 边缘逐片切出 identity/health/medicine/assistant/insights/notifications/content + admin BFF；P0.5 命名硬切一次；TS + Python（仅 `services/ontology`）、Turborepo 多语言任务图、RabbitMQ、每服务独立 database、service JWT、`apps/legacy` 标准布局；Nomad + rnacos 部署 |
| [`2026-10-17-drug-adverse-reaction-data-sources.md`](2026-10-17-drug-adverse-reaction-data-sources.md)         | 数据源评估完成，待开工                 | 药品不良反应数据源引入。现有 `adverseReactions` 是散文、无法按反应反查药品                                                                                                                                                                                                                |
| [`2026-09-06-rag-hybrid-search-upgrade.md`](2026-09-06-rag-hybrid-search-upgrade.md)                           | **未开工，范围已收窄**                 | 中文两路已随 LightRAG 落地迁走，只剩 DrugBank 英文通道 FTS + RRF。**开工前需先裁决「是否还值得做」，裁决为不做则整体删除**                                                                                                                                                                |
| [`2026-09-02-agentic-proactive-evolution.md`](2026-09-02-agentic-proactive-evolution.md)                       | Phase 0 起未开工                       | P0-1 的混合检索部分已由 rag-hybrid 计划单独立项                                                                                                                                                                                                                                           |
| [`2026-08-28-medicine-risk-graph-plan.md`](2026-08-28-medicine-risk-graph-plan.md)                             | Phase 1/2 **未开工**；Phase 3/4 已作废 | Phase 3 移交 LightRAG 计划、Phase 4 移交 Semantica/Neo4j（ADR-0021/0022）                                                                                                                                                                                                                 |
| [`2026-07-24-worker-separation-and-cron-repeatable.md`](2026-07-24-worker-separation-and-cron-repeatable.md)   | **暂缓，未开工**                       | 触发条件：`bullmq_waiting_jobs` 持续非零，或 p95 与队列高峰相关。内容与 `Luminous/plans/2026-08-16-engineering-backend-plan.md` P2-A 重复，以后者触发条件为准                                                                                                                             |
| [`2026-10-17-open-source-medical-projects-reference.md`](2026-10-17-open-source-medical-projects-reference.md) | 参考池（非执行计划）                   | 开源医疗项目功能差距与借鉴清单，采纳项另立计划                                                                                                                                                                                                                                            |
| [`product-regulatory-positioning.md`](product-regulatory-positioning.md)                                       | active                                 | 产品监管定位（A 路径），非执行计划                                                                                                                                                                                                                                                        |

## 已退役/已移交的计划

- `2026-10-30-user-interface-layouts.md`（`layouts` 资源：`GET /layouts` 全部 / `GET` 单个 /
  `PUT` 乐观写入 / `POST /layouts/:surface/generate` SSE，一张表 `layouts(user_id, surface)`）、
  `2026-10-07-assistant-intent-routing-and-retrieval-fixes.md`（意图路由改由大模型识别 + 8 项检索缺陷修复）
  **2026-11-09 实施完毕文件已删**。
- 更早退役的 `2026-09-30-admin-console.md`、`2026-09-10-staging-native-pm2-traefik.md`、
  `2026-08-14-saas-modules-and-node-monorepo.md`、`2026-09-27-apache-age-introduction-plan.md`、
  `2026-09-29-neo4j-graph-store-migration-plan.md`、`2026-09-01-nestjs12-upgrade-plan.md`、
  `2026-10-16-backend-engineering-capabilities.md` 等按生命周期删除，历史记录见当日迁移日志。

## 与其它目录的关系

- 未完成项的唯一台账是 `docs/TODO.md`——计划文件只写「怎么做」，不复制待办清单。
- operationId 不由任何查找表维护：它是端点自身的属性，写在 handler 的
  `@ApiOperation({ operationId })` 上。原 `plans/_naming-lookup.json` 已删除，
  导出时的唯一性与「标注 ↔ operation」对账见 `docs/howto/sync-openapi-client.md`。
