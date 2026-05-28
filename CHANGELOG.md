# Lucent Changelog

## 2026-05-28 (OpenAPI 响应 DTO + @ApiResponse 装饰器)

### Added — Auth 响应 DTO

- **`src/auth/dto/responses/common.dto.ts`** — 公共响应模型
  - `UserBriefDto` — 简略用户信息（id, email, nickname, emailVerified, createdAt）
  - `UserFullDto` — 完整用户信息（id, email, nickname, avatar, emailVerified, createdAt, updatedAt）
  - `TokensDto` — 令牌信息（accessToken, refreshToken, expiresIn）
  - `CooldownMessageDto` — 冷却提示（cooldown, message）
- **`src/auth/dto/responses/auth-responses.dto.ts`** — 各端点响应 envelope DTO
  - `SuccessResponseDto` — data 为 null 的通用成功响应（logout / resetPassword / changePassword / deleteAccount）
  - `RegisterResponseDto` / `LoginResponseDto` / `RefreshResponseDto`
  - `SendVerificationCodeResponseDto` / `VerifyEmailResponseDto` / `ForgotPasswordResponseDto`
  - `MeResponseDto` / `ChangeEmailResponseDto`
- **`src/auth/dto/responses/index.ts`** — 统一导出

### Changed — AuthController @ApiResponse 装饰器

- **`src/auth/auth.controller.ts`**
  - 13 个端点全部添加 `@ApiResponse({ status, type })` 装饰器
  - 新增 `ApiResponse` 导入和 9 个响应 DTO 导入
  - Swagger JSON 现包含完整的请求/响应类型定义，可直接用于 openapi-generator 生成 Dart 客户端

## 2026-05-28 (i18n 国际化集成 + ESLint 修复)

### Added — nestjs-i18n 国际化框架

- **依赖新增** — `nestjs-i18n@^11`
- **I18nModule** (`src/i18n/i18n.module.ts`)
  - `I18nModule.forRoot()` — HeaderResolver 提取 `Accept-Language`，fallback 语言 `zh-CN`
  - Loader: `src/i18n/{lang}/{module}.json` 按模块拆分
- **翻译文件**
  - `src/i18n/zh-CN/auth.json` — 认证相关中文翻译（16 个 key）
  - `src/i18n/zh-CN/common.json` — 通用错误中文翻译
  - `src/i18n/en/auth.json` — 认证相关英文翻译
  - `src/i18n/en/common.json` — 通用错误英文翻译
- **`nest-cli.json`** — `compilerOptions.assets` 配置 `i18n/**/*.json` 编译时复制
- **`app.module.ts`** — 注册 `I18nModule`

### Changed — AuthService / VerificationCodeService i18n 重构

- **`src/auth/auth.service.ts`**
  - 注入 `I18nService`（nestjs-i18n），替换所有硬编码中文错误消息为 `this.i18n.t('auth.xxx', { lang })`
  - `lang` 从 `this.i18n.resolveLanguage(lang)` 获取（支持 Header 兜底）
  - 涉及方法：register / login / refresh / getMe / changePassword / changeEmail / deleteAccount / sendVerificationCode / verifyEmail / forgotPassword / resetPassword
- **`src/auth/verification-code.service.ts`**
  - 注入 `I18nService`，替换 cooldown 和验证码过期/错误的硬编码消息

### Fixed — ESLint 修复

- **`src/setup-app.ts`** (第 23 行)
  - `res.statusCode` 和 `duration`（`number` 类型）在模板字面量中改为 `String()` 包装
  - 修复 `@typescript-eslint/restrict-template-expressions` 报错
- **`src/app.module.ts`**
  - 空类 `AppModule` 添加 `// eslint-disable-next-line @typescript-eslint/no-extraneous-class` 行内禁用
  - NestJS `@Module()` 装饰器要求 class 声明，此规则属于误报

### Added — 单元测试

- **`src/common/api-envelope.spec.ts`** — `successEnvelope` / `errorEnvelope` 函数测试 + `ResultCode` 枚举唯一性校验
- **`src/common/interceptors/api-envelope.interceptor.spec.ts`** — `ApiEnvelopeInterceptor` 测试（plain data 包装 / null / undefined / 已有 envelope 透传 / 原始类型 / 数组）
- **`src/common/middleware/request-id.middleware.spec.ts`** — `requestIdMiddleware` 测试（无 header 生成 UUID / 自定义 header 透传 / trim / 空白 / next 调用 / 响应头设置）
- **`src/user/user.service.spec.ts`** — `UserService` 测试（findById / findByEmail / create / update / updateByEmail，mock PrismaService）
- **`src/auth/verification-code.service.spec.ts`** — `VerificationCodeService` 测试（send 生成码+缓存+发邮件 / cooldown 限制 / verify 正确码 / 过期码 / 错误码 / 缓存 key 格式）

