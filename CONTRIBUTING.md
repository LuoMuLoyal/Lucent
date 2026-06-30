# Contributing to Lucent

## Branch Naming

- `feat/<short-description>` — new features
- `fix/<short-description>` — bug fixes
- `docs/<short-description>` — documentation changes
- `refactor/<short-description>` — code restructuring without feature changes
- `chore/<short-description>` — tooling, dependencies, CI

## Commit Convention

使用约定式提交（Conventional Commits）：

```
type(scope): 中文摘要
```

- `type`: feat, fix, docs, refactor, test, chore
- `scope`: 模块名（如 auth, medicines, assistant, daily-records）
- 摘要：中文，简洁描述变更内容
- **只有存在破坏性变更或与之前行为不兼容时才写 commit body**；普通提交保持单行摘要即可

## Before Creating a PR

```bash
pnpm check
```

This runs lint, typecheck, build, and unit tests. For full TypeScript coverage including spec/e2e files:

```bash
pnpm typecheck
```

For deployed-MVP smoke testing:

```bash
LUCENT_APP_DIR=/opt/lucent/app LUCENT_SERVER_DIR=/opt/lucent/server LUCENT_PUBLIC_BASE_URL=https://your-host pnpm deploy:smoke
```

## What Not To Commit

- IDE configuration files (`.vscode/`, `.idea/`)
- Build artifacts (`dist/`, `coverage/`)
- Local environment files (`.env`, `.env.test`, `.env.production`)
- Generated docs that can be regenerated (`docs/compodoc/` — regenerate with `pnpm docs:compodoc`)
- `node_modules/`

## Code Style

- Follow the module subdirectory whitelist defined in `AGENTS.md`.
- All `.service.ts` files belong in `services/`, never in the module root.
- DTO files must include an `index.ts` barrel export.
- Use `pnpm lint:check` to verify before committing.

## API Contract Changes

When controller or DTO code changes:

1. Run `pnpm export:openapi` to regenerate `docs/openapi.json`.
2. In the Luminous repo, regenerate the Flutter client:
   ```bash
   dart run tool/regenerate_lucent_openapi.dart
   ```
3. Append a dated entry to `docs/migration-log/YYYY-MM-DD.md`.

## Architecture Changes

When module structure, dependencies, or AI pipeline architecture changes:

1. Run `pnpm docs:compodoc` to regenerate architecture docs.
2. Update `docs/architecture.md` if module dependency graph or route architecture changed.
3. Consider creating an ADR in `docs/adr/` if the decision is significant.

## Documentation

- See `docs/README.md` for the document boundaries and update map.
- Any backend code change: append to today's `docs/migration-log/YYYY-MM-DD.md`.
- Completed TODO items: delete from `docs/TODO.md`, move facts to `Luminous/docs/Current_State.md`.
- Active multi-step plans: `plans/YYYY-MM-DD-short-task-name.md`.
