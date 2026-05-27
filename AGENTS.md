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
