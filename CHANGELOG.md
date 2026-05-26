# Lucent Changelog

## 2026-05-26

### Added

- **Winston 日志集成** — `src/common/logger/`
  - `logger.config.ts` — 按 NODE_ENV 切换格式（development 彩色 / production JSON）
  - `logger.module.ts` — `@Global()` 模块，按 `LOG_LEVEL` 配置日志级别
  - `main.ts` — `app.useLogger()` 替换 NestJS 默认 Logger
  - `setup-app.ts` — HTTP 请求日志中间件（method / url / statusCode / duration）
  - 依赖：`winston` + `nest-winston`

- **环境变量枚举** — `src/config/`
  - `env-keys.enum.ts` — `EnvKey` 枚举，14 个环境变量 key，消除 `process.env['NODE_ENV']` 等魔法字符串
  - `config-keys.enum.ts` — `ConfigKey` 枚举，NestJS namespace key

- **Joi 环境校验** — `src/config/environment.validation.ts`
  - 从 `class-validator` / `class-transformer` 迁移到 `joi`
  - 链式 API：`.default()` / `.valid()` / `.uri({ scheme: /^postgres/ })`
  - 新增 `LOG_LEVEL` 校验（debug / info / warn / error）
  - 新增 `DATABASE_URL` / `REDIS_URL` / `AI_BASE_URL` 的 URI scheme 校验
  - 依赖：`joi`

- **环境变量文件**
  - `.env.development` — 开发环境默认值（含 JWT dev secret）
  - `.env.production` — 生产环境模板（占位符，由部署时填充）
  - `.env.example` — 补充 `LOG_LEVEL=debug`
  - `.env.development.example` — 补充 `LOG_LEVEL=debug`
  - `.env.production.example` — 补充 `LOG_LEVEL=info`

### Changed

- `config/app.config.ts` — `registerAs('app', ...)` → `registerAs(ConfigKey.App, ...)` + 使用 `EnvKey`
- `main.ts` — `'app.host'` / `'app.port'` → `` `${ConfigKey.App}.host` ``
- `setup-app.ts` — `'app.corsOrigin'` → `` `${ConfigKey.App}.corsOrigin` ``
- `environment.validation.ts` — 类属性改用 `[EnvKey.XXX]` 计算属性名；`NodeEnvironment` 导出
- `app.module.ts` — 注册 `LoggerModule`
- `logger.module.ts` — `process.env['NODE_ENV']` → `process.env[EnvKey.NODE_ENV]`

### Fixed

- `tsconfig.json` — 移除 `baseUrl` 和 `ignoreDeprecations`（NestJS SWC builder 不兼容）

---

### Changed
- **API 响应码：字符串 → 数字** — `api-envelope.ts` `ErrorCode` 枚举
  - `0` 成功 / `400001` 参数错误 / `401001` 未登录 / `401002` Token 过期 / `404001` 未找到 / `5xxxxx` 服务端异常
  - Flutter `LucentApiClient.code` 改为 `int`，`GlobalConstants.LUCENT_SUCCESS_CODE` = `0`
  - `docs/api-contract.md` 同步

### Fixed
- `tsconfig.json` — 移除 `baseUrl` + `ignoreDeprecations`（NestJS SWC builder 不兼容）

---

## 2026-05-26（基线）

- NestJS 11 项目初始化
- API envelope：`{ code, message, data, meta? }`
- 异常过滤器：`ApiExceptionFilter`（HTTP status → error envelope）
- `X-Request-Id` 中间件
- `GET /api/v1/health` 端点 + 单元测试 + E2E 测试
- `@nestjs/config` + `environment.validation.ts`（class-validator 版本）
- URI 版本控制：`/api/v1`
- 文档：`docs/api-contract.md` / `docs/environment.md` / `docs/migration-roadmap.md`
