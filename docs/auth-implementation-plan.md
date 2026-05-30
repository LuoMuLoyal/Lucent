# Auth Implementation Plan

> 状态：归档 / 实施记录。
>
> Auth 基线已经完成并通过 e2e。当前进度请先读 `README.md`、`docs/README.md`、`CHANGELOG.md` 和 `docs/auth-api-mock.md`。
> 本文件只在 Auth 边界发生重大变化时补充，不再作为每日进度来源。

> 基于 [auth-api-mock.md](auth-api-mock.md) 约束，分步实现 Lucent 认证模块。
>
> **最后更新**: 2026-05-30 16:45 | **当前阶段**: Auth 基线加固完成，进入前端登录/注册体验完善
>
> ⚠️ 此文档随实施同步更新，每一步完成/变更都应反映在此文件中。

---

## 总体架构

```
Lumos/                              ← monorepo 根（pnpm + Prisma 在此层级）
  prisma/
    schema.prisma                   ← User, RefreshToken 模型
    migrations/                     ← (待 Step 0.6 生成)
  prisma.config.ts                  ← Prisma v7 配置，datasource URL
  generated/                        ← (已清理，输出改到 Lucent/src)
  .env                              ← DATABASE_URL（供 Prisma CLI 使用）

Lucent/                            ← NestJS 后端
  src/
    generated/prisma/               ← [生成] Prisma Client (v7, provider="prisma-client")
    config/
      app.config.ts
      cache.config.ts               ← [NEW] CacheModule Redis 配置
      config-keys.enum.ts           ← [UPDATED] +Mail
      env-keys.enum.ts              ← [UPDATED] +MAIL_*
      environment.validation.ts     ← [UPDATED] +Mail keys + Joi
      mail.config.ts                ← [NEW] Mail 配置 (registerAs)
    prisma/
      prisma.module.ts              ← [NEW] @Global()
      prisma.service.ts             ← [NEW] extends PrismaClient, OnModuleInit
    mail/
      mail.module.ts                ← [NEW] @Global()
      mail.service.ts               ← [NEW] send() / sendVerificationCode()
    auth/                           ← (Step 1 开始创建)
      ...
    user/                           ← (Step 1.2 开始创建)
      ...
    app.module.ts                   ← [UPDATED] +PrismaModule +MailModule +CacheModule
```

---

## 环境变量总览

```bash
# ── 数据库 (Lumos/.env, Prisma CLI 读取) ──
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/lucent?schema=public

# ── Redis (Lucent/.env.development) ──
REDIS_URL=redis://127.0.0.1:6379

# ── JWT (Step 1.1 开始使用) ──
JWT_ACCESS_SECRET=dev_access_secret_change_me
JWT_REFRESH_SECRET=dev_refresh_secret_change_me
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=14d

# ── 邮件 (Step 2.2 开始使用) ──
MAIL_DRIVER=log                 # log | smtp
MAIL_HOST=smtp.example.com
MAIL_PORT=587
MAIL_USER=
MAIL_PASS=
MAIL_FROM=noreply@example.com
```

---

## Step 0: 基础设施 ✅ (6/6)

### Step 0.1 — 安装依赖 ✅

| 类别  | 包                                                                    | 版本        |
| ----- | --------------------------------------------------------------------- | ----------- |
| ORM   | `@prisma/client`, `prisma`, `pg`                                      | ^7.8.0      |
| Auth  | `@nestjs/jwt`, `@nestjs/passport`, `passport`, `passport-jwt`         | ^11 / ^0.7  |
| Hash  | `argon2` (替代 bcrypt)                                                | ^0.44.0     |
| Cache | `@nestjs/cache-manager`, `cache-manager`, `cache-manager-ioredis-yet` | ^3.1 / ^7.2 |
| Mail  | `nodemailer`, `@types/nodemailer`                                     | ^8.0        |
| Dev   | `@types/passport-jwt`                                                 | ^4.0        |

