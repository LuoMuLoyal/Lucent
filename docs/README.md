# Lucent Docs

Lucent NestJS 后端的文档库。**活跃文档最小化**——只有会被 AI 或人读取的文档才保留，
实现状态以代码为准，历史状态归档在 `03-archive/`。

## 导航

- 改代码前必读：[[01-reference/architecture]]、[[01-reference/environment]]、
  [[01-reference/environment-variables]]、[[01-reference/contracts/README]]、[[01-reference/adr/README]]
- 操作指南：[[01-reference/how-to/README]]
- 变更历史：`02-logs/migration-log/`（按日期排序）
- 活跃延后项：[[00-current/TODO]]
- 术语表：[[Glossary]]

## 文档边界

- `01-reference/architecture.md` — 模块依赖、AI 管道、路由、DB 约定、可观测性
- `01-reference/environment.md` — 本地环境、Docker、脚本与运行时基线
- `01-reference/environment-variables.md` — 环境变量完整参考（唯一事实源）
- `01-reference/deployment.md` — 生产部署手册
- `01-reference/toolchain.md` — 工具链、OpenAPI 导出、CI、hooks
- `01-reference/code-quality.md` — 代码质量与可维护性约定
- `01-reference/adr/` — 架构决策记录
- `01-reference/contracts/` — 前后端 API 边界（Luminous 引用）
- `01-reference/how-to/` — 操作指南
- `00-current/TODO.md` — 活跃延后项（完成后删除条目）
- `02-logs/README.md` — 变更日志索引与主题导航
- `openapi.json` — 生成产物（`pnpm export:openapi`，禁止手改）

## 文档生命周期

- 新增文档前先问：**谁会读它？多久更新一次？** 若回答是「没人读」或「不会更新」，归档而不是新增。
- 活跃文档超过 90 天未更新：`node scripts/hooks/check-docs-updated.ts --verify` 会报警，审阅后
  更新或归档到 `03-archive/`。
- 未被 `docs/doc-map.yaml` 引用的活跃文档：`--verify` 报警「无读者」，归档。
- 归档：`git mv` 到 `03-archive/`，信息不丢、可追溯；归档文档不参与覆盖校验。
- 变更记录只写 `02-logs/migration-log/YYYY-MM-DD.md`（单日文件一个 H1，章节用 `##`）。

## 覆盖校验

`docs/doc-map.yaml` 是映射规则的唯一事实源（本文件不再维护手工映射表）。运行
`pnpm docs:check` 查看当前变更需要更新哪些文档；pre-commit hook 阻断「代码变更但零文档」的提交。
