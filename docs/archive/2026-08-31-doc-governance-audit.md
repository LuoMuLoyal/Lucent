---
status: archived
owner: backend
quadrant: explanation
updated: 2026-08-31
---

# 2026-08-31 文档治理审计明细

**一次性分析,只进不出。** 本文件是 plans/2026-08-31-doc-governance-overhaul-plan.md Phase 0
逐篇四问审计(谁读 / 读完做什么 / 断言由谁承接 / 裁决)的完整明细,随 2026-08-31 docs 重建
落档,此后不再更新;裁决词汇为六向处置:生成消除 / 结构固化 / 测试承接 / 独立归宿 /
前移编码时刻 / 降级快照,落档列写执行形态(归档 / 下沉目标模块 / 保留新路径 / 生成消除)。

## 本批归档(28 篇)

清单即本批 `git mv` 进入 `docs/archive/` 的文档(legacy-\* 前缀为更早已归档文档的改名,不重复审计)。

| 文档(archive 现名)                                                    | 读者                 | 读完做什么                    | 断言承接                                                      | 裁决                                                                           |
| --------------------------------------------------------------------- | -------------------- | ----------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Active_Product_Loop.md                                                | 验证产品闭环状态的人 | 核对健康事件/稀疏记录语义现状 | specs + e2e + openapi.json                                    | 归档                                                                           |
| Notification_Preferences.md                                           | 维护通知偏好的人     | 理解偏好门控与返回形态        | src/modules/notification-preferences/README.md + openapi.json | 下沉 notification-preferences 后归档                                           |
| README.md(原 contracts/README)                                        | 前后端对接者         | 找到 API 合同边界             | docs/README.md 索引 + generated/openapi.json                  | 导航并入 docs/README.md 后归档                                                 |
| app-info-contract.md                                                  | 前端对接者           | 对齐 /public/app-info 字段    | generated/openapi.json                                        | 下沉 app-info 后归档                                                           |
| assistant-capabilities.md                                             | 前端对接者           | 渲染能力发现 UI               | generated/openapi.json + src/modules/assistant/README.md      | 下沉 assistant 后归档                                                          |
| assistant-contract.md                                                 | 前端对接者           | 实现助手 SSE/会话/确认流      | generated/openapi.json + assistant/README + e2e               | 模块部分下沉 assistant/README、AI 分层规则并入 explanation/architecture 后归档 |
| assistant-rollout.md                                                  | 发布决策者           | 掌握灰度/回滚状态             | 迁移日志 + 运行配置                                           | 并入 assistant/README 后归档                                                   |
| CHANGELOG.md                                                          | 所有人               | 查版本历史                    | docs/logs/migration-log/(按日账本)                            | 归档(0.1.0 发布时脚本重建)                                                     |
| code-quality.md                                                       | 贡献者               | 写符合约定的代码              | AGENTS.md 错误处理规则 + eslint-plugins(error-handling/\*)    | 归档(约束前移编码时刻)                                                         |
| CONTEXT.md                                                            | AI/新人入口读者      | 建立项目上下文                | AGENTS.md + ADR-0012                                          | 归档(纯重复 ADR-0012 词汇)                                                     |
| data-export-contract.md                                               | 前端对接者           | 实现导出状态轮询              | generated/openapi.json + data-export/README                   | 下沉 data-export(reports 小节→reports/README)后归档                            |
| data-sources.md                                                       | 药品导入维护者       | 选择导入策略与数据源边界      | src/modules/medicines/README.md + scripts/import              | 下沉 medicines 后归档                                                          |
| data-sources-cn-products.md                                           | 同上                 | 构建 CN 主文件                | DrugDataBase 构建脚本                                         | 下沉 medicines 后归档                                                          |
| data-sources-drugbank.md                                              | 同上                 | 导入 DrugBank 数据集          | 同上                                                          | 下沉 medicines 后归档                                                          |
| data-sources-food-composition.md                                      | 占位                 | —                             | scripts/import/food 导入脚本                                  | 归档(12 行占位,无实质内容)                                                     |
| data-sources-medical-qa.md                                            | Assistant 检索维护者 | 理解 QA 语料边界              | assistant/README + ADR-0008                                   | 下沉 assistant 后归档                                                          |
| environment-contract.md                                               | 环境模块维护者       | 对齐 /environment 契约        | generated/openapi.json + environment/README                   | 下沉 environment 后归档                                                        |
| environment.md                                                        | 搭建本地环境的人     | 起本地栈、查脚本基线          | reference/environment-variables.md(合并后)                    | 并入 environment-variables.md 后归档                                           |
| event-catalog.md                                                      | 事件发布/消费开发者  | 查事件与订阅矩阵              | src/common/events/domain-events.ts + 各 listener spec         | 归档(模式一段并入 explanation/architecture)                                    |
| how-to-README.md                                                      | 指南导航读者         | 选对操作指南                  | docs/README.md 存活文档清单                                   | 并入 docs/README.md 后归档                                                     |
| 02-logs-README.md                                                     | 日志读者             | 查日志写作规则                | AGENTS.md 迁移日志规则                                        | 归档                                                                           |
| mine-settings-contract.md                                             | 前端对接者           | 对齐用户设置接口              | generated/openapi.json + user-settings/README                 | 下沉 user-settings(extras→user-health-context/README)后归档                    |
| reminder-contract.md                                                  | 前端对接者           | 实现提醒与打卡                | generated/openapi.json + medicine-reminders/README            | 下沉 medicine-reminders(偏好→notification-preferences/README)后归档            |
| ROADMAP.md                                                            | 规划读者             | 查路线图                      | plans/ 台账                                                   | 归档(严重失实:Security PIN/Prometheus/队列数均过时)                            |
| superpowers-plans-2026-08-22-error-contract-closeout-plan.md          | 实施者               | 执行错误契约收口              | ADR-0012 + 迁移日志 2026-08-22/23                             | 归档(已实施)                                                                   |
| superpowers-specs-2026-08-22-domain-failure-result-boundary-design.md | 实施者               | 实现 Result 边界              | problem-catalog.spec + ADR-0012                               | 归档(已实施)                                                                   |
| superpowers-specs-2026-08-22-error-contract-closeout-design.md        | 实施者               | 同上                          | 同上                                                          | 归档(已实施)                                                                   |
| toolchain.md                                                          | 贡献者               | 查工具链与 CI                 | package.json scripts + .github/workflows                      | 归档(事实源=package.json/CI)                                                   |

