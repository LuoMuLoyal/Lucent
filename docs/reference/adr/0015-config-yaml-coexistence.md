# ADR-0015: .env → .env + YAML Configuration Coexistence

- **Status**: accepted
- **Date**: 2026-08-24
- **Deciders**: LuoMuLoyal

## Context

所有配置（敏感和非敏感）混在扁平 `.env` 中，无法表达嵌套分组，可读性差。默认值埋在代码里（`constants.ts` + Zod `.default()`），没有声明式的可审查配置文件。生产 `.env` 同时承载应用 Secret、Compose 插值变量和部署状态变量，职责混乱。

## Decision

非敏感运行时配置从 `.env` 迁移到 `config/` 下的 YAML，敏感变量保留在 `.env`，两者共存。

- YAML 存放在 `Lucent/config/`，与 `src/config/` 配置代码分离。
- 文件层次：`config/default.yaml` + `config/<NODE_ENV>.yaml` + `config/<NODE_ENV>.local.yaml`。
- 不创建 `.env.defaults`——默认值由 `config/default.yaml`（显式声明）和 Zod `.default()`（代码安全网）两层提供。
- `.env` 精简为只保留敏感变量（凭证、连接串）和启动选择器（`NODE_ENV`、`OTEL_ENABLED`、`TRUST_PROXY`）。
- 优先级：`环境变量 > .env.<env>.local > .env.<env> > config/<env>.local.yaml > config/<env>.yaml > config/default.yaml > Zod .default()`。
- Prisma CLI 保持独立加载 `.env`，不依赖 Nest 或 YAML。

## Options Considered

| Option                                               | Pros                                | Cons                                        |
| ---------------------------------------------------- | ----------------------------------- | ------------------------------------------- |
| **`config/default.yaml` + Zod `.default()`**（选定） | 显式声明 + 代码安全网；嵌套结构可读 | 需新增 YAML loader                          |
| `.env.defaults`                                      | 新开发者一眼看到默认值              | 扁平键值无法表达嵌套；与 Zod 出现两份默认值 |

## Consequences

### 变得更容易

- 配置可读性：YAML 嵌套结构比扁平 `.env` 清晰，按命名空间组织。
- 职责分离：YAML 管非敏感默认值，`.env` 管敏感值，Prisma 独立加载 `.env`。

### 变得更难 / 新增负担

- 需新建不依赖 Nest 的 YAML loader（deep merge + schema 校验 + 类型转换）。
- 现有配置工厂从 `process.env` 改为读取 Nest 配置对象。
- Dockerfile / Nest CLI 需配置 YAML 资产复制。

### 不变

- Prisma CLI 独立加载 `.env`，读取 `process.env.DATABASE_URL`。
- Zod schema `validateEnvironment` 启动校验保留，`.default()` 作为安全网。
- `NODE_ENV`、`OTEL_ENABLED`、`TRUST_PROXY` 等启动选择器继续由环境变量提供。

## Cross-References

- 实施计划:已完成,按计划生命周期删除;过程见迁移日志 2026-08-24 条目
