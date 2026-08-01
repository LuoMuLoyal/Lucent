# Lucent 变更日志

后端变更记录按日期归档。详细条目见 `migration-log/` 目录（按日期排序），新变更追加当日文件。

## How To Update

- 新变更追加到 `docs/02-logs/migration-log/YYYY-MM-DD.md`（文件不存在则创建，标题 `# Migration Log - YYYY-MM-DD`）。
- 单日文件只保留一个 H1，章节用 `##`（不带日期前缀）。
- 引用计划文件时注明「经 spec/plans 流程执行，实施完毕文件已删」。
- 不维护手工条目索引——完整历史由文件名日期排序承担。

## Quick Navigation by Topic

Major changes grouped by area:

- **Auth / Security** (OAuth, Security PIN, rate limit, JWT)
  - Key Dates: 07/04, 07/05, 07/08, 07/09, 07/10, 07/12
- **AI Pipeline** (Assistant runtime, today-analysis, meal-analysis, LLM)
  - Key Dates: 07/01, 07/04, 07/07, 07/08, 07/09, 07/10, 07/12
- **Medicine** (dose logs, reminders, knowledge base, RAG)
  - Key Dates: 07/03, 07/08, 07/11
- **Report / Export** (dashboard, PDF, clinic summary)
  - Key Dates: 07/05, 07/10, 07/12
- **Infrastructure** (logger, Prisma, AdminJS, common/ structure, env config, deployment)
  - Key Dates: 07/04, 07/05, 07/06, 07/11, 07/12
- **Code Quality** (审查修复, DTO validation, retry utils, test coverage)
  - Key Dates: 07/04, 07/05, 07/06, 07/07, 07/08, 07/09, 07/10, 07/11, 07/14
- **CI / Tooling** (git hooks, scripts, package.json, GitHub Actions)
  - Key Dates: 07/05, 07/06, 07/08, 07/11, 07/12
- **OpenAPI** (export, contract fixes, generated client boundary)
  - Key Dates: 07/04, 07/08
- **Docs / Governance** (ROADMAP, CHANGELOG, open-source files, architecture)
  - Key Dates: 07/03, 07/04, 07/06, 07/12
- **Testing** (Vitest migration, contract/security/performance tests, E2E coverage)
  - Key Dates: 07/10, 07/11, 07/12

## 归档

旧条目归档在 `docs/03-archive/migration-log/`。