## 保留新路径(13 篇)

| 文档(原路径)                          | 读者          | 读完做什么             | 断言承接                      | 裁决                                                           |
| ------------------------------------- | ------------- | ---------------------- | ----------------------------- | -------------------------------------------------------------- |
| docs/README.md                        | 所有人        | 找到一切文档           | —                             | 保留并重写为唯一索引                                           |
| docs/Glossary.md                      | 所有人        | 对齐术语               | —                             | 保留 → reference/glossary.md                                   |
| 01-reference/architecture.md          | 跨模块开发者  | 建立心智模型           | ADR + 代码                    | 保留 → explanation/architecture.md(删数字快照)                 |
| 01-reference/data-retention.md        | 后端/合规读者 | 理解保留与删除语义     | data-retention.service + 测试 | 保留 → reference/data-retention.md                             |
| 01-reference/deployment.md            | 运维读者      | 理解部署模型           | deploy/ 脚本 + compose        | 保留 → reference/deployment.md(删一次性验收段)                 |
| 01-reference/environment-variables.md | 后端/运维读者 | 查环境变量与运行时基线 | src/config/env、yaml-loader   | 保留 → reference/environment-variables.md(吸收 environment.md) |
| contracts/assistant-safety.md         | AI/产品读者   | 守住医疗红线           | LlmSafetyPolicyService + 测试 | 保留 → reference/assistant-safety.md                           |
| how-to/add-new-module.md              | 贡献者        | 新增模块               | 脚手架 + AGENTS.md            | 保留 → howto/add-new-module.md                                 |
| how-to/deploy.md                      | 运维读者      | 快速部署               | CI workflows                  | 保留 → howto/deploy.md                                         |
| how-to/restore-database-backup.md     | 运维读者      | 恢复演练               | backup.sh + deploy.ts         | 保留 → howto/restore-database-backup.md                        |
| how-to/run-medicine-import.md         | 数据维护者    | 运行导入               | scripts/import                | 保留 → howto/run-medicine-import.md                            |
| how-to/sync-openapi-client.md         | 前后端对接者  | 再生客户端             | export:openapi 脚本           | 保留 → howto/sync-openapi-client.md                            |
| 00-current/TODO.md                    | 维护者        | 跟踪延后项             | —                             | 保留 → plans/backlog.md(硬生命周期,完成即删)                   |

## 生成消除(2 类)

| 对象              | 读者         | 读完做什么  | 断言承接                 | 裁决                                                |
| ----------------- | ------------ | ----------- | ------------------------ | --------------------------------------------------- |
| docs/openapi.json | 前后端对接者 | 查 API 合同 | pnpm export:openapi 产出 | 生成消除 → reference/generated/openapi.json(禁手改) |
| docs/compodoc/    | 贡献者       | 查模块/类图 | pnpm docs:compodoc 产出  | 生成消除 → reference/generated/compodoc/(禁手改)    |

## 汇总

- 存活文档面:12 篇(README + explanation/architecture + reference 5 篇 + howto 5 篇),
  较 38 篇基线压缩 68%,达成 -50% 硬目标;plans/backlog.md 为规划台账不计存活面。
- 被归档/下沉断言 100% 有承接:specs、openapi.json、compodoc、模块 README、ADR、
  eslint-plugins、迁移日志。
- 本文件随归档批次整体落档,后续裁决变更写新审计文件,不改本文件。
