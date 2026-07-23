# 代码风格一致性大重构 — Lucent

> **创建日期**: 2026-07-23
> **状态**: 待执行
> **审查基线**: `src/modules/` 全部 24 个模块 + `common/` + `config/` + `prisma/`

## 目标

系统性消除 Lucent 后端代码中的风格不一致问题，使全部 `src/` 代码严格遵守 `AGENTS.md` 中的 Barrel Exports、File Naming、Module Subdirectory Whitelist 等规则。

## 执行原则

- 每个阶段独立可验证：阶段结束后运行 `pnpm lint:check && pnpm typecheck && pnpm build && pnpm test:ci`
- 不改变运行时行为 — 纯结构调整和导入路径替换
- 不放松 TS/ESLint 规则
- 每阶段结束后追加 migration-log，运行 `pnpm docs:check`

---

## 阶段 1 — Barrel 补全（P0）

**目标**: 为所有缺失 `index.ts` 的模块子目录补齐 barrel 导出。

**新增文件清单**:

| 模块                 | 目录                                         | 新增文件                                      |
| -------------------- | -------------------------------------------- | --------------------------------------------- |
| `user`               | `services/`                                  | `index.ts`                                    |
| `auth`               | `types/`                                     | `index.ts`                                    |
| `auth`               | `config/`                                    | `index.ts`（若 config 目录被 whitelist 允许） |
| `daily-records`      | `constants/`                                 | `index.ts`                                    |
| `daily-records`      | `prompts/`                                   | `index.ts`                                    |
| `daily-records`      | `schemas/`                                   | `index.ts`                                    |
| `daily-records`      | `types/`                                     | `index.ts`                                    |
| `medicine-dose-logs` | `services/`                                  | `index.ts`                                    |
| `notifications`      | `services/`                                  | `index.ts`                                    |
| `files`              | `services/`                                  | `index.ts`                                    |
| `environment`        | `config/`                                    | `index.ts`                                    |
| `environment`        | `services/`                                  | `index.ts`                                    |
| `data-export`        | `constants/`                                 | `index.ts`                                    |
| `data-export`        | `utils/`                                     | `index.ts`                                    |
| `user-settings`      | `constants/`                                 | `index.ts`                                    |
| `user-settings`      | `services/`                                  | `index.ts`                                    |
| `support-resources`  | `services/`                                  | `index.ts`                                    |
| `assistant`          | `dto/` 已有 → 检查 `agent/`、`tools/` 子目录 | 按需补齐                                      |

**规则**: 每个 `index.ts` 只包含 `export * from './xxx';` 语句，无逻辑。

**验证**: `pnpm lint:check && pnpm typecheck`

---

## 阶段 2 — 跨模块深路径导入统一（P0）

**目标**: 所有跨模块导入走 barrel，消除深路径引用。

### 2a. `UserPayload` 导入统一

当前三种导入路径：

- `from '../auth/services/auth.service'`（12 个 controller）
- `from '../auth/services/token.service'`（5 个 spec）
- `from '../auth/types/auth-request'`（5 个文件）

**行动**:

1. 确定 `UserPayload` 的规范导出路径 — 建议从 `auth/services` barrel 导出（`auth/services/index.ts` 已存在且 re-export `token.service`）
2. 全部替换为 `import type { UserPayload } from '../auth/services';`
3. 同时处理 `AuthService` 的深路径导入（`account.controller.ts` 等）

**涉及文件**: ~22 个

### 2b. `CurrentUser` / `Public` 装饰器导入统一

- `from '../auth/decorators/current-user.decorator'`（10 个文件）→ `from '../auth/decorators'`
- `from '../auth/decorators/public.decorator'`（3 个文件）→ `from '../auth/decorators'`

**涉及文件**: ~13 个

### 2c. `PrismaModule` / `PrismaService` 导入统一