> `argon2` 自带类型声明，无需额外 `@types/` 包。

### Step 0.2 — Prisma 初始化 + Schema ✅

**实际结构**：Prisma 配置在 `Lumos/` 根（monorepo 层级），client 生成到 `Lucent/src/generated/prisma/`。

```prisma
// Lumos/prisma/schema.prisma
generator client {
  provider = "prisma-client"
  output   = "../Lucent/src/generated/prisma"
}

datasource db {
  provider = "postgresql"
}

model User {
  id            String    @id @default(uuid())
  email         String    @unique
  password      String          // argon2 hashed
  nickname      String?
  avatar        String?
  emailVerified Boolean   @default(false)
  deletedAt     DateTime?       // 软删除
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  refreshTokens RefreshToken[]
  @@map("users")
}

model RefreshToken {
  id        String   @id @default(uuid())
  token     String   @unique    // JWT token 本体
  userId    String
  expiresAt DateTime
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@map("refresh_tokens")
}
```

**注意**：不再有 `VerificationCode` 模型 —— 验证码纯走 Redis Cache（Step 2.1）。

### Step 0.3 — 环境变量扩展 ✅

`EnvKey` 新增: `MAIL_DRIVER`, `MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, `MAIL_PASS`, `MAIL_FROM`。

`ConfigKey` 新增: `Mail`。

已更新文件:

- `src/config/env-keys.enum.ts`
- `src/config/config-keys.enum.ts`
- `src/config/environment.validation.ts` (Joi schema)
- `.env.development`, `.env.example`, `.env.development.example`, `.env.production`, `.env.production.example`

### Step 0.4 — MailModule + MailService ✅

- `MailService` 通过 `mailConfig` (registerAs) 读取配置
- `MAIL_DRIVER=log`: Winston Logger 打印邮件内容（开发用）
- `MAIL_DRIVER=smtp`: nodemailer 真实发送
- `MailModule` @Global()
- 便捷方法 `sendVerificationCode(email, code)` 已就绪

### Step 0.5 — CacheModule 集成 ✅

- `CacheConfigService` 从 `REDIS_URL` 解析 host/port/password
- 使用 `cache-manager-ioredis-yet` (redisStore)
- 默认 TTL 5 分钟
- 无 Redis URL 时 fallback 内存缓存
- @Global()

### Step 0.6 — 数据库迁移 ✅

- **Docker PostgreSQL 容器**：`lucent-postgres`（`postgres:16-alpine`）
  - 当前 `docker-compose.dev.yml` 端口映射：`127.0.0.1:5432:5432`
  - 用户/密码/数据库：`lucent/lucent_dev/lucent`
  - 历史记录中曾使用 `15432` 与 `postgres/postgres/lucent`，当前本地 e2e 以 compose 配置为准。
- **Prisma config**：`prisma.config.ts` 手动加载 `.env.development`（dotenv），解决 Prisma CLI 不读 `.env.*` 的问题
- **迁移命令**：`pnpm exec prisma migrate dev --name init` → 创建 `users` + `refresh_tokens` 表
- **Client 生成**：`pnpm exec prisma generate` → `src/generated/prisma/`
- **依赖变更**：新增 `dotenv` (devDependency)
- **.env.test**：`DATABASE_URL` 对齐 compose PostgreSQL：`postgresql://lucent:lucent_dev@127.0.0.1:5432/lucent?schema=public`

---

````

---

## Step 1: 核心认证 ✅ (14/14 完成)

### Step 1.1 — JWT 配置 ✅

- `src/config/jwt.config.ts` — `registerAs(ConfigKey.Jwt, ...)`
- `ConfigKey.Jwt` 枚举值

### Step 1.2 — UserModule + UserService ✅

- `src/user/user.service.ts` — `create`, `findByEmail`, `findById`, `update`
- `src/user/user.module.ts` — `@Global()`

### Step 1.3 — DTOs ✅

