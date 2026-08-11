---
status: active
owner: backend
quadrant: reference
updated: 2026-08-11
---

# Toolchain / Contract

Last updated: 2026-08-11

- Local backend toolchain baseline is Node.js `24.x` plus pnpm `11.x`; CI and Corepack docs pin the
  recommended baseline to `11.9.0`.
- local `docs/openapi.json` remains the exported backend contract artifact that Luminous
  regenerates its `generated/lucent_api/` client from.
- The current exported contract now includes meal-analysis read hot fields on `DailyRecordItemDto`:
  status, coverage, updated-at, failure-reason, short-description, and top-foods.
- Health-event association fields on daily records and dose logs are implemented in Lucent first;
  `docs/openapi.json` and the Luminous generated Flutter client were regenerated during the
  Health Event Contract workstream. Live PostgreSQL acceptance remains a separate gate.
- Proactive Suggestion Runtime Task 4 moves suggestion pipeline execution into the bounded
  recompute worker. `GET /today/suggestions` reads materialized/cache state only and exposes
  `materializationStatus`, `sourceVersion`, `computedAt`, and `retryAfterSeconds`; after a
  source-version race the worker follows up at most three times. Persisted active cards also
  carry `sourceVersion`, and old-version writes are fenced from newer materializations.
- Proactive Suggestion Runtime Task 6 aligns reminder-contract documentation with the slot
  evaluator: dose-log reader facts include `reminderId`, and the collector resolves reminder
  local time before the suggestion pipeline evaluates overdue status. This is an internal
  read-model change; it does not require an OpenAPI export or Flutter client regeneration.
- Sparse Record Semantics medication slots extend that internal read model through Report
  context/computation: reminder slot coverage is observed separately from temporary dose logs.
  Task 6 now exposes the coverage-aware observed metric schema through OpenAPI; regenerate the
  Flutter client after each contract export, then let the domain mapper consume the new object.
- Lucent CI is split into three parallel Jobs (`ci-lint-typecheck`, `ci-unit`, `ci-e2e`) plus a
  Docker Job. The `ci-e2e` Job runs `Build` then `openapi:export` (reusing `dist/`, no double
  build) before E2E tests to ensure the contract file matches the current code. The file is
  tracked in git (marked as `linguist-generated`), so the export step overwrites the committed
  copy with a fresh build during CI.
- `pnpm openapi:export` is a standalone script that only runs the OpenAPI export node script;
  `pnpm export:openapi` is the full pipeline (`prisma:generate && build && openapi:export`).
  The export script sets `OPENAPI_EXPORT_SKIP_DB_CONNECT` and `OPENAPI_EXPORT_SKIP_REDIS` so
  contract generation does not require local PostgreSQL or Redis; the latter also overrides
  any `REDIS_URL` loaded from the development env file and keeps cache, throttler, and BullMQ
  providers in their in-memory/disabled modes.
- ESLint uses `eslint-config-prettier` (not `eslint-plugin-prettier`) — Prettier formatting is
  enforced by the standalone `pnpm format:check` command and `lint-staged` in pre-commit.
- CI caches the `.swc` directory across runs via `actions/cache`.
- `cancel-in-progress` is enabled for PR events (disabled for push events).
- `.swcrc` target is `es2023`, aligned with `tsconfig.json`.
- `tsconfig.json` specifies `tsBuildInfoFile: ./node_modules/.cache/tsbuildinfo.json`.
- `pre-push` git hook runs only `pnpm typecheck` (lint is handled by pre-commit `lint-staged`).
- Vitest coverage thresholds: branches 68 / functions 78 / lines 80 / statements 79
  (actual: 73/83/85/84, measured 2026-07-29).
- `.node-version` file pins Node.js `24` for nvm/fnm/volta.
- `vitest.e2e.config.ts` is a standalone `defineConfig` (not `mergeConfig` with the base config)
  to prevent `include` array concatenation from pulling unit tests into the E2E run.
- `pnpm prisma:generate` now also transpiles `generated/prisma/internal/*.ts` to `.js` via `@swc/core`
  `transformFile` (replaced `typescript.transpileModule` for ~2–3× speedup), because Prisma 7's
  custom-output client currently leaves those runtime files missing while `client.js` still requires
  them for `pnpm build`, `pnpm export:openapi`, and other compiled-runtime flows.
- `package.json` now includes a `postinstall` hook that runs `pnpm prisma:generate`, ensuring the
  Prisma client (with the `.js` fix) is always generated after `pnpm install`. The `export:openapi`
  script also depends on `pnpm prisma:generate` as a belt-and-suspenders safeguard.
- Lucent CI PostgreSQL now runs on `pgvector/pgvector:pg18`, matching the documented
  extension-capable local baseline instead of validating against plain Postgres.