- `from '../../prisma/prisma.module'`（7 个 module 文件）→ `from '../../prisma'`
- `from '../../prisma/prisma.service'`（5 个文件）→ `from '../../prisma'`

`prisma/index.ts` barrel 已存在但未被使用。

**涉及文件**: ~12 个

### 2d. `common/helpers/*` 深路径导入统一

- `from '../../common/helpers/client-ip'` → `from '../../common/helpers'`
- `from '../../common/helpers/error-info.utils'` → `from '../../common/helpers'`
- `from '../../common/helpers/error-payload'` → `from '../../common/helpers'`
- `from '../../common/helpers/queue-helpers'` → `from '../../common/helpers'`

需确认 `common/helpers/index.ts` barrel 是否已 re-export 这些模块，若未导出则先补齐。

**涉及文件**: ~5 个

### 2e. `common/interceptors/*` 深路径导入统一

- `from '../../common/interceptors/skip-api-envelope.decorator'`（3 个文件）→ `from '../../common/interceptors'`

需确认 `common/interceptors/index.ts` 是否已 re-export。

**涉及文件**: ~3 个

### 2f. `common/api/*` 深路径导入统一

- `from '../../common/api/sse'` → `from '../../common/api'`
- `from '../../common/api/sse-connection-registry.service'` → `from '../../common/api'`

需确认 `common/api/index.ts` 是否已 re-export。

**涉及文件**: ~2 个（reports.controller.ts 为主）

### 2g. 模块内部深路径导入统一

以下模块的 controller / module 绕过 barrel 直接深路径导入同模块 service / dto：

| 模块               | 文件                            | 深路径导入数 |
| ------------------ | ------------------------------- | ------------ |
| `today-suggestion` | `today-suggestion.module.ts`    | ~20 处       |
| `reports`          | `reports.controller.ts`         | ~5 处        |
| `data-export`      | `data-export.module.ts`         | ~5 处        |
| `files`            | `files.controller.ts`           | 1 处 dto     |
| `medicines`        | `medicines.controller.ts`       | 1 处 dto     |
| `testing-support`  | `testing-support.controller.ts` | 1 处 dto     |
| `account`          | `account.controller.ts`         | 2 处 dto     |

替换为 barrel 导入：`from './services'` / `from './dto'`。

**涉及文件**: ~7 个

**验证**: `pnpm lint:check && pnpm typecheck && pnpm build`

---

## 阶段 3 — 裸 `types.ts` / `constants.ts` 文件重命名（P1）

**目标**: 消除所有违反 AGENTS.md 规则 3 的裸类型词文件名。

| 当前路径                                 | 重命名为                | 业务词理由                                                                                   |
| ---------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------- |
| `daily-records/types/types.ts`           | `record.types.ts`       | 日常记录类型                                                                                 |
| `assistant/types/types.ts`               | `assistant.types.ts`    | 助手模块类型（注意: `assistant` 在此是业务词不是模块前缀，因为 `types/` 目录已表达命名空间） |
| `admin/types/types.ts`                   | `admin.types.ts`        | 管理面板类型                                                                                 |
| `medicine-reminders/types/types.ts`      | `reminder.types.ts`     | 提醒相关类型                                                                                 |
| `legal-documents/constants/constants.ts` | `legal.constants.ts`    | 法律文档常量                                                                                 |
| `admin/constants/constants.ts`           | `admin.constants.ts`    | 管理面板常量                                                                                 |
| `user-settings/constants/constants.ts`   | `settings.constants.ts` | 设置常量                                                                                     |

**行动**:

1. `git mv` 重命名文件
2. 更新对应的 `index.ts` barrel 中的 re-export 路径
3. 更新所有引用该文件的 import 语句
4. 同步重命名 spec 文件（若存在）

**验证**: `pnpm lint:check && pnpm typecheck && pnpm build && pnpm test:ci`

---

## 阶段 4 — `@ApiBearerAuth` 放置位置统一（P1）

