# AGENTS.md — Lucent

> Lucent 项目 AI Agent 操作规范

## ✅ 必须做

| 时机                   | 动作                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| 每次对话结束有代码变更 | 更新 `CHANGELOG.md`（格式：`## YYYY-MM-DD (描述)` + 分类 `Added/Changed/Fixed/Removed`） |
| 完成一个实施步骤       | 更新对应计划文档的状态                                                                   |
| 修改 env 配置          | 同时更新 6 个文件：`.env`、`.env.development`、`.env.production` + 3 个 `.example`       |

## ❌ 禁止事项

| 类别               | 禁止内容                     |
| ------------------ | ---------------------------- |
| 降低代码检查等级   | 详见下方「代码检查铁律」     |
| 修改相邻未损坏代码 | 只改问题代码，不重构无关部分 |

## ⚔️ 代码检查铁律（无例外）

**tsconfig.json** — 禁止删除或设为 `false`：`strict`、`noImplicitAny`、`noImplicitReturns`、`noFallthroughCasesInSwitch`、`noUncheckedIndexedAccess`、`noUnusedLocals`、`noUnusedParameters`、`exactOptionalPropertyTypes`

**eslint.config.mjs** — 禁止降级以下规则：`@typescript-eslint/no-explicit-any`、`no-floating-promises`、`no-unsafe-*` 系列、`restrict-template-expressions`、`restrict-plus-operands`、`no-unused-vars`、`no-non-null-assertion`、`consistent-type-imports`、`no-unnecessary-condition`、`no-confusing-void-expression`

**正确做法**：修复代码本身，而非降低检查等级。需要临时绕过用 `// eslint-disable-next-line <rule>` 并说明原因。

## 踩坑记录

### Prisma v7 相关

| 错误                            | 正确做法                                        |
| ------------------------------- | ----------------------------------------------- |
| `provider = "prisma-client-js"` | v7 改为 `provider = "prisma-client"`            |
| `output` 路径相对 cwd 解析      | 相对 `schema.prisma` 文件位置解析，先验证再编码 |

### 运行命令相关

| 错误                           | 正确做法                                   |
| ------------------------------ | ------------------------------------------ |
| `cd X && cmd` 模式             | 使用 `pnpm --prefix`、`git -C` 等原生 flag |
| 未确认工作目录就运行初始化命令 | 先 `echo %cd%` 确认目标目录                |

### ESLint 相关

| 错误                                          | 正确做法                                      |
| --------------------------------------------- | --------------------------------------------- |
| `.toString()` 在模板字面量中不被接受          | 使用 `String()` 包装                          |
| NestJS 空 Module 类触发 `no-extraneous-class` | 行内 `// eslint-disable-next-line` 并说明原因 |

### 测试相关

| 错误                     | 正确做法                                     |
| ------------------------ | -------------------------------------------- |
| Provider token 重复/遗漏 | 检查每个 token 只注册一次，所有依赖都要 mock |
