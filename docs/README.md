# Lucent Docs

Lucent NestJS 后端的文档 vault。本目录是后端运行时、部署、生成合同和共享数据合同的权威来源。

## 快速导航

- [[00-current/Current_State]] — 当前后端实现状态入口（索引页）
- [[00-current/TODO]] — 活跃延后项
- [[00-current/MigrationLog]] — 变更日志索引

## 文档覆盖校验

`docs/doc-map.yaml` 定义了代码路径到期望文档的映射。`scripts/hooks/check-docs-updated.ts`
读取该映射并提供两种模式：

- **`pnpm docs:check`**（warning-only）：扫描工作区变更，输出每条规则中未被触及的文档列表，不阻断。
- **pre-commit hook**（blocking）：`src/**/*.ts` 源文件已暂存但无 `docs/` 文件暂存时阻断提交。
  旁路：`SKIP_DOC_CHECK=1` 或 `git commit --no-verify`。
- [[01-reference/architecture]] — 模块依赖、AI 管道、路由、数据库约定
- [[01-reference/environment]] — 本地环境、Docker 与快速命令总览
- [[01-reference/environment-variables]] — 环境变量参考
- [[01-reference/deployment]] — 生产部署手册
- [[01-reference/adr/README]] — 架构决策记录
- [[01-reference/how-to/README]] — 操作指南
- `01-reference/contracts/*.md` — 公共合同边界
- `openapi.json` — 生成的 API 合同

## Obsidian 用法

1. 在 Obsidian 中选择「打开本地仓库」。
2. 选择 `Lucent/docs/` 作为 vault 根目录。
3. 新建笔记默认保存在 `00-current/`。

## 归档策略

- 旧计划和已完成决策归档到本仓库 `docs/03-archive/`（当前后端暂无活跃归档文件）。
- 活跃文档完成后应直接删除，不留 `✅` 或 `DONE` 标记。

## 文档边界

- `01-reference/environment.md`
  - Responsibility: Local stacks, Docker, scripts, runtime notes, and quick commands
  - Do not put here: Detailed environment variable reference (use `environment-variables.md`)
- `01-reference/environment-variables.md`
  - Responsibility: Required and optional environment variable reference
  - Do not put here: Docker or local stack setup steps
- `01-reference/deployment.md`
  - Responsibility: Single-source production deployment runbook, directory layout, and checks
  - Do not put here: General env variable explanations
- `01-reference/architecture.md`
  - Responsibility: Module dependency graph, AI pipeline architecture, route architecture, DB
    conventions
  - Do not put here: Implementation status or task logs
- `openapi.json`
  - Responsibility: Generated API contract from `pnpm export:openapi`
  - Do not put here: Manual edits
- `compodoc/`
  - Responsibility: Generated NestJS architecture docs from `pnpm docs:compodoc`
  - Do not put here: Manual edits
- `01-reference/contracts/data-sources.md`
  - Responsibility: Data source index/overview and cross-source strategy
  - Do not put here: Detailed source mapping (use `data-sources-cn-products.md`,
    `data-sources-drugbank.md`, `data-sources-medical-qa.md`, `data-sources-food-composition.md`)
- `01-reference/contracts/reminder-contract.md`
  - Responsibility: Reminder/notification backend-vs-device boundary
  - Do not put here: UI implementation details
- `01-reference/contracts/environment-contract.md`
  - Responsibility: Environment snapshot API boundary
  - Do not put here: More-tab or generic utility plans
- `01-reference/contracts/mine-settings-contract.md`
  - Responsibility: Mine/Settings API overview and user settings
  - Do not put here: Support resources, app info, or data-export details (use their own contract
    files)
- `01-reference/contracts/support-resources-contract.md`
  - Responsibility: Public support resource entries
- `01-reference/contracts/app-info-contract.md`
  - Responsibility: App metadata endpoint
- `01-reference/contracts/data-export-contract.md`
  - Responsibility: Data export request flow
- `01-reference/contracts/assistant-contract.md`
  - Responsibility: Assistant contract overview, boundaries, routes, and conversation/streaming
    contracts
  - Do not put here: Capability/tool details (use `assistant-capabilities.md`), safety policy (use
    `assistant-safety.md`), or rollout truth (use `assistant-rollout.md`)
- `01-reference/contracts/assistant-capabilities.md`
  - Responsibility: Assistant capability shape, tools, envelopes, and proposals
- `01-reference/contracts/assistant-rollout.md`
  - Responsibility: Assistant rollout/runtime truth
- `01-reference/contracts/assistant-safety.md`
  - Responsibility: Assistant AI safety policy
- `00-current/TODO.md`
  - Responsibility: Active deferred backend follow-up items
  - Do not put here: Historical changelog narrative
- `00-current/MigrationLog.md`
  - Responsibility: Date-based change history index; entries live in
    `02-logs/migration-log/YYYY-MM-DD.md`
  - Do not put here: Current-state facts or future plans
