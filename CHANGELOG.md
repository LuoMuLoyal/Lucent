# Lucent Changelog

## 2026-05-27

### Added — Auth 基础设施 (Step 0)

- **Prisma ORM 集成**
  - `Lumos/prisma/schema.prisma` — User + RefreshToken 模型（UUID v4 主键，argon2 密码哈希）
  - `Lumos/prisma.config.ts` — Prisma v7 配置，输出到 `Lucent/src/generated/prisma/`
  - `src/prisma/prisma.service.ts` — `OnModuleInit` 自动连接
  - `src/prisma/prisma.module.ts` — `@Global()`
  - 依赖：`@prisma/client@^7.8.0`, `prisma@^7.8.0`, `pg@^8.21.0`

- **Mail 模块**
  - `src/mail/mail.service.ts` — `send()` / `sendVerificationCode()`，双模式：
    - `MAIL_DRIVER=log`：Winston Logger 打印（开发用）
    - `MAIL_DRIVER=smtp`：nodemailer 真实发送
  - `src/mail/mail.module.ts` — `@Global()`
  - `src/config/mail.config.ts` — `registerAs(ConfigKey.Mail, ...)`
  - 依赖：`nodemailer@^8.0.9`

- **Cache 模块 (Redis)**
  - `src/config/cache.config.ts` — `CacheConfigService`，从 `REDIS_URL` 解析连接参数
  - 使用 `cache-manager-ioredis-yet`，无 Redis 时 fallback 内存缓存
  - `app.module.ts` 中通过 `CacheModule.registerAsync` 全局注册
  - 依赖：`@nestjs/cache-manager@^3.1.2`, `cache-manager@^7.2.8`, `cache-manager-ioredis-yet@^2.1.2`

- **邮件环境变量** — `EnvKey` 新增 `MAIL_DRIVER`, `MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, `MAIL_PASS`, `MAIL_FROM`

- **ConfigKey 新增** — `Mail` namespace

### Changed — 环境变量架构重构

- **`.env` 文件层级分离**：
  - `.env` — 各环境公有默认值（HOST, PORT, CORS_ORIGIN, JWT TTL, 邮件默认值, LOG_LEVEL）
  - `.env.development` — 开发环境专属（NODE_ENV, 数据库, JWT dev secret, MAIL_DRIVER=log）
  - `.env.production` — 生产环境专属（NODE_ENV, 数据库, JWT prod secret, MAIL_DRIVER=smtp）
  - `.env.example` / `.env.development.example` / `.env.production.example` — 同步结构
  - 加载链：`.env.{NODE_ENV}` → `.env`（后者为 fallback）

- **`app.module.ts`** — 注册 `PrismaModule`, `MailModule`, `CacheModule`

- **`environment.validation.ts`** — Joi schema 新增 6 个 mail key 校验

### Changed — 密码哈希方案

- `bcrypt` → `argon2@^0.44.0`（更强抗 GPU/ASIC 攻击，自带 TS 类型）

### Pending

- **Step 0.6 数据库迁移** — 等待 PostgreSQL 启动后执行 `prisma migrate dev --name init`

---

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