- `src/auth/dto/` — 14 个 class-validator DTO
- `src/auth/dto/index.ts` — 统一导出

### Step 1.4 — AuthService.register ✅

- 邮箱唯一性检查 + argon2id 密码哈希 + JWT 签发
- Argon2id 参数：memoryCost 19456, timeCost 2, parallelism 1

### Step 1.5 — AuthService.login（密码模式）✅

- 密码验证 + 登录频率限制（内存，待迁 Redis）
- `checkLoginRateLimit` / `recordLoginFailure` / `clearLoginFailures`
- 登录凭据边界已加固：`password` / `code` 必须且只能提供一种；空凭据和双凭据都会拒绝。

### Step 1.6 — Token 管理 ✅

- `refresh` — Refresh Token 旋转（旧删除 + 新签发）
- `logout` / `logoutAll` — 单设备 / 全设备登出
- Refresh Token 存储原始值（高熵随机字符串）

### Step 1.7 — JWT Strategy + Guard ✅

- `src/auth/strategies/jwt-access.strategy.ts` — Passport Strategy, HS512
- `src/auth/guards/jwt-auth.guard.ts` — `@UseGuards(JwtAuthGuard)`
- `src/auth/decorators/current-user.decorator.ts` — `@CurrentUser()`

### Step 1.8 — AuthController.register ✅

- `POST /auth/register` → `201`
- 返回 `{ user, tokens }`，格式对齐 auth-api-mock.md

### Step 1.9 — AuthController.login ✅

- `POST /auth/login` → `200`
- 返回 `{ user, tokens }`
- 已修复空凭据只凭邮箱登录的安全漏洞。

### Step 1.10 — AuthController.logout ✅

- `POST /auth/logout`（需认证）
- 删除对应 refreshToken，返回 `null`

### Step 1.11 — AuthController.refresh ✅

- `POST /auth/refresh`（无需认证）
- 返回新的 `{ accessToken, refreshToken, expiresIn }`

### Step 1.12 — AuthController.getMe ✅

- `GET /auth/me`（需认证）
- 返回用户 profile

### Step 1.13 — AuthController.updateMe ✅

- `PATCH /auth/me`（需认证）
- 更新 nickname / avatar，返回更新后的 profile

### Step 1.14 — AuthController 完整路由 + AuthModule ✅

**额外路由**（AuthService 方法已就绪，Controller 一并实现）：

- `POST /auth/send-verification-code` — 桩实现
- `POST /auth/verify-email` — 桩实现
- `POST /auth/forgot-password` — 桩实现
- `POST /auth/reset-password` — 桩实现
- `POST /auth/me/password` — 修改密码（需认证）
- `POST /auth/me/email` — 修改邮箱（需认证）
- `DELETE /auth/me` — 注销账号（需认证）

**新增文件**：

- `src/auth/auth.controller.ts` — 13 个路由
- `src/auth/auth.module.ts` — 导入 UserModule / PassportModule / JwtModule，注册 AuthService + JwtAccessStrategy

**修改文件**：

- `src/app.module.ts` — 注册 AuthModule

---

## Step 2: 验证码系统 ✅ (4/4 完成)

### Step 2.1 — VerificationCodeService ✅

- `src/auth/verification-code.service.ts` — 新建
- `send(email, scene)` — 生成 6 位随机验证码（`crypto.randomInt`），存入 Cache，调用 MailService 发送邮件
- `verify(email, code, scene)` — 从 Cache 校验验证码，一次性（校验后删除）
- 频率限制：60s cooldown（`vcode:cd:{scene}:{email}`），验证码 TTL 5min（`vcode:{scene}:{email}`）
- 依赖 `CACHE_MANAGER`（全局 CacheModule）和 `MailService`

### Step 2.2 — AuthController.sendVerificationCode ✅

- `src/auth/auth.controller.ts` — `sendVerificationCode` 方法改为 `async`
- `src/auth/auth.service.ts` — `sendVerificationCode` 桩替换为调用 `VerificationCodeService.send`

