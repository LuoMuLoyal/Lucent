# Better Auth 主认证迁移计划（移动端 JWT 保持不变）

**Goal:** 用 Better Auth 替代 Lucent 中大部分手写的用户认证基础设施，同时保持 Luminous 现有 JWT access/refresh 合同不变；Security PIN/敏感操作再认证只是最后一个小型配套任务。

**Architecture:** Better Auth 成为用户、credential account、密码、邮箱验证、密码重置、标准 OAuth 和认证会话的主认证内核。Lucent 保留 API facade、Problem Details、i18n、审计、业务账户规则，以及为了满足移动端合同而保留的 JWT access/refresh facade。Luminous 不接收 Better Auth cookie/session，不增加第二套客户端认证状态。

**Tech Stack:** Better Auth `1.7.1`、`@better-auth/prisma-adapter`、Prisma 7、NestJS/Fastify、现有 HS512 JWT、Redis、Luminous Flutter/Dio。

---

## 一、主线与非主线

### 主线：Better Auth 替代手写 auth

- 用户和认证 account 数据模型；
- email/password 注册、登录、改密、重置密码；
- 邮箱验证和验证 token；
- 标准 OAuth provider；
- session、account linking 和撤销语义；
- Lucent API facade、Problem Details、i18n、审计和 OpenAPI；
- Luminous JWT 客户端合同同步。

### 配套：敏感操作再次输入账户密码

- 不采用 Better Auth TOTP；
- 不采用 Better Auth `twoFactor` plugin；
- 不新增二级密码、TOTP、backup code 或 trusted device；
- 当前需要 PIN 的接口改为请求内再次提交账户主密码；
- 不签发 elevation token，不维护二次验证 session。

这部分必须放在主认证迁移完成之后，不得成为 Better Auth 迁移的架构中心。

## 二、固定约束

- Luminous 继续使用现有 JWT access/refresh；JWT 格式、刷新接口、刷新 rotation 和客户端存储不改。
- Better Auth cookie/session 不进入 Luminous 主认证链路。
- Better Auth JWT plugin 不被当作现有 JWT pair 的替代品；Lucent `AuthTokenService` 继续作为移动端 JWT facade，直到另立决策证明可以安全替换。
- 旧用户、旧密码 hash、旧 PIN、旧 auth/session 数据不迁移。
- `User`、Better Auth user/account/session 表可以直接调整或重建。
- 不保留新旧 auth 代码并存的生产兼容期。
- Better Auth 原始错误 body 不直接暴露给客户端，所有错误统一映射为 Lucent Problem Details。

## 三、推荐目标架构

```text
Luminous
  │ 现有 JWT access/refresh
  ▼
Lucent Auth API Facade
  ├─ Problem Details / i18n / audit / rate limit
  ├─ Better Auth adapter：user/account/password/email/OAuth/session
  └─ JWT facade：现有 access/refresh/rotation 合同
       │
       ▼
Better Auth + Prisma 7
```

Better Auth 是认证事实来源，但不直接把自己的 cookie、session token 或默认响应格式暴露给 Luminous。Lucent 负责把 Better Auth 的结果转换为当前跨仓 API 合同，并在登录成功后继续生成现有 JWT pair。

由于 Better Auth 没有直接提供 Lucent 当前的 access/refresh pair 和 refresh rotation，第一阶段不删除 `AuthTokenService`；它的职责从“完整手写 auth”收缩为“移动端 JWT facade”。

## 四、数据模型策略

旧用户不迁移，因此不做旧 `User.passwordHash`、`UserIdentity`、`UserSession` 的兼容读取。

目标是让 Better Auth user ID 成为新的领域用户稳定 ID，避免在每个业务表增加 auth-user 映射：

- Better Auth user 表与 Lucent domain user 关系直接统一，或使用 Prisma 显式映射到新的 `users` 表；
- credential password 移入 Better Auth `account.password`；
- OAuth identity 移入 Better Auth `account`，保留 Lucent 必需的 unionId/provider profile 扩展；
- Better Auth session/account/verification 表由 Prisma migration 新建；
- 领域 profile、健康数据、设置、审计仍由 Lucent 领域模块拥有；
- 软删除和领域关系不得被 Better Auth 默认 user 删除语义静默覆盖。

需要在隔离数据库先验证 Prisma 7 多文件 schema、custom output、Better Auth core schema 和现有领域 relation，然后再生成正式 migration。

## 五、迁移任务

### Task 1：Better Auth 基础依赖与 Prisma schema spike

**目标文件：**

- `package.json`
- `pnpm-lock.yaml`
- `src/modules/auth/config/` 或新的 Better Auth 配置入口
- `prisma/schema.prisma`
- `prisma/models/user.prisma`
- 隔离测试数据库 schema