**目标**: 所有需要认证的 controller 在**类级别**放置 `@ApiBearerAuth('access-token')`，公开端点用 `@Public()` 覆盖。

**需从方法级别移到类级别的 controller**:

| 模块                 | 当前方法级放置数                                           |
| -------------------- | ---------------------------------------------------------- |
| `daily-records`      | 7 处 → 移到类级别，移除 7 处方法级                         |
| `medicine-reminders` | 4 处 → 移到类级别                                          |
| `medicine-dose-logs` | 5 处 → 移到类级别                                          |
| `medicines`          | 3 处 → 移到类级别（注意该 controller 有 `@Public()` 方法） |

**注意**: `medicines.controller.ts` 混合了 `@Public()` 和 `@ApiBearerAuth` 方法。类级别放 `@ApiBearerAuth` 后，`@Public()` 方法会覆盖它，这是 NestJS 的预期行为。

**涉及文件**: 4 个 controller

**验证**: `pnpm export:openapi` — 确认 OpenAPI 输出中 security 定义不变

---

## 阶段 5 — `UserPayload` 规范导出路径确定（P1）

**目标**: 确定 `UserPayload` 接口的唯一规范导出路径，消除歧义。

**当前状况**:

- `UserPayload` 定义在 `auth/services/token.service.ts`
- `auth.service.ts` import 并 re-export 了它（隐式）
- `auth/types/auth-request.ts` 也导出了一个 `UserPayload`（可能是同一个或不同类型）

**行动**:

1. 检查 `auth/types/auth-request.ts` 和 `auth/services/token.service.ts` 中的 `UserPayload` 是否为同一类型
2. 如果是同一类型：选择一个定义位置，通过 `auth/services` barrel 统一导出，删除冗余定义
3. 如果不是同一类型：重命名以区分，各自通过合适的 barrel 导出
4. 更新全部 ~22 个引用文件的导入路径

**验证**: `pnpm typecheck && pnpm lint:check`

---

<!-- ## 阶段 6 — `prisma/index.ts` `.js` 扩展名统一（P2）此项跳过

**目标**: 使 `prisma/index.ts` 的 barrel 风格与其他 barrel 一致。

**当前**:
```typescript
export * from './prisma.extension.js';
export * from './prisma.module.js';
export * from './prisma.service.js';
```

**改为**（与其他 barrel 一致，不带 `.js`）:
```typescript
export * from './prisma.extension';
export * from './prisma.module';
export * from './prisma.service';
```

**前提**: 确认 `nodenext` 模块解析下不带扩展名能正确解析（其他 barrel 已验证可行）。

**涉及文件**: 1 个 -->

---

## 阶段 7 — Spec 文件归位（P2）

**目标**: 将错位的 spec 文件移到与其源文件同目录。

| 当前位置                                  | 移动到                                        |
| ----------------------------------------- | --------------------------------------------- |
| `data-export/data-export.service.spec.ts` | `data-export/services/export.service.spec.ts` |

**注意**: 检查该 spec 文件是否测试的是 `DataExportService`（位于 `services/export.service.ts`），确认后 `git mv`。

**涉及文件**: 1 个

---

## 阶段 8 — `medicines.controller.ts` 响应信封修复（P2）

**目标**: 使 `search` 方法返回标准 `{ code, message, data }` 信封。

**当前**（`medicines.controller.ts:100-107`）:

```typescript
return {
  code: ResultCode.SUCCESS,
  message: '',
  data: result.items,
  meta: {
    pagination: result.pagination,
  },
};
```

将 pagination 合并到 data 中：`return successEnvelope({ items: result.items, pagination: result.pagination });` — 需更新 DTO 和前端

**注意**: 此改动会影响 API 响应结构，需同步更新 OpenAPI 和 Flutter 客户端。建议选并在 DTO 中反映新结构。

**涉及文件**: 1 个 controller + 对应 DTO + OpenAPI 导出

