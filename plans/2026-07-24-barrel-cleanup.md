# Barrel 导出模式重构 — Lucent

> **创建日期**: 2026-07-24
> **状态**: 待执行
> **审查基线**: `src/` 全部 129 个 `index.ts` barrel 文件 + `common/` 14 个子目录 barrel

## 目标

将 Lucent 的 barrel 导出从「每个子目录一个 `index.ts`、`export *` 全量导出」改为「模块根目录一个 `index.ts`、显式导出公开 API、模块内深路径导入」。消除 51 个单导出 barrel、~78 个多导出子目录 barrel，以及 `today-suggestion`、`daily-records`、`assistant` 等模块的重导出链。

> **与现有计划的关系**: 本计划取代 `2026-07-23-code-style-consistency-refactor.md` 中阶段 1（Barrel 补全）和阶段 2（跨模块深路径导入统一）的方向——那两个阶段是在**强化**子目录 barrel 体系，本计划改为**撤销**该体系。

## 执行原则

- 每个阶段独立可验证：阶段结束后运行 `pnpm lint:check && pnpm typecheck && pnpm build && pnpm test:ci`
- 不改变运行时行为 — 纯结构调整和导入路径替换
- 不放松 TS/ESLint 规则
- 每阶段结束后追加 `docs/02-logs/migration-log/2026-07-24.md` 条目，运行 `pnpm docs:check`

---

## 背景与问题

### 现状

`AGENTS.md` 的「Barrel Exports」规则当前要求：

> Every sub-directory inside a module (`services/`, `dto/`, `tools/`, etc.) **must** have an `index.ts` re-exporting all public symbols — only `export *` statements, no logic.

这导致了三个问题：

1. **51 个单导出 barrel 纯属冗余** — 如 `user/services/index.ts` 只 `export * from './user.service'`，barrel 没有聚合价值
2. **重导出链难以追踪** — `today-suggestion/services/index.ts` 重导出 9 个子 barrel，每个子 barrel 再导出 3-9 个文件，符号来源不可见
3. **`export *` 不区分公开 API 和内部实现** — barrel 自动导出所有符号，模块边界形同虚设

### 目标模式

```
modules/auth/
  index.ts               ← 模块根 barrel，显式导出跨模块公开符号
  auth.module.ts
  auth.controller.ts
  services/               ← 无 index.ts
    account.service.ts
    token.service.ts
    ...
  dto/                    ← 无 index.ts
    login.dto.ts
    ...
  decorators/             ← 无 index.ts
    current-user.decorator.ts
  guards/                 ← 无 index.ts
    jwt-auth.guard.ts
```

模块根 `index.ts` 使用显式 export（非 `export *`）：

```ts
// modules/auth/index.ts — 模块公开 API 契约
export { CurrentUser, Public } from './decorators/current-user.decorator';
export type { UserPayload } from './services/token.service';
export { AuthService } from './services/account.service';
export { JwtAuthGuard } from './guards/jwt-auth.guard';
// 不导出 TokenService、OAuthFacadeService — 内部实现
```

---

## 阶段 1 — 删除单导出 barrel（P0）

**目标**: 移除所有只导出一个文件的 `index.ts`，将消费者改为直接导入源文件。

**涉及文件**: 51 个 barrel + 对应消费者

**单导出 barrel 清单**:

| 子目录类型              | 数量 | 典型示例                                                                           |
| ----------------------- | ---- | ---------------------------------------------------------------------------------- |
| `services/index.ts`     | 15   | `user/services`、`security-pin/services`、`audit-log/services` 等                  |
| `dto/index.ts`          | 8    | `security-pin/dto`、`notifications/dto`、`files/dto` 等                            |
| `types/index.ts`        | 5    | `security-pin/types`、`user-health-context/types`、`medicine-reminders/types` 等   |
| `constants/index.ts`    | 7    | `daily-records/constants`、`data-export/constants`、`legal-documents/constants` 等 |
| `repositories/index.ts` | 2    | `daily-records/repositories`                                                       |
| `prompts/index.ts`      | 4    | `daily-records/prompts`、`today-analysis/prompts`、`assistant/prompts`             |
| `schemas/index.ts`      | 2    | `daily-records/schemas`、`today-analysis/schemas`                                  |
| 其他                    | 8    | `admin/constants`、`admin/types`、`common/events` 等                               |

**操作**:

1. 删除 barrel 文件
2. 查找所有 `from './services'`（或 `from '../services'`）的导入，改为 `from './services/xxx.service'`
3. 对于跨模块导入（如 `from '../security-pin/services'`），暂时改为深路径，阶段 3 统一处理

