# AGENTS.md - Lucent

## Documentation Rules

文档按六向裁决处置，动笔前先归入其一：
① **生成消除**：能由 openapi/compodoc/测试断言产出的内容不再手写；
② **结构固化**：模块意图下沉到 `src/modules/<module>/README.md`（与代码同址，AI 按需读取）；
③ **测试承接**：可机器验证的断言归测试，文档归档；
④ **独立归宿**：决策→ADR、事实→迁移日志、规划→`plans/`；
⑤ **前移编码时刻**：规则改成 lint/AST 检查，而非文字约定；
⑥ **降级快照**：低频稳定叙事进 `docs/explanation/`（只减不增）。

布局（详见 `docs/README.md`，唯一索引）：`docs/explanation/`（为什么）、
`docs/reference/`（是什么，含 `adr/` 只增不改、`generated/` 生成物）、`docs/howto/`（怎么做）、
`docs/logs/migration-log/`（按日追加账本）、`docs/archive/`（归档只进不出）。

### Standing rules

- **Migration log**：每次代码变更向 `docs/logs/migration-log/YYYY-MM-DD.md` 追加当日条目。
  **永不覆写**已有内容——`pnpm docs:verify` 的 append-only 守卫报单个日志文件 diff 删除行 >5。
  - 单日文件只保留一个 `# ` H1；章节用 `##`（不加日期前缀）。
  - 引用计划文件时注明「实施完毕文件已删」，否则 `--verify` 报孤儿引用。
  - 条目描述变更范围与验证结论，不写需要持续同步的精确数字（如测试总数）。
- **生成物**：`docs/reference/generated/openapi.json` 与 `docs/reference/generated/compodoc/`
  由 `pnpm export:openapi` / `pnpm docs:compodoc` 产出，**禁止手改**。
- **ADR**（`docs/reference/adr/NNNN-title.md`）只增不改：新决策→新文件。
- **硬生命周期**：`plans/backlog.md` 是唯一 TODO 台账——延后项带上下文追加，完成即删行；
  计划执行完毕整体删除 `plans/*.md`；完成项一律直接删除，不留任何标记。
- **Front-matter**：`docs/reference/*.md` 与 `docs/howto/*.md` 必须带
  （`status: active|frozen|stale` / `owner: backend` / `quadrant: reference|howto|explanation` /
  `updated: YYYY-MM-DD`）；`explanation/` 无门禁（新鲜度仍由 git 时间兜底）。
  `--verify` 通报缺失块、>90 天未更新、`status: stale` 未归档、无读者活跃文档；
  `status: frozen` 豁免新鲜度检查。归档 = `git mv` 到 `docs/archive/` + `status: archived`。
- **工具**：`pnpm docs:check`（变更→文档映射**报告**，旧 pre-commit 门禁已退役，仅观察两周）、
  `pnpm docs:verify`（结构与新鲜度门禁 + append-only 守卫）、
  `pnpm docs:links`（链接完整性 + 路径存在性：docs 面、模块 README、plans/backlog 与根入口文档中
  的 `docs|src|plans|scripts|test|deploy|prisma/**` 路径记号必须真实存在）。
  文档变更不再被 pre-commit 阻断；推送前 `pre-push` 汇总 `lint:check + build + test:ci + arch:check`。

## Architecture Checks (arch:check)

`pnpm arch:check` 聚合三类观察期检查（全部 warn 不阻断；逐条评估后转 error，进度见
`plans/backlog.md`）：

- **依赖图**（dependency-cruiser，`.dependency-cruiser.cjs`）：模块间只准 barrel import
  （module 类直引对方 `.module.ts` 豁免）；跨模块 import 其他模块 `repositories/`、`dto/` 禁止；
  `src/common/**` 禁止 import `src/modules/**`；业务模块禁止直连 `ioredis`/`keyv`（走公共缓存封装）；
  controller 禁止 import `@prisma/client` 与 `src/prisma/**`。
- **代码模式**（`eslint.arch.config.ts`，独立 flat config，与主 lint 互不影响）：空 catch 块、
  service 层裸 `throw new Error`（ADR-0012 例外见下节）、`no-magic-numbers` 白名单、
  测试文件 `: any`。
- **AST 约定**（`scripts/hooks/check-ast-conventions.ts`）：DTO 每个实例属性至少一个 `@Is*`
  校验器；controller 端点鉴权姿态显式化（方法或类级 `@Public()` / `@UseGuards`）。
  加 `--strict` 时有告警则 exit 1（转 error 后启用）。

## Read First

- `README.md`, `CONTRIBUTING.md`, `docs/README.md`（文档唯一索引）
- `docs/explanation/architecture.md`（跨模块心智模型）、`docs/reference/environment-variables.md`（环境变量）
- `src/modules/<module>/README.md`（模块边界与契约）、`docs/reference/adr/`（架构决策）
- 功能实现细节以代码为准；历史状态文档归档在 `docs/archive/`

## Current Baseline

- NestJS 11, Prisma 7, PostgreSQL, Redis, JWT auth.
- Dev DB: `postgres/postgres@127.0.0.1:15432/lucent`. Test DB: `lucent/lucent_dev@127.0.0.1:5432/lucent`.
- Redis: `redis://127.0.0.1:6379`.
- Response: controllers return resources directly (no envelope); errors use RFC 9457
  Problem Details — [ADR-0012](docs/reference/adr/0012-error-contract-and-result-boundary.md).
  Health check: `GET /api/v1/health`.

## Working Rules