- `01-reference/adr/`
  - Responsibility: Architecture Decision Records for significant technical choices
  - Do not put here: Implementation details or task logs
- `01-reference/contracts/README.md`
  - Responsibility: Public contracts directory boundary and usage rules
  - Do not put here: Individual contract content

## Admin Panel

`/admin` is powered by AdminJS with the `@sergiyiva/adminjs-prisma` adapter. Resources are
generated automatically from `prisma/schema.prisma` at runtime, so adding a new Prisma model and
regenerating the client is enough to surface it in the admin panel. Model-specific overrides
(navigation group, list/show/filter fields, hidden fields, title property, sort order, enum
picklists) are declared in `src/admin/adminjs.setup.ts`.

By default every resource supports full CRUD. Sensitive scalar fields such as `passwordHash`,
`refreshTokenHash`, `pushToken`, and `rawProfile` are hidden, and all relation fields are hidden so
only foreign-key scalars are exposed in forms.

Product direction and current product state are owned by the workspace path `Luminous/docs/`.

## Update Map

运行 `pnpm docs:check` 查看当前变更需要更新哪些文档。以下为手动参考：

- Environment variables, local Docker, scripts, runtime baseline
  - Update: `01-reference/environment.md` and root `README.md`
- Production deployment procedure or server directory layout
  - Update: `01-reference/deployment.md`
- Production deploy asset layout under repo `deploy/`
  - Update: `01-reference/deployment.md` and root `README.md`
- Medicine import behavior or source-table strategy
  - Update: `01-reference/contracts/data-sources.md`
- Reminder schedule/preference contract
  - Update: `01-reference/contracts/reminder-contract.md`
- Environment snapshot contract
  - Update: `01-reference/contracts/environment-contract.md`
- Mine/Settings contract
  - Update: `01-reference/contracts/mine-settings-contract.md`
- Assistant capability / permission contract
  - Update: `01-reference/contracts/assistant-contract.md`
- AI generator / policy / service abstraction or safety rules
  - Update: `01-reference/contracts/assistant-contract.md`
- Deferred backend follow-up list
  - Update: `00-current/TODO.md`
- Lucent API code
  - Action: Run `pnpm export:openapi` and commit `docs/openapi.json`
- Backend architecture / module structure change
  - Action: Run `pnpm docs:compodoc` to regenerate architecture docs
- Module dependency, AI pipeline, route, or DB convention change
  - Update: `01-reference/architecture.md`
- AdminJS panel resources / CRUD permissions
  - Update: `README.md` admin panel paragraph and `src/admin/adminjs.setup.ts`
- Significant architectural decision
  - Action: Create an ADR in `01-reference/adr/NNNN-title.md`
- Public contract boundary (non-goals, capability scope) changes
  - Update: `01-reference/contracts/README.md` and the relevant `01-reference/contracts/*.md` contract
- Any backend code change
  - Update: Today's `02-logs/migration-log/YYYY-MM-DD.md`

## Relationship With `Lumos-docs`

`Lumos-docs/` is a separate showcase documentation site. It mirrors content from `Lucent/docs/` and
`Luminous/docs/` for browsing convenience, but it **is not the source of truth** and is updated
more slowly than the repo docs.

- Treat `Lucent/docs/` and `Luminous/docs/` inside each repo as the authoritative reference.
- Do not edit `Lumos-docs/` copies by hand to keep them "in sync"; the site should consume repo
  docs through its build pipeline.
- If you find a discrepancy, trust the repo-local doc and open a site ingestion issue instead of
  patching the mirror.

## Docs Governance

- **Single source of truth**: glossary lives in [[Glossary]], environment variables in
  [[01-reference/environment-variables]], assistant boundaries in `01-reference/contracts/assistant-contract.md`,
  data sources in `01-reference/contracts/data-sources.md`.
- **Active docs ≤ 250 lines**: split long docs into focused sub-files and link them.
- **Prefer links over duplication**: state a rule once and reference it elsewhere.
- **Use lists instead of tables**: reserve tables for side-by-side comparisons only.

## Rules

- Do not maintain hand-written endpoint docs or API mock documents.
- Do not edit `openapi.json` manually.
- Active repo-local execution plans belong in `Lucent/plans/`; move durable decisions into the
  owning docs after completion, then delete the plan file.
- Keep old implementation plans out of active docs after their decisions move into the owning
  document.
- **When a follow-up item in `00-current/TODO.md` is completed, delete it from
  `00-current/TODO.md`; do not mark it complete there.** Move the resulting current-state facts to
  `Luminous/docs/00-current/Current_State.md`, record the change in the daily
  `Luminous/docs/03-logs/migration-log/YYYY-MM-DD.md`, and also record the completion in today's
  `Lucent/docs/02-logs/migration-log/YYYY-MM-DD.md` as cross-repo sync evidence.
- Repo helper scripts under `scripts/` and `deploy/` are not part of the Nest app ESLint surface;
  validate them by running the relevant command instead of forcing app-only lint rules onto opened
  tool files.
