## 📝 铁律：每次对话结束必须更新 CHANGELOG

> **每完成一次对话（即所有任务完成、准备 attempt_completion 之前），必须将本次变更写入 `CHANGELOG.md`。**

**规则：**

1. **CHANGELOG 格式**：遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/) 风格
   - 按日期分组：`## YYYY-MM-DD (简短描述)`
   - 分类：`Added` / `Changed` / `Fixed` / `Removed` / `Deprecated` / `Security`
   - 每条记录列出影响的文件和具体变更

2. **时机**：在 `attempt_completion` 之前完成，确保 CHANGELOG 是最新状态

3. **不需要写 CHANGELOG 的情况**：
   - 纯文档阅读 / 信息查询（无代码或配置变更）
   - 仅讨论方案、未落地实施

4. **AGENTS.md 踩坑记录**也要同步更新（如果对话中发现了新的坑）

---

## ⛔ 铁律：严禁降低代码检查等级

> **此规则无任何例外，所有 AI agent 必须严格遵守。**

### 涉及的配置文件

| 文件                | 作用                            |
| ------------------- | ------------------------------- |
| `tsconfig.json`     | TypeScript 编译器检查           |
| `eslint.config.mjs` | ESLint + typescript-eslint 规则 |

### 禁止的操作

1. **禁止**将 `tsconfig.json` 中以下选项设为 `false` 或删除：
   - `strict`（及其子选项 `strictNullChecks`、`strictBindCallApply`、`strictFunctionTypes` 等）
   - `noImplicitAny`
   - `noImplicitReturns`
   - `noFallthroughCasesInSwitch`
   - `noUncheckedIndexedAccess`
   - `noUnusedLocals`
   - `noUnusedParameters`
   - `exactOptionalPropertyTypes`
   - `noImplicitOverride`
   - `noPropertyAccessFromIndexSignature`
   - `forceConsistentCasingInFileNames`

2. **禁止**在 `eslint.config.mjs` 中将以下规则从 `error` 降为 `warn` 或 `off`：
   - `@typescript-eslint/no-explicit-any`
   - `@typescript-eslint/no-floating-promises`
   - `@typescript-eslint/no-unsafe-argument`
   - `@typescript-eslint/no-unsafe-assignment`
   - `@typescript-eslint/no-unsafe-call`
   - `@typescript-eslint/no-unsafe-member-access`
   - `@typescript-eslint/no-unsafe-return`
   - `@typescript-eslint/restrict-template-expressions`
   - `@typescript-eslint/restrict-plus-operands`
   - `@typescript-eslint/no-unused-vars`
   - `@typescript-eslint/no-non-null-assertion`
   - `@typescript-eslint/consistent-type-imports`
   - `@typescript-eslint/no-unnecessary-condition`
   - `@typescript-eslint/no-confusing-void-expression`

3. **禁止**将 ESLint 配置中的 `tseslint.configs.strictTypeChecked` 降级为 `recommendedTypeChecked` 或 `recommended`。

### 正确的做法

- 如果某个检查导致 lint 错误，应**修复代码本身**使其通过检查，而非降低检查等级。
- 如果确实需要在某一行临时绕过（如第三方库类型不完整），使用行内注释 `// eslint-disable-next-line <rule>` 并附上原因说明，**不得**全局禁用规则。
- 唯一允许的例外：测试文件（`*.spec.ts`、`*.test.ts`）中 `@typescript-eslint/unbound-method` 可设为 `off`（这是 jest 相关的已知限制）。

# AGENTS.md — 踩坑记录

> 此文件记录 AI agent 在本项目中犯过的错误和教训，避免后续重复。
> 每次对话发现的错误都应追加到此文件中。

---

## 2026-05-27 — Auth Step 0 实施

### 1. `cd` 在 run_command 链中无效

**错误**：`cd D:\...\Lucent && pnpm add ...`

**原因**：`run_command` 不支持 `cd` 跨段持久化。需要改用工具自身的 cwd 参数，如 `pnpm --prefix Lucent <cmd>`。

**教训**：永远不用 `cd X && cmd` 模式，改用 `pnpm --prefix`, `git -C`, `cargo -C` 等原生 flag。

---

### 2. 未先确认工作目录就运行 prisma init

**错误**：直接运行 `pnpm exec prisma init`，结果 Prisma 配置文件生成到了 monorepo 根 `Lumos/` 而非 `Lucent/`。

**原因**：工作目录（cwd）是 `D:\25080\Documents\VSCodeProject\Lumos`（monorepo 根），不是 `Lucent/` 子目录。`prisma init` 默认在当前目录创建文件。

**教训**：

- 任何有副作用的初始化命令（`prisma init`, `npm init`, `git init` 等），先 `echo %cd%` 或用 `get_file_info` 确认目标目录。
- 此项目 Prisma 最终确实留在 `Lumos/` 根层级（因为 DATABASE_URL 在此 .env 中），但这是事后发现而非有意设计。

---

### 3. Prisma v7 generator provider 写错了

**错误**：schema.prisma 中写 `provider = "prisma-client-js"`（Prisma v5/v6 语法）

**正确**：Prisma v7 改为 `provider = "prisma-client"`

**教训**：大版本变更（v6 → v7）时 API 可能不兼容，先读 changelog 或运行 `prisma validate` 确认格式。

---

### 4. 未同步更新计划文档

**错误**：做完 Step 0.1–0.5 后没有更新 `docs/auth-implementation-plan.md`。用户提醒后才补。

**教训**：文档和代码是同一份交付物。每完成一个 Step 立即更新对应文档中的状态。计划文档末尾有步骤 Checklist 的就应该打勾。

---

### 5. 同时更新了 example 文件但遗漏了实际 .env 文件

**错误**：Step 0.3 扩展 mail 环境变量时，更新了 4 个 `.env.*.example` 文件和 `.env.development` / `.env.production`，但没有创建 `.env` 基础文件。而且原有的 `.env.development` 和 `.env.production` 包含了所有变量（公有的和差异的混在一起），没有做层级分离。

**正确做法**：

- `.env` — 所有环境共享的默认值
- `.env.development` — 仅开发环境差异项
- `.env.production` — 仅生产环境差异项
- 三个 `.example` 文件分别 mirror 上述三个

**教训**：修改 env 配置时，6 个文件（3 个实际 + 3 个 example）一起改，结构保持一致。

---

### 6. 安装了错误的 argon2 类型包

**错误**：`pnpm add -D @types/argon2-browser`

**原因**：`argon2` npm 包（node.js 版）自带 TypeScript 类型声明，不需要 `@types/` 包。`@types/argon2-browser` 是给浏览器版 `argon2-browser` 用的。

**教训**：安装 `@types/xxx` 前先检查包是否自带类型（`package.json` 中是否有 `"types"` 字段，或 `index.d.ts` 是否存在）。

---

### 7. Prisma v7 生成输出路径与预期不符

**错误**：设置 `output = "../src/generated/prisma"` 期望输出到 `Lucent/src/generated/prisma/`，但 `prisma generate` 实际输出到了 `Lumos/generated/prisma/`（monorepo 根）。

**原因**：`generator.output` 的相对路径基准未确认。最终通过在 schema 中写绝对相对路径 `"../Lucent/src/generated/prisma"` 解决（相对 schema 文件所在目录 `Lumos/prisma/` 向上再进入 Lucent）。

**教训**：Prisma v7 的 `output` 路径相对 `schema.prisma` 文件位置解析，不是相对 `prisma.config.ts` 或 cwd。先用 `prisma generate` 验证输出位置再大量编码。