**内容：**

- 固定 `better-auth@1.7.1`、`@better-auth/prisma-adapter@1.7.1`；
- 验证 Prisma 7 custom output 与多文件 schema；
- 生成 Better Auth core user/session/account/verification schema；
- 验证 user ID 与领域表外键关系；
- 验证 `account.password`、OAuth account、session、verification 的字段映射；
- 验证 Argon2id hash/verify callback 的接入形状；
- 不连接生产数据，不执行旧用户迁移。

**通过条件：** 隔离数据库可以创建新 auth schema，Better Auth 能读写新用户和 credential account，领域表仍可通过稳定 user ID 访问。

### Task 2：Better Auth 配置与基础 adapter

**目标文件：**

- 新建 `src/modules/auth/config/better-auth.config.ts`
- 新建 `src/modules/auth/adapters/better-auth.adapter.ts`
- `src/modules/auth/auth.module.ts`
- `src/config/env/`
- `src/modules/auth/index.ts`

**内容：**

- 配置 Prisma adapter、secret、baseURL、trusted origins；
- 配置 Argon2id `password.hash`/`password.verify`；
- 配置邮箱发送回调到现有 Notifications/Mail service；
- 配置 Better Auth 错误到 Lucent `DomainFailure` 的映射入口；
- 不注册 `twoFactor`、`bearer` 或 cookie client 作为 Luminous 主认证方式；
- Better Auth 的公开 handler 不直接绕过 Nest/Fastify facade。

### Task 3：迁移 credential/password 领域

**目标文件：**

- `src/modules/auth/services/identity/credential.service.ts`
- `src/modules/auth/controllers/local.controller.ts`
- `src/modules/auth/dto/credentials/`
- `src/modules/auth/services/identity/verification-code.service.ts`
- 对应 specs

**内容：**

- 注册、登录改为调用 Better Auth credential API；
- 保留 Lucent DTO、反枚举、i18n、限流和 Problem Details；
- Argon2id 由 Better Auth callback 统一执行；
- 邮箱验证 token、密码重置 token 和邮件投递接入 Better Auth lifecycle；
- 改密成功后继续执行 Lucent 的审计、通知和 JWT/session 撤销语义；
- 登录成功后由 JWT facade 生成现有 access/refresh pair；
- 不把 Better Auth 原始 session token 返回给 Luminous。

### Task 4：迁移标准 OAuth 与账户身份

**目标文件：**

- `src/modules/auth/controllers/oauth.controller.ts`
- `src/modules/auth/services/oauth/`
- `src/modules/auth/providers/`
- `src/modules/account/services/account.service.ts`
- OAuth DTO/spec

**内容：**

- Apple、Google 等标准 provider 优先接入 Better Auth；
- 账号绑定、解绑、账号合并和审计继续由 Lucent facade 控制；
- WeChat Web/Mobile、QQ、Weibo 的 provider-specific 流程保留 Lucent adapter，逐个验证 generic OAuth 是否覆盖；
- unionId、providerUserId、防账号接管和重复身份冲突必须保留；
- OAuth 登录成功后统一进入 Lucent JWT facade，不向客户端发 cookie/session。

### Task 5：收缩 JWT facade，而不是删除 JWT

**目标文件：**

- `src/modules/auth/services/token.service.ts`
- `src/modules/auth/repositories/session.repository.ts`
- `src/modules/auth/controllers/session.controller.ts`
- `src/modules/auth/strategies/jwt-access.strategy.ts`
- `src/modules/auth/guards/jwt-auth.guard.ts`

**内容：**

- 保持 `POST /api/v1/auth/refresh` 和现有 JWT response contract；
- 保持 HS512、access/refresh TTL、refresh hash、单次 rotation 和并发 claim 语义；
- 登录/OAuth/注册成功后由 Better Auth user 映射到 Lucent JWT payload；
- session list/revoke API 映射到最终选定的 Better Auth/Lucent session source；
- 在没有证明 Better Auth 能完全替换 pair/rotation 前，不删除 `AuthTokenService`；
- Luminous JWT interceptor、retry 判断和安全存储不改。

### Task 6：同步 API 错误、i18n、审计和 OpenAPI

**目标文件：**

- `src/common/api/problem-catalog.ts`
- `src/common/filters/`
- `src/modules/auth/controllers/`
- `src/i18n/en/`
- `src/i18n/zh-CN/`
- `docs/01-reference/contracts/`
- `docs/openapi.json`

**内容：**

- Better Auth 错误转换为准确的 `DomainFailure`/Problem Details；
- 保留反枚举、错误标题、detail、retryable、Retry-After 语义；
- 密码错误、邮箱已存在、OAuth provider 失败、session 失效不得模糊成 500；
- 认证敏感操作写审计，但不写 token/password/secret；
- Lucent 导出 OpenAPI，禁止手工维护生成客户端。