**验证**: `pnpm lint:check && pnpm typecheck && pnpm build`

---

## 阶段 2 — 删除多导出子目录 barrel，替换为模块内深路径导入（P0）

**目标**: 移除剩余的多导出子目录 barrel，模块内导入全部改为深路径。

**涉及文件**: ~78 个 barrel + 所有模块内消费者

**重点模块（重导出链最深的）**:

### 2a. `today-suggestion/services/index.ts` 及 9 个子 barrel

当前结构：

```
services/index.ts → rules/ (9文件), collectors/ (3), arbitration/ (3),
                    lifecycle/ (2), feedback/ (2), notification/ (1),
                    explanation/ (3), copy/ (4)
```

操作：

1. 删除 `services/index.ts` 及所有子目录 `index.ts`
2. `suggestion.service.ts` 内部将 `from './rules'` 改为 `from './rules/missed-dose.service'` 等
3. `today-suggestion.module.ts` 的 provider 注册改为深路径

### 2b. `daily-records/services/index.ts` 及 4 个子 barrel

当前结构：

```
services/index.ts → candidates/ (3), meal-analysis/ (3), meal-dish/ (3), meal-ingredient/ (3)
```

操作同上。

### 2c. `assistant/tools/index.ts`（17 个导出来源）

当前结构：

```
tools/index.ts → types/, tool.service/, context.service/, presenters/,
                 date-resolver/, proposal.service/, read.service/,
                 read-helpers/, vector-cursor/, vector-store.factory/,
                 constants/, drugbank/, leaflet/, records/, knowledge/, medicine/
```

操作：删除 `tools/index.ts`，`assistant.module.ts` 和 `agent/` 内的消费者改为深路径。

### 2d. 其他模块

剩余模块（`user-health-context`、`medicines`、`reports`、`data-export` 等）的多导出 barrel 同样删除，消费者改为深路径。

**验证**: `pnpm lint:check && pnpm typecheck && pnpm build && pnpm test:ci`

---

## 阶段 3 — 创建模块根 barrel 并统一跨模块导入（P0）

**目标**: 每个模块根目录创建 `index.ts`，显式导出跨模块公开符号；所有跨模块导入改为 `from '../module-name'`。

**操作**:

1. 为每个模块创建根 `index.ts`，内容为显式 `export { X } from './...'` 语句
2. 导出范围 = `@Module().exports` 中的服务 + 跨模块使用的 DTO/type/decorator/guard
3. 不导出：内部实现 service、test helper、内部 constant

**跨模块导入替换清单**:

| 当前导入                             | 目标导入                          | 消费者数量             |
| ------------------------------------ | --------------------------------- | ---------------------- |
| `from '../auth/services'`            | `from '../auth'`                  | ~12 个 controller/spec |
| `from '../auth/decorators'`          | `from '../auth'`                  | ~15 个 controller      |
| `from '../security-pin/services'`    | `from '../security-pin'`          | ~3 个                  |
| `from '../security-pin/dto/pin.dto'` | `from '../security-pin'`          | ~2 个                  |
| `from '../../common/api'`            | `from '../../common'`（见阶段 4） | ~20 个                 |
| `from '../../common/helpers'`        | `from '../../common'`（见阶段 4） | ~15 个                 |
| `from '../../prisma'`                | 保持不变（已是根 barrel）         | —                      |

**模块根 barrel 示例**:

```ts
// modules/auth/index.ts
export { AuthService } from './services/account.service';
export type { UserPayload } from './services/token.service';
export { CurrentUser, Public } from './decorators/current-user.decorator';
export { JwtAuthGuard } from './guards/jwt-auth.guard';
```

```ts
// modules/security-pin/index.ts
export { SecurityPinService } from './services/pin.service';
export { SecurityElevationGuard } from './guards/elevation.guard';
export { SecurityPinSettingsDto } from './dto/pin.dto';
export type { SecurityPinValidationResult } from './types/pin.types';
```

**验证**: `pnpm lint:check && pnpm typecheck && pnpm build && pnpm test:ci`

---

## 阶段 4 — `common/` 目录 barrel 整合（P1）

**目标**: 将 `common/` 14 个子目录 barrel 合并为 `common/index.ts` 一个根 barrel。

**当前结构**:

```
common/
  api/index.ts          ← 5 exports
  helpers/index.ts      ← 多 exports
  services/index.ts     ← 单导出
  filters/index.ts      ← 单导出
  middleware/index.ts   ← 单导出
  ...共 14 个子目录 barrel
```

