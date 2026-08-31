---
status: active
owner: backend
quadrant: index
updated: 2026-08-31
---

# Lucent Docs

Lucent(NestJS 11 后端)文档库唯一索引。目录即裁决:`explanation/` 讲为什么(低频稳定叙事,只减不增);
`reference/` 讲是什么(含 `adr/` 决策只增不改、`generated/` 生成物禁手改);`howto/` 讲怎么做(少而精,
新增须过审计);`logs/migration-log/` 按日追加变更事实,永不覆写已有内容;`archive/` 归档只进不出,
不参与链接与新鲜度校验。实现状态以代码为准;新增文档先做六向裁决(一句版:能由生成器/测试产出的
不手写——生成消除;模块意图下沉模块 README——结构固化;可机器验证的断言归测试——测试承接;
决策→ADR、事实→迁移日志、规划→plans——独立归宿;约束前移到 lint/AST——前移编码时刻;
低频叙事降级为只减不增的快照——降级快照),详见根 [AGENTS.md](../AGENTS.md)。

## 存活文档

- [reference/glossary.md](reference/glossary.md) — 术语单一来源
- [reference/environment-variables.md](reference/environment-variables.md) — 环境变量完整参考;本地环境、YAML 配置与运行时基线也在此文件
- [reference/deployment.md](reference/deployment.md) — 生产部署模型参考(单机 Compose、单 slot、备份链路)
- [reference/data-retention.md](reference/data-retention.md) — 数据保留、清理管道与账户删除级联
- [reference/assistant-safety.md](reference/assistant-safety.md) — 跨模块 AI 医疗红线与安全策略
- [explanation/architecture.md](explanation/architecture.md) — 跨模块心智模型与设计权衡(细节以 ADR 与代码为准)
- [howto/add-new-module.md](howto/add-new-module.md) — 新增 NestJS 模块
- [howto/deploy.md](howto/deploy.md) — 生产部署快速路径
- [howto/restore-database-backup.md](howto/restore-database-backup.md) — 数据库备份恢复演练
- [howto/run-medicine-import.md](howto/run-medicine-import.md) — 药品数据导入
- [howto/sync-openapi-client.md](howto/sync-openapi-client.md) — 导出 OpenAPI 并再生 Flutter 客户端

活跃延后项见 [../plans/backlog.md](../plans/backlog.md)(唯一 TODO 台账,条目完成即删行)。

## 模块 README 索引

模块意图、边界与陷阱以各模块 README 为准(与代码同址;进入模块前先读):

- 身份与账户:[auth](../src/modules/auth/README.md)、[account](../src/modules/account/README.md)、[user](../src/modules/user/README.md)、[user-settings](../src/modules/user-settings/README.md)、[user-health-context](../src/modules/user-health-context/README.md)、[audit-log](../src/modules/audit-log/README.md)
- 记录与建议:[daily-records](../src/modules/daily-records/README.md)、[assistant](../src/modules/assistant/README.md)、[today-suggestion](../src/modules/today-suggestion/README.md)、[today-analysis](../src/modules/today-analysis/README.md)、[reports](../src/modules/reports/README.md)、[health-events](../src/modules/health-events/README.md)、[data-export](../src/modules/data-export/README.md)
- 药品域:[medicines](../src/modules/medicines/README.md)、[medicine-dose-logs](../src/modules/medicine-dose-logs/README.md)、[medicine-reminders](../src/modules/medicine-reminders/README.md)
- 通知:[notifications](../src/modules/notifications/README.md)、[notification-preferences](../src/modules/notification-preferences/README.md)
- 基础设施与支撑:[app-info](../src/modules/app-info/README.md)、[environment](../src/modules/environment/README.md)、[files](../src/modules/files/README.md)、[legal-documents](../src/modules/legal-documents/README.md)、[product-events](../src/modules/product-events/README.md)、[testing-support](../src/modules/testing-support/README.md)、[data-retention](../src/modules/data-retention/README.md)、[src/common](../src/common/README.md)

## 生成物

`docs/reference/generated/openapi.json` 与 `docs/reference/generated/compodoc/` 分别由
`pnpm export:openapi` / `pnpm docs:compodoc` 产出,**禁止手改**;API 合同与模块/类图事实以生成物为准。
ADR 位于 [reference/adr/](reference/adr/README.md),只增不改,新决策写新文件。

## 归档

`archive/` 只进不出:被裁决淘汰的文档经 `git mv` 进入,信息不丢、可追溯,不参与链接完整性与
新鲜度校验。历史审计与一次性分析也落在这里,例如
[2026-08-31-doc-governance-audit.md](archive/2026-08-31-doc-governance-audit.md)。