### Test Results

- 6 suites, 65 tests — 全部通过 ✅

---

## 2026-05-28 (环境变量 & Docker 架构重构)

### Changed — 去掉公共 `.env`，改为单文件自包含

- **`src/config/env-file-paths.ts`**
  - 加载链从 `.env.{NODE_ENV}.local → .env.{NODE_ENV} → .env.local → .env` 精简为 `.env.{NODE_ENV}.local → .env.{NODE_ENV}`
  - 每个环境的 `.env.<NODE_ENV>` 文件自包含所有变量（含 HOST, PORT, CORS_ORIGIN 等公共项）
  - 删除 `.env` 和 `.env.example`

### Changed — Docker Compose 环境变量注入

- **`docker-compose.yml`**
  - `app` 服务的 `env_file` 从 `.env.docker`（已删除）改为 `.env.development`
  - 新增 `environment` 覆盖容器间连接地址：`DATABASE_URL` → `postgres:5432`，`REDIS_URL` → `redis:6379`
  - postgres 凭证统一为 `lucent/lucent_dev`，与 `.env.development` 一致

### Changed — `.env.*` 文件补全

- **`.env.development`** / **`.env.production`** / **`.env.test`**
  - 补充公共变量：`HOST`, `PORT`, `CORS_ORIGIN`, `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`, `MAIL_HOST`, `MAIL_PORT`, `MAIL_FROM`, `LOG_LEVEL`
- **`.env.test`** — 独立配置，DATABASE_URL 指向 Docker PostgreSQL（端口 15432），不设 REDIS_URL（fallback 内存缓存）

### Updated — 文档

- **`docs/environment.md`** — 反映新的单文件自包含结构和加载顺序
- **`.env.development.example`** / **`.env.production.example`** — 同步所有变量

---

## 2026-05-28 (OpenAPI + 运行时修复 + 日志滚动)

### Added — OpenAPI / Swagger 文档

- **Swagger 配置** (`src/setup-app.ts`)
  - `@nestjs/swagger` 集成，路径 `/api/docs`
  - `SwaggerModule.setup()` 自动生成 OpenAPI 3.0 规范
  - 所有 Auth DTO 添加 `@ApiProperty()` 装饰器（14 个文件）
- **依赖新增** — `@nestjs/swagger@^11`

### Added — Winston 日志按天滚动

- **日志文件输出** (`src/common/logger/logger.config.ts`)
  - 新增 `winston-daily-rotate-file` transport
  - `app-YYYY-MM-DD.log` — 全量日志，按天滚动
  - `error-YYYY-MM-DD.log` — 仅 error 级别，独立归档
  - 滚动策略：`maxSize: 20m`，`maxFiles: 30d`，`zippedArchive: true`
  - 日志目录：项目根 `logs/`（已被 `.gitignore` 覆盖）
- **依赖新增** — `winston-daily-rotate-file@^5`

### Fixed — Prisma v7 运行时兼容

- **PrismaService** (`src/prisma/prisma.service.ts`)
  - Prisma v7 不再自动读取 `DATABASE_URL`，需显式传递 adapter
  - 安装 `@prisma/adapter-pg`，使用 `new PrismaPg({ connectionString })` 构造 adapter
  - `super({ adapter })` 替代旧的 `super()` 调用
- **依赖新增** — `@prisma/adapter-pg@^7.8.0`

### Fixed — 环境变量校验

- **environment.validation.ts** (`src/config/environment.validation.ts`)
  - `DATABASE_URL` / `REDIS_URL` 的 Joi `.uri({ scheme: regex })` 改为 `.uri({ scheme: ['postgres', 'postgresql'] })`（Joi v18 不支持 regex）
  - `AI_*` / `MAIL_*` 可选字段添加 `.allow('')`，兼容 `.env` 中的空值
  - `CORS_ORIGIN` 添加 `.allow('')`

---

## 2026-05-27 (Auth Step 3 — 密码 & 账号管理)

### Changed — 桩实现替换为真实实现

- **AuthService** (`src/auth/auth.service.ts`)
  - `forgotPassword` — 发送重置密码验证码（`reset-password` scene），安全策略：无论邮箱是否存在都返回成功提示（防邮箱枚举攻击）
  - `resetPassword` — 验证码校验 + argon2id 哈希新密码 + 登出所有设备
  - `changeEmail` — 新增 `currentEmail` 验证码校验（`change-email` scene），防止未授权修改邮箱
  - `deleteAccount` — 从硬删除改为软删除（`deletedAt = new Date()`），保留数据可恢复性

### Changed — ChangeEmailDto 扩展