**操作**:

1. 删除所有 `common/*/index.ts`
2. 创建 `common/index.ts`，显式导出跨模块使用的公共符号
3. 模块内导入（`common/helpers/` 内文件互相引用）改为深路径
4. 跨模块导入改为 `from '../../common'`（或 `from '../../../common'` 视深度）

**注意**: `common/` 下子目录内文件数量差异大，有些子目录只有 1 个文件。这些子目录本身可考虑合并，但属于目录结构调整，不在本计划范围内。

**验证**: `pnpm lint:check && pnpm typecheck && pnpm build`

---

## 阶段 5 — 更新 AGENTS.md 和 ESLint 规则（P1）

**目标**: 更新项目规则文档和 lint 配置，防止 barrel 模式回退。

### 5a. 重写 AGENTS.md「Barrel Exports」章节

将当前内容：

```markdown
- Every sub-directory inside a module (`services/`, `dto/`, `tools/`, etc.) **must** have an
  `index.ts` re-exporting all public symbols — only `export *` statements, no logic.
- Cross-module imports go through barrels, not deep paths
```

改为：

```markdown
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
```

### 5b. 更新 AGENTS.md「Root common/ Conventions」章节

将「Every sub-directory has an `index.ts` barrel.」改为：

```
- `common/index.ts` is the single barrel; no sub-directory barrels.
```

### 5c. 更新 ESLint `no-restricted-imports`

在 `eslint.config.ts` 中添加规则，禁止子目录 barrel 导入和 `export *` barrel 文件：

```ts
{
  // 禁止从模块子目录导入（应走模块根 barrel）
  group: ['**/modules/*/services/*', '**/modules/*/dto/*', '**/modules/*/types/*',
          '**/modules/*/constants/*', '**/modules/*/decorators/*',
          '**/modules/*/guards/*', '**/modules/*/repositories/*'],
  allowModuleFolders: true,
  message: "Use the module root barrel '../module-name' instead of sub-directory imports.",
},
{
  // 禁止在 index.ts 中使用 export *
  pattern: 'export *',
  message: "Use explicit named exports, not `export *`.",
},
```

> 注意：ESLint `no-restricted-imports` 的 `group` 匹配的是导入路径，需要仔细调整 glob 模式以避免误报。模块内部深路径导入不应被拦截。

### 5d. 废止旧计划中的 barrel 相关阶段

在 `2026-07-23-code-style-consistency-refactor.md` 中：

- 阶段 1（Barrel 补全）— 标记为已被本计划取代
- 阶段 2（跨模块深路径导入统一）— 标记为已被本计划取代
- 阶段 14（ESLint `no-restricted-imports` 扩展）— 方向反转，本计划阶段 5c 取代

**验证**: `pnpm lint:check && pnpm typecheck`

---

## 阶段 6 — `prisma/` 和 `llm-runtime/` barrel 对齐（P2）

**目标**: 使 `prisma/` 和 `llm-runtime/` 遵循与模块相同的一根 barrel 模式。

### 6a. `prisma/index.ts`

当前使用 `export *` 且带 `.js` 扩展名：

```ts
export * from './prisma.extension.js';
export * from './prisma.module.js';
export * from './prisma.service.js';
```

改为显式 export，去掉 `.js` 扩展名（与其他 barrel 对齐）：

```ts
export { PrismaModule } from './prisma.module';
export { PrismaService } from './prisma.service';
export { prismaExtension } from './prisma.extension';
```

### 6b. `llm-runtime/index.ts` 和 `llm-runtime/services/index.ts`

当前有两层 barrel。删除 `services/index.ts`，`llm-runtime/index.ts` 改为显式 export。

**验证**: `pnpm lint:check && pnpm typecheck && pnpm build`

---

## 验收检查清单

每个阶段结束后执行：

```bash
pnpm lint:check          # --max-warnings=0
pnpm typecheck           # tsc --noEmit
pnpm build               # nest build
pnpm test:ci             # vitest --runInBand
pnpm docs:check          # 文档检查
```

全部完成后追加：

```bash
pnpm export:openapi      # 确认 API 契约不变
pnpm docs:compodoc       # 确认模块结构文档同步
```

## 文档更新

- 每阶段追加 `docs/02-logs/migration-log/2026-07-24.md` 条目
- 阶段 5 更新 `AGENTS.md`（barrel 规则重写）
- 阶段 5 更新 `docs/00-current/Code_Quality_Maintainability.md`（如有 barrel 相关描述）
- 如有架构变更描述需更新，同步 `docs/01-reference/architecture.md`
