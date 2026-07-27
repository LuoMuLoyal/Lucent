# Toolchain / Contract

Last updated: 2026-07-22

- Local backend toolchain baseline is Node.js `24.x` plus pnpm `11.x`; CI and Corepack docs pin the
  recommended baseline to `11.9.0`.
- local `docs/openapi.json` remains the exported backend contract artifact that Luminous
  regenerates its `generated/lucent_api/` client from.
- The current exported contract now includes meal-analysis read hot fields on `DailyRecordItemDto`:
  status, coverage, updated-at, failure-reason, short-description, and top-foods.
- Lucent CI re-exports `docs/openapi.json` before E2E tests to ensure the contract file matches
  the current code. The file is tracked in git (marked as `linguist-generated`), so the export
  step overwrites the committed copy with a fresh build during CI.
- `vitest.e2e.config.ts` is a standalone `defineConfig` (not `mergeConfig` with the base config)
  to prevent `include` array concatenation from pulling unit tests into the E2E run.
- `pnpm prisma:generate` now also transpiles `generated/prisma/internal/*.ts` to `.js`, because
  Prisma 7's custom-output client currently leaves those runtime files missing while `client.js`
  still requires them for `pnpm build`, `pnpm export:openapi`, and other compiled-runtime flows.
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
- **新增模块**（2026-07-20）：`audit-log`（`@Global()` 审计日志）、`user-devices`（设备注册 API）、
  `data-retention`（`@Cron` 数据保留清理）。新增 API 端点 `POST/GET/DELETE /api/v1/user/user-devices`。
  `UserNotificationType` 枚举新增 `oauth_login`、`identity_linked`。限流从内存存储升级为条件性
  Redis 存储（`ThrottlerConfigService`）。`pnpm export:openapi` 需重新执行以更新
  `docs/openapi.json` 契约文件，Luminous 需重新生成 API 客户端。
- **Profile extras 提升**（2026-07-27）：`UserHealthProfileDto` 新增 `weightKg`、`emergencyContact`
  顶层字段（从 `extras` JSONB 提取）。新增 `EmergencyContactDto` schema。`UpdateHealthContextProfileDto`
  新增 `weightKg`/`emergencyContactName`/`emergencyContactPhone` 可选字段，写入时执行 extras 深度合并。