---

## 阶段 9 — 构造函数命名统一（P2）

**目标**: 统一 controller 中注入 service 的命名模式。

**约定**: 使用 `this.{module}Service` 完整命名，不使用缩写 `this.service`。

**需修改的 controller**:

| 模块                 | 当前           | 改为                    |
| -------------------- | -------------- | ----------------------- |
| `medicine-dose-logs` | `this.service` | `this.doseLogsService`  |
| `medicine-reminders` | `this.service` | `this.remindersService` |

**涉及文件**: 2 个 controller + 对应 spec 文件

---

## 阶段 10 — `assistant.service.ts` 移入 `services/`（P2）

**目标**: 将 `assistant/assistant.service.ts` 和 `assistant/assistant.service.spec.ts` 移入 `services/` 子目录。

**行动**:

1. `git mv assistant/assistant.service.ts services/assistant.service.ts`
2. `git mv assistant/assistant.service.spec.ts services/assistant.service.spec.ts`
3. 更新 `services/index.ts` barrel 添加 re-export
4. 更新 `assistant.module.ts` 中的导入路径

**涉及文件**: ~4 个

---

## 阶段 11 — `import type` 语法统一（P3）

**目标**: 统一 `import type` 写法。

**行动**:

1. 在 `eslint.config.ts` 中将 `@typescript-eslint/consistent-type-imports` 规则配置为：
   ```typescript
   '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }]
   ```
   或 `separate-type-imports`（需讨论确定偏好）
2. 运行 `pnpm lint:check --fix` 自动修复全部文件

**涉及文件**: 全项目（自动修复）

---

## 阶段 12 — `today-suggestion` 规则 Service 独立 Spec（P3）

**目标**: 为 `today-suggestion/services/rules/` 下 7 个规则 service 补齐独立 spec 文件。

**当前**: 仅有一个共享的 `rules.spec.ts`。

**需新增**:

- `caffeine-sleep.service.spec.ts`
- `coverage.service.spec.ts`
- `deteriorating-trend.service.spec.ts`
- `missed-dose.service.spec.ts`
- `mood-sleep.service.spec.ts`
- `sleep-shortfall.service.spec.ts`
- `water-shortfall.service.spec.ts`

**涉及文件**: 7 个新文件

---

## 阶段 13 — `support-resources-reference.ts` 归属调整（P3）

**目标**: 将非 `@Injectable()` 的纯数据文件从 `services/` 移到 `constants/`。

**行动**:

1. `git mv services/support-resources-reference.ts constants/support-resources-reference.ts`
2. `git mv services/support-resources-reference.spec.ts constants/support-resources-reference.spec.ts`
3. 更新 `constants/index.ts` barrel
4. 更新引用方导入路径

**涉及文件**: ~3 个

---

## 阶段 14 — ESLint `no-restricted-imports` 扩展（收尾）

**目标**: 在 ESLint 配置中添加更多 barrel 强制规则，防止回退。

**行动**: 在 `eslint.config.ts` 的 `no-restricted-imports` 规则中追加：

```typescript
{
  group: ['**/auth/services/*'],
  message: "Use the barrel '../auth/services' instead of deep-path imports.",
},
{
  group: ['**/auth/decorators/*'],
  message: "Use the barrel '../auth/decorators' instead of deep-path imports.",
},
{
  group: ['**/prisma/prisma.*'],
  message: "Use the barrel '../../prisma' instead of deep-path imports.",
},
// 按需追加其他 barrel...
```

**涉及文件**: 1 个（`eslint.config.ts`）

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
pnpm export:openapi      # 确认 API 契约不变（仅阶段 8 可能改变响应结构）
```

## 文档更新

- 每阶段追加 `docs/02-logs/migration-log/2026-07-23.md` 条目
- 如有架构变更（如 barrel 规则扩展），更新 `docs/00-current/` 对应文件