- **ChangeEmailDto** (`src/auth/dto/change-email.dto.ts`)
  - 新增 `currentEmail` 字段（`@IsEmail`，必填）— 用于验证当前邮箱的验证码

### Changed — AuthController 异步化

- **AuthController** (`src/auth/auth.controller.ts`)
  - `forgotPassword` / `resetPassword` 改为 `async`，正确 `await` AuthService 返回值

---

## 2026-05-27 (Auth Step 0 — 数据库基础设施)

### Added — Prisma + PostgreSQL 设置

- **Prisma Schema** (`prisma/schema.prisma`)
  - `User` 模型：id, email (unique), password, nickname, avatar, emailVerified, deletedAt, createdAt, updatedAt
  - `RefreshToken` 模型：id, token (unique), userId, expiresAt, createdAt，外键关联 User（级联删除）
  - Generator 输出到 `src/generated/prisma`，使用 `prisma-client` provider (Prisma v7)
  - Datasource: PostgreSQL，URL 从环境变量读取

- **prisma.config.ts**
  - 手动加载 `.env.development` → `.env`（dotenv），解决 Prisma CLI 无法读取环境差异文件的问题
  - DATABASE_URL 从 `process.env['DATABASE_URL']` 获取

- **PrismaService** (`src/prisma/prisma.service.ts`)
  - 继承 `PrismaClient`，实现 `OnModuleInit` / `OnModuleDestroy`
  - 模块初始化时 `$connect()`，销毁时 `$disconnect()`

- **PrismaModule** (`src/prisma/prisma.module.ts`)
  - `@Global()` 全局模块，导出 PrismaService
  - 已在 AppModule 中注册

- **Docker PostgreSQL 容器**
  - 容器名：`lucent-postgres`，镜像：`postgres:16-alpine`
  - 端口映射：`127.0.0.1:15432:5432`（Hyper-V 占用 5432，改用 15432）
  - 用户/密码/数据库：postgres/postgres/lucent

- **数据库迁移**
  - `prisma migrate dev --name init` 成功创建 `users` 和 `refresh_tokens` 表

- **Prisma Client 生成**
  - `prisma generate` 输出到 `src/generated/prisma/`

- **依赖变更**
  - 新增 `dotenv` (devDependency) — prisma.config.ts 需要

### Changed — 环境配置

- `.env.development` — `DATABASE_URL` 端口从 `5432` 改为 `15432`

---

## 2026-05-27 (Auth Step 1.5 — 验证码服务)

### Added — VerificationCodeService 真实实现

- **VerificationCodeService** (`src/auth/verification-code.service.ts`)
  - `send(email, scene)` — 生成 6 位随机验证码（`crypto.randomInt`），存入 Cache，调用 MailService 发送邮件
  - `verify(email, code, scene)` — 从 Cache 校验验证码，一次性（校验后删除）
  - 频率限制：60s cooldown（`vcode:cd:{scene}:{email}`），验证码 TTL 5min（`vcode:{scene}:{email}`）
  - 依赖 `CACHE_MANAGER`（全局 CacheModule）和 `MailService`

- **AuthService 实桩替换**
  - `sendVerificationCode` — 调用 VerificationCodeService.send
  - `verifyEmail` — 调用 VerificationCodeService.verify + UserService.updateByEmail 标记邮箱已验证
  - `login` — 支持 `dto.code` 验证码登录（可选，与密码登录互斥）

- **UserService 新增**
  - `updateByEmail(email, data)` — 按邮箱更新用户（用于 verifyEmail 场景）

- **AuthModule** — 注册 `VerificationCodeService` 为 provider

- **AuthController** — `sendVerificationCode` 和 `verifyEmail` 方法改为 `async`

### Changed — ResultCode 枚举

- `api-envelope.ts` 新增：
  - `VERIFICATION_CODE_INVALID = 400_100` — 验证码错误/过期
  - `VERIFICATION_CODE_COOLDOWN = 400_101` — 发送过于频繁

---

## 2026-05-27 (Auth Step 1 — Controller 层)

### Added — AuthController + AuthModule

- **AuthController** (`src/auth/auth.controller.ts`)
  - 13 个路由，严格对齐 `docs/auth-api-mock.md`：
    - `POST /auth/register` — 注册 → 201
    - `POST /auth/login` — 密码登录
    - `POST /auth/logout` — 登出（需认证）
    - `POST /auth/refresh` — 刷新 Token（无需认证）
    - `POST /auth/send-verification-code` — 发送验证码（桩）
    - `POST /auth/verify-email` — 验证邮箱（桩）
    - `POST /auth/forgot-password` — 忘记密码（桩）
    - `POST /auth/reset-password` — 重置密码（桩）
    - `GET /auth/me` — 获取当前用户（需认证）
    - `PATCH /auth/me` — 更新当前用户（需认证）
    - `POST /auth/me/password` — 修改密码（需认证）
    - `POST /auth/me/email` — 修改邮箱（需认证）
    - `DELETE /auth/me` — 注销账号（需认证）
  - 受保护路由使用 `@UseGuards(JwtAuthGuard)` + `@CurrentUser()` 提取用户
  - `/auth/refresh` 不加 Guard（accessToken 可能已过期）
  - 响应格式严格遵循 `successEnvelope`（`{ code: 0, message: "", data }`）