### Task 7：Luminous 客户端同步

**目标范围：**

- Luminous generated API client
- auth repository/provider
- Dio auth/retry/error interceptor
- 登录、注册、密码重置、OAuth、session 页面和测试

**内容：**

- 继续只存储和发送 Lucent JWT；
- 不引入 Better Auth cookie、session token 或 Bearer token；
- 按新的 OpenAPI 同步 auth resource 和 Problem Details；
- 保留现有 refresh 竞态保护和失败分类；
- Better Auth 原始错误不进入前端。

### Task 8：最后替换 Security PIN 为密码再认证

这是主认证迁移完成后的配套任务，范围严格限制为当前 PIN 接口：

- `POST /api/v1/account/password`
- `POST /api/v1/account/email`
- `DELETE /api/v1/account/identities/:identityId`
- `DELETE /api/v1/account`
- `POST /api/v1/user/data-export-requests`

实现方式：

- 敏感请求再次提交账户主密码；
- 复用 Better Auth 主密码 verifier 的统一端口；
- 正确后在同一请求内执行操作；
- 不签发 elevation JWT、opaque grant 或 TOTP；
- 设置资源改为 `passwordReauthenticationRequired: true`；
- 设置页显示“敏感操作需再次输入密码”；
- 密码不进入日志、审计 metadata、错误 detail 或 BullMQ payload；
- 连续失败使用 Redis 原子限流并返回 Problem Details；
- OAuth-only 用户必须先设置账户密码。

### Task 9：删除旧手写 auth 和旧 PIN

只有前面任务与双端验证完成后执行：

- 删除被 Better Auth adapter 替代的 credential/verification/OAuth 重复代码；
- 将 `AuthTokenService` 保留为 JWT facade，不误删；
- 删除 `src/modules/security-pin/`、elevation guard/decorator/types；
- 删除 `securityPinEnabled`、`securityPinHash`、`securityPinChangedAt`、`securityElevationVersion`；
- 删除 `x-security-elevation` 契约和旧 PIN 文案；
- 清理旧 migration 依赖；
- 不保留新旧 auth 逻辑并存期。

### Task 10：最终门禁

- `pnpm lint:check`
- `pnpm format:check`
- `pnpm typecheck`
- `pnpm typecheck:tools`
- `pnpm build`
- `pnpm test:ci`
- `pnpm test:e2e:ci`
- `pnpm docs:verify`
- Luminous `flutter analyze`
- Luminous `flutter test`
- Luminous 文档覆盖率验证
- 双端登录、注册、改密、重置、邮箱验证、OAuth、JWT refresh、session 撤销、敏感操作密码再认证验收

## 五、明确不采用的方案

- Better Auth TOTP 作为当前敏感操作二次验证；
- Better Auth `twoFactor` 登录挑战；
- Better Auth cookie/session 替代移动端 JWT；
- Better Auth JWT plugin 直接替代 Lucent access/refresh rotation；
- Luminous 同时持有 JWT 和 Better Auth session token；
- 在主认证迁移未完成前删除 `AuthTokenService`；
- 把密码再认证扩展成通用 step-up 权限平台。

## 六、完成标准

- Better Auth 成为主认证用户、credential、邮箱验证、密码重置和标准 OAuth 的事实来源；
- Lucent 保留并稳定输出现有移动端 JWT 合同；
- Luminous 不需要 cookie 或第二套认证状态；
- 所有认证错误均为真实可用的 Problem Details，保留 i18n 和可观测性；
- 当前五个 PIN 接口改为再次输入账户密码；
- 旧用户不迁移，旧手写 auth/PIN 代码在最终验收后删除；
- Better Auth 与 Lucent 的职责边界通过代码、OpenAPI、测试和文档验证。

## 参考依据

- `Lucent/plans/2026-08-22-better-auth-feasibility.md`
- `src/modules/auth/services/identity/credential.service.ts`
- `src/modules/auth/services/token.service.ts`
- `src/modules/auth/services/oauth/`
- `src/modules/account/account.controller.ts`
- `src/modules/data-export/data-export.controller.ts`
- `src/modules/security-pin/`
- `src/modules/user-settings/`
- [Better Auth Email & Password](https://better-auth.com/docs/authentication/email-password)
- [Better Auth Database](https://better-auth.com/docs/concepts/database)
- [Better Auth Prisma adapter](https://better-auth.com/docs/adapters/prisma)
- [Better Auth Generic OAuth](https://better-auth.com/docs/plugins/generic-oauth)
- [Better Auth JWT plugin](https://better-auth.com/docs/plugins/jwt)