- API contract changed → `pnpm export:openapi`. Do not hand-write endpoint docs.
- Architecture/module structure changed → `pnpm docs:compodoc`.
- API docs UI at `/api/docs` via Scalar.
- Medicine import strategy changed → update `src/modules/medicines/README.md`.
- Significant architectural decision → create ADR in `docs/reference/adr/NNNN-title.md`.
- Localized backend copy: `AcceptLanguageResolver + I18nService` by default; `@I18nLang()` only
  when branching on locale for AI/prompt code.
- Fix the requested problem directly; do not loosen TS/ESLint rules or refactor nearby code.
- `pnpm typecheck` validates spec/e2e files too; `pnpm build` excludes `**/*spec.ts` and `test/`.
- e2e 约定：每个资源端点必须有「跨用户访问 → 404」用例；所有 list 端点必须有 limit 上限用例
  （沿 `test/` 既有 e2e 模板，新端点一并补齐）。

## Error Handling Rules (ADR-0012)

Enforced by ESLint custom rules `error-handling/no-bare-throw-error` and
`error-handling/no-silent-catch` (defined in `eslint-plugins/error-handling.ts`).

- **No bare `throw new Error()` in `src/`** (excluding `*.spec.ts`): use
  `throw new DomainFailureException(createDomainFailure({ ... }))` for domain
  failures, or NestJS `HttpException` subclasses for client errors.
  Module constructor / `onModuleInit` env-validation throws are exempt —
  `ApiExceptionFilter` is not ready during DI init; use `// eslint-disable-next-line`
  with a reason.
- **No silent catch**: every `catch` block must either log (`this.logger.warn` /
  `this.logger.error` / `console.warn`) or re-throw the error.
  Deferred-error patterns (catch → store in variable → handle later) must use
  `// eslint-disable-next-line error-handling/no-silent-catch` with a reason.
- **Cache calls must be protected**: `this.cache.get/set/del` must be wrapped
  in try-catch with a logged fallback. The only exception is `testing-support/`.
- **Control-flow exceptions** (`throw new Error('CONSTANT')` used to break
  loops) are a code smell — refactor to return a discriminated union instead.
  If unavoidable, add `// eslint-disable-next-line` with a reason.

## File Naming Rules

**Core principle**: File name = responsibility, not location. Directory = namespace,
file name = WHAT it does.

NestJS framework suffixes (`.service.ts`, `.controller.ts`, `.module.ts`, `.dto.ts`, etc.)
**stay** — they are CLI-generated and expected by the framework.

1. **No module-name prefix on files inside the module.**
   - ❌ `legal-documents/services/legal-documents.service.ts` → ✅ `documents.service.ts`
2. **Module root files keep the module name** (CLI convention).
   - ✅ `legal-documents/legal-documents.controller.ts`, `legal-documents.module.ts`
3. **Never use a bare type word** (`service.ts`, `types.ts`, `constants.ts`). Add a business word.
4. **Sub-topic prefixes are fine** — `meal-analysis.constants.ts` is correct (`meal-analysis` is
   a sub-topic, not the module name `daily-records`).
5. **Sub-directory name prefix is redundant.**
   - ❌ `services/explanation/explanation-queue.service.ts` → ✅ `services/explanation/queue.service.ts`
6. **Class names are unaffected** — NestJS DI resolves by class name, not file name.
7. **Spec files follow their source** — co-located, renamed in lockstep.
8. **Domain sub-directories** when `services/` or `tools/` exceeds 8 files spanning 2+ areas.

## Barrel Exports

- Each module has a single `index.ts` at the module root that explicitly exports
  the module's public API (services in `@Module().exports`, cross-module DTOs,
  types, decorators, guards). Use `export { X } from './path'` — never `export *`.
- No sub-directory barrels (`services/index.ts`, `dto/index.ts`, etc.) —
  sub-directories are internal namespaces, not export surfaces.
- Cross-module imports go through the module root barrel:
  - ❌ `import { XxxService } from '../auth/services/account.service';`
  - ✅ `import { XxxService } from '../auth';`
- Within a module, use deep-path imports:
  - ❌ `import { XxxService } from './services';`
  - ✅ `import { XxxService } from './services/account.service';`
- Module classes (`XxxModule`) are imported directly from the `.module.ts` file,
  not through the barrel, to avoid circular dependencies.

## Module Subdirectory Whitelist

**Standard**: `controllers/`, `services/`, `decorators/`, `filters/`, `guards/`, `interceptors/`,
`pipes/`, `middleware/`, `tests/`, `dto/`, `entities/`, `enums/`, `types/`, `constants/`,
`prompts/`, `schemas/`, `strategies/`.

**Extended** (with review): `providers/`, `adapters/`, `cache/`, `utils/`, `agent/`, `dashboard/`,
`tools/`.

**Special** (root-level only): `migrations/`, `config/`, `common/`, `prisma/`, `i18n/`.

## Root `common/` Conventions

- No scattered files at `common/` root — every file lives in a role-based sub-directory.
- Role-based subdirectories: `api/`, `helpers/`, `services/`, `logger/`, `llm/`, `queue/`,
  `metrics/`, `events/`, `storage/`, `types/`, `filters/`, `interceptors/`, `middleware/`,
  `constants/`, `validators/`.
- Files needing Nest DI (`@Injectable()`, module wiring) should not live in `helpers/`.
- `common/index.ts` is the single barrel; no sub-directory barrels.

## Module Export Rules

- Export a service from `@Module` `exports` **iff** another module directly imports and uses it.
- Mapper services: `mapper.service.ts`. Ownership services: `ownership.service.ts`.
- Cross-module data access governed by [ADR-0009](docs/reference/adr/0009-cross-module-data-access.md):
  cross-module writes via owning module's exported service; cross-module reads on soft-delete
  models use shared `nonDeleted` helper.