- **AuthModule** (`src/auth/auth.module.ts`)
  - 导入 `UserModule`、`PassportModule`、`JwtModule`
  - 注册 `AuthService`、`JwtAccessStrategy`、`AuthController`
  - 导出 `AuthService` 供其他模块使用

- **app.module.ts** — 注册 `AuthModule`

---

## 2026-05-27 (Git 提交约束)

### Added — Git 提交规范工具链

- **commitlint** — `commitlint.config.mjs`
  - 基于 `@commitlint/config-conventional`
  - 类型枚举：`feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`
  - 允许中文 subject，header 最大 120 字符

- **husky** — Git hooks 管理
  - `.husky/pre-commit` — 运行 `lint-staged`（暂存文件 lint + prettier）
  - `.husky/commit-msg` — 运行 `commitlint`（校验 commit message 格式）

- **lint-staged** — 暂存文件检查
  - `*.ts` → eslint --fix + prettier --write
  - `*.{json,md,yml,yaml}` → prettier --write

- **依赖新增**
  - `@commitlint/cli@^21.0.1`, `@commitlint/config-conventional@^21.0.1`
  - `husky@^9.1.7`, `lint-staged@^17.0.5`

- **脚本更新** — `package.json` 新增 `"prepare": "husky"`
- **ESLint 更新** — `commitlint.config.mjs` 加入 ignores

---

## 2026-05-27 (Auth Step 1 — 核心认证)

### Added — Auth 核心认证模块 (Step 1)

- **JWT 配置** (`src/config/jwt.config.ts`)
  - `registerAs(ConfigKey.Jwt, ...)`，支持 `accessSecret` / `refreshSecret` / `accessTtl` / `refreshTtl`
  - `ConfigKey` 新增 `Jwt` 枚举值

- **User 模块** (`src/user/`)
  - `UserService` — `create`, `findByEmail`, `findById`, `update` (CRUD)
  - `UserModule` — `@Global()`，导出 `UserService`

- **DTO 层** (`src/auth/dto/`)
  - 14 个 class-validator DTO：`RegisterDto`, `LoginDto`, `RefreshDto`, `LogoutDto`, `UpdateMeDto`, `ChangePasswordDto`, `ChangeEmailDto`, `DeleteAccountDto`, `SendVerificationCodeDto`, `VerifyEmailDto`, `ForgotPasswordDto`, `ResetPasswordDto`
  - 统一导出 `src/auth/dto/index.ts`

- **AuthService** (`src/auth/auth.service.ts`)
  - `register` — 邮箱唯一性检查 + argon2id 密码哈希 + JWT 签发
  - `login` — 密码验证 + 登录频率限制（内存，待迁 Redis）
  - `refresh` — Refresh Token 旋转（旧 token 删除 + 新 token 签发）
  - `logout` / `logoutAll` — 单设备 / 全设备登出
  - `getMe` / `updateMe` — Profile 读写
  - `changePassword` / `changeEmail` / `deleteAccount` — 账号管理
  - `sendVerificationCode` / `verifyEmail` / `forgotPassword` / `resetPassword` — 邮件验证 & 密码重置（桩实现）
  - Argon2id 参数：memoryCost 19456, timeCost 2, parallelism 1（OWASP 2024 推荐）
  - Refresh Token 存储原始值（高熵随机字符串，HTTPS 传输保障）

- **JWT Strategy + Guard** (`src/auth/strategies/`, `src/auth/guards/`)
  - `JwtAccessStrategy` — Passport Strategy，`HS512` 算法，从 `Authorization: Bearer` 提取 token
  - `JwtAuthGuard` — `@UseGuards(JwtAuthGuard)` 触发验证

- **CurrentUser 装饰器** (`src/auth/decorators/current-user.decorator.ts`)
  - `@CurrentUser()` 提取 `request.user` (UserPayload: `{ sub, email }`)
  - `@CurrentUser('sub')` 提取单个字段

- **依赖新增**
  - `passport@^0.7.0`, `passport-jwt@^4.0.1`, `@nestjs/passport@^11.0.0`, `@nestjs/jwt@^11.0.0`
  - `@types/passport-jwt@^4.0.1`

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