### Step 2.3 — AuthController.verifyEmail ✅

- `src/auth/auth.controller.ts` — `verifyEmail` 方法改为 `async`
- `src/auth/auth.service.ts` — `verifyEmail` 桩替换为调用 `VerificationCodeService.verify` + `UserService.updateByEmail`

### Step 2.4 — AuthService.login（验证码模式）✅

- `src/auth/auth.service.ts` — `login` 方法支持 `dto.code` 验证码登录（可选，与密码登录互斥）
- `src/user/user.service.ts` — 新增 `updateByEmail(email, data)` 方法

### Step 2 附加 — ResultCode 枚举扩展 ✅

- `src/common/api-envelope.ts` — 新增：
  - `VERIFICATION_CODE_INVALID = 400_100` — 验证码错误/过期
  - `VERIFICATION_CODE_COOLDOWN = 400_101` — 发送过于频繁
- `src/auth/auth.module.ts` — 注册 `VerificationCodeService` 为 provider

---

## Step 3: 密码 & 账号管理 ✅ (5/5 完成)

### Step 3.1 — AuthController.forgotPassword ✅

- `AuthService.forgotPassword` — 发送重置密码验证码（`reset-password` scene）
- 安全策略：无论邮箱是否存在都返回成功提示（防邮箱枚举攻击）
- `AuthController.forgotPassword` 改为 `async`

### Step 3.2 — AuthController.resetPassword ✅

- `AuthService.resetPassword` — 验证码校验 + argon2id 哈希新密码 + 登出所有设备
- `AuthController.resetPassword` 改为 `async`

### Step 3.3 — AuthController.changePassword ✅

- `AuthService.changePassword` — 验证旧密码 + 哈希新密码 + 登出所有设备（Step 1 已实现，完整）

### Step 3.4 — AuthController.changeEmail ✅

- `AuthService.changeEmail` — 新增 `currentEmail` 验证码校验（`change-email` scene）
- `ChangeEmailDto` 扩展 `currentEmail` 字段（`@IsEmail`，必填）

### Step 3.5 — AuthController.deleteAccount ✅

- `deleteAccount` 采用软删除：设置 `deletedAt`
- `UserService.findById` / `findByEmail` 默认过滤软删除用户，注销账号不再参与登录、`me` 查询和邮箱占用判断。


---

## 2026-05-30 安全与测试基线加固 ✅

### 修复范围

- 登录凭据必须二选一，阻止只传邮箱获得 token。
- JWT 签发保留 payload `sub`，移除重复 `subject` 选项，兼容 jsonwebtoken 9。
- 软删除用户默认从用户查询边界排除。
- i18n 类型生成只在 development 启用，避免 test / dist 运行时访问缺失生成文件。
- `GET /api/v1/health` 保持统一 envelope：`{ code: 0, message: '', data: {} }`。
- `pnpm test:e2e` 固化 `NODE_OPTIONS=--experimental-vm-modules`，适配 Prisma 7 `.mjs` query compiler。

### 当前验证

```bash
pnpm build
pnpm test
pnpm test:e2e
````

结果：

- `pnpm build` 通过
- `pnpm test` 通过：6 suites / 67 tests
- `pnpm test:e2e` 通过：2 suites / 30 tests

### 下一步

- 前端继续完善登录/注册页面：字段校验、成功后跳转、受保护路由、全局 session restore。
- 后端后续业务 API 继续沿用 JWT 派生用户身份，不接受 body / query `userId` 作为授权边界。

---

## 每步检查清单

- [x] TypeScript 编译通过：`pnpm build`
- [x] 不破坏已有健康检查：`GET /api/v1/health`
- [x] 新增代码遵循现有模式（envelope、filter、middleware）
- [x] Auth 主链路 e2e 通过：register / login / refresh / me / logout
- [x] 文档同步更新（本文件 + 相关 .md）