- `pnpm typecheck:tools` now type-checks `scripts/` and `deploy/` under the same decorator-capable
  baseline as the Nest app, so tool imports of Nest services no longer fail on stripped decorator
  settings.
- Lucent runtime, Prisma CLI, and local import scripts now parse environment variables in a unified
  priority order: `.env.<NODE_ENV>.local` → `.env.<NODE_ENV>`, with no root `.env` fallback.
- OpenAPI contract fully fixed: all `nullable: true` DTO fields now have explicit `type` annotations,
  eliminating the P0 crash (`int.toJson is not a function`) and P1 type loss (`dynamic`) in the
  Flutter generated client. SSE stream endpoints have `text/event-stream` content annotations, and
  the `/clear` endpoint has a named response DTO.
- SSE event names and payload sequencing are runtime semantics rather than generated OpenAPI fields:
  Assistant uses `chunk → result → done` (or `error`), while Today Analysis and Reports use
  `summary → result → done` (or `error`). Changes to those event contracts require updating
  the corresponding controller, client parser, and assistant contract documentation together.
- **文档覆盖校验**：`scripts/hooks/check-docs-updated.ts` 读取 `docs/doc-map.yaml` 映射规则，
  提供两种模式：
  - `pnpm docs:check`（`--warning-only`）：扫描工作区变更，输出每条规则中未被触及的文档列表，不阻断。
  - Pre-commit hook（blocking，`simple-git-hooks`）：`src/**/*.ts` 源文件已暂存但无 `docs/` 文件
    暂存时阻断提交。旁路：`SKIP_DOC_CHECK=1` 或 `--no-verify`。
- **stack-trace override**（2026-07-22）：`pnpm-workspace.yaml` 新增 `overrides.stack-trace: 0.0.10`，
  修复 `winston@3.19.0` 依赖的 `stack-trace@0.0.1` 缺少 `parse()` 函数导致异常处理器二次崩溃的问题。
- **Body parser 冲突修复**（2026-07-22）：`main.ts` 的 `NestFactory.create` 新增 `bodyParser: false`，
  `setup-app.ts` 手动注册 JSON content-type parser。原因：`@adminjs/fastify` 的 `buildAuthenticatedRouter`
  内部注册 `@fastify/formbody`（urlencoded parser），与 NestJS 默认 parser 冲突，在 Node.js v24 下
  导致 `FastifyError: Content type parser already present`。
- **docs 钩子脚本根目录解析**（2026-08-03）：`scripts/hooks/check-links.ts` 与
  `scripts/hooks/check-docs-updated.ts` 均通过 `git rev-parse --show-toplevel` 显式解析仓库根目录
  （非 git 环境回退 `process.cwd()`），支持从任意子目录调用，不再隐式依赖调用目录。
- **docs 链接检查围栏识别**（2026-08-03）：`check-links.ts` 的 `isLineInFence` 同时识别
  反引号三连与波浪线三连两种围栏起始符，波浪线围栏或缩进代码块内的链接样文本不再被误判为断链。
- **Prisma 升级**（2026-08-03）：`prisma` / `@prisma/client` / `@prisma/adapter-pg` 升至 `^7.9.1`，
  `@prisma/internals` 精确升至 `7.9.1`，修复 7.8.0 的确定性 EEXIST bug（任何 `prisma generate` 均失败）。
  注意：本次安装因 npmmirror 未同步 `find-my-way@9.7.0`（`@prisma/dev` 传递依赖）改走官方源，
  项目 registry 配置未变。
- **队列加固**（2026-08-03，按 `plans/2026-08-01-queue-service-hardening.md` 修订版实施，
  计划实施完毕文件已删）：
  - `enqueueOrFallback` 增加 `queueName` 参数并对 enqueue 包 try-catch（Redis 配置但断连时回退同步处理，
    记 error 日志含队列名）；mail / meal-analysis enqueue 同样回退；data-export 在 `export.service.ts`
    调用处兜底走 inline。
  - Meal-analysis enqueue 去除确定性 jobId，去重交给 worker 幂等检查（revision 比对），
    失败 job 保留期内可同 revision 重试。
  - Redis URL 解析抽为 `common/helpers/infra/redis-url.ts`（queue.factory + cache.config 共用，
    支持 `family`/`db` query 参数与 credentials）。
  - `mail-queue.service.ts` 的 `workerConcurrency` 读取与 `defaultJobOptions` 对齐
    （`const q = mailConfig?.queue; q?.workerConcurrency ?? 3`，避免 mailConfig 缺失时 TypeError）。
  - P2-6（Reminder 调度去重）已实施：`user_reminder_deliveries` 新增
    `@@unique([userId, reminderId, scheduledFor])`（迁移含历史重复清理），scheduler 写入改
    `createMany({ skipDuplicates: true })`，「至少一次投递」语义见
    [ADR-0011](adr/0011-reminder-delivery-at-least-once.md)。
