# Lucent Migration Log

Last updated: 2026-07-17

Records backend changes in date order. Detailed entries are split by date under
`docs/02-logs/migration-log/`.

## How To Update

- Add new entries to `docs/02-logs/migration-log/YYYY-MM-DD.md`.
- If a date file does not exist yet, create it with the title `# Migration Log - YYYY-MM-DD`.
- Add the new entry link to the active index below (newest first).
- Older entries are moved to `docs/03-archive/migration-log/`.
- Use concrete dates. Do not move old history back into this index.

## Active Entries

- [2026-07-17](../02-logs/migration-log/2026-07-17.md) — 部署加固：单 slot 停机部署 + 人工生产发布 + 告警通道 + 数据库备份 + SSE 优雅关闭 + CI 加固
- [2026-07-16](../02-logs/migration-log/2026-07-16.md) — 代码审查修复 + 五模块补充审查（IDOR）+ 数据库索引优化（GIN trigram）
- [2026-07-15](../02-logs/migration-log/2026-07-15.md) — 审查报告修复（TOCTOU 消除 / 通知白名单 / 分页 / OpenAPI 导出）
- [2026-07-14](../02-logs/migration-log/2026-07-14.md) — 7.14 审查报告改写为 Bug 修复计划文档（15 个 BUG 任务）
- [2026-07-12](../02-logs/migration-log/2026-07-12.md) — 历史兼容代码清理 + TypeScript 6.0.3 + Jest→Vitest 迁移 + Pino→Winston 迁移 + 套约测试/性能测试/安全测试 + 队列与缓存增强 + 文档与代码偏差修复
- [2026-07-11](../02-logs/migration-log/2026-07-11.md) — 审查修复 + 测试覆盖补全（15 个 spec 文件）+ 部署优化（Dockerfile/Compose/Nginx/Blue-Green）+ 法律文档管理 API
- [2026-07-10](../02-logs/migration-log/2026-07-10.md) — 审查修复 + 架构升级（LangGraph tool-loop + LLM 重试 + 队列工厂 + Repository 抽象 + JSONB Zod）+ E2E 测试缺口全量补齐 + 单元测试覆盖率补充
- [2026-07-09](../02-logs/migration-log/2026-07-09.md) — 配置化 + Auth Controller 拆分 + 水分目标 DB 持久化 + pre-push 钩子 + husky 残留清理
- [2026-07-08](../02-logs/migration-log/2026-07-08.md) — 7.8 审查修复 + Today analysis 主动建议通知 + Medicine dose log Phase 2 + OpenAPI 合同修复 + 生成物边界治理 + Git 钩子轻量化
- [2026-07-07](../02-logs/migration-log/2026-07-07.md) — 审查修复（超时配置 / 错误处理工具 / DTO 边界防御 / 测试覆盖率补充）
- [2026-07-06](../02-logs/migration-log/2026-07-06.md) — 全项目模块结构重构 + 审查修复 + ROADMAP + 开源标准文件 + CHANGELOG
- [2026-07-05](../02-logs/migration-log/2026-07-05.md) — 审查修复（安全性 + 代码质量）+ Report Export PDF 增强 + 脚本目录重构 + package.json scripts 优化
- [2026-07-04](../02-logs/migration-log/2026-07-04.md) — Logger 升级到 Pino + 审查修复 + 目录结构规范化 + Prisma 客户端迁移 + AuthService 拆分 + AdminJS 拆分 + common 目录分层
- [2026-07-03](../02-logs/migration-log/2026-07-03.md) — Docs restructure + Assistant RAG / DrugBank closeout
- [2026-07-02](../02-logs/migration-log/2026-07-02.md) — Public contracts + meal-analysis read rules
- [2026-07-01](../02-logs/migration-log/2026-07-01.md) — Meal-analysis pipeline + today-analysis read matrix

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

## Archived Entries

Older entries are preserved in `docs/03-archive/migration-log/`.
