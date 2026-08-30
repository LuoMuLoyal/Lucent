# auth

认证与安全模块——管理用户注册/登录/会话/OAuth/密码重置/邮箱验证等全流程。
基于 Better Auth + JWT 双层架构，支持 6 种 OAuth 提供商和本地凭据登录。

## Architecture

```
                    ┌──────────────────────────────────┐
                    │         AuthService (facade)      │
                    │  register / login / logout       │
                    │  refresh / changePassword / etc. │
                    └──┬───────┬───────────┬───────────┘
                       │       │           │
           ┌───────────┘       │           └───────────┐
           ↓                   ↓                       ↓
  CredentialAuthService   AuthTokenService      AuthOAuthFacadeService
  (register/login/        (JWT pair +           (OAuth state +
   password verify)        session CRUD)         provider dispatch)
           │                   │                       │
           ↓                   ↓                       ↓
  AuthBetterAuthAdapter   AuthSessionRepository   6 OAuth Providers
  (argon2 + Prisma)       (port interface)        (wechat/apple/google/
                                                   qq/weibo)
```

## Controllers (`controllers/`)

| Controller          | Route Prefix | Endpoints                                                                                                                        |
| ------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `LocalController`   | `/auth`      | `POST register`, `POST login`, `POST send-verification-code`, `POST verify-email`, `POST forgot-password`, `POST reset-password` |
| `OAuthController`   | `/auth`      | `POST oauth/{provider}/authorize`, `POST oauth/{provider}/callback` × 6 providers                                                |
| `SessionController` | `/auth`      | `POST logout`, `GET sessions`, `DELETE sessions/:id`, `POST refresh`                                                             |

> 所有 `LocalController` 和 `OAuthController` 端点标记 `@Public()`，不需要 access token。
> `SessionController` 需要 `@ApiBearerAuth('access-token')`。

## OAuth Providers (`providers/`)

6 种 OAuth 提供商，均实现 `OAuthProvider` 接口（`fetchProfile` + 可选 `buildAuthorizeUrl`）：

| Provider      | Class                       | Flow Type                         | Trusted? |
| ------------- | --------------------------- | --------------------------------- | -------- |
| WeChat Web    | `WechatWebOAuthProvider`    | Authorization Code (web redirect) | No       |
| WeChat Mobile | `WechatMobileOAuthProvider` | Native UI (no redirect URL)       | No       |
| Apple         | `AppleOAuthProvider`        | Authorization Code                | **Yes**  |
| Google        | `GoogleOAuthProvider`       | Authorization Code                | **Yes**  |
| QQ            | `QqOAuthProvider`           | Authorization Code                | No       |
| Weibo         | `WeiboOAuthProvider`        | Authorization Code                | No       |

> **Trusted providers** (Apple, Google) 会自动关联到已有用户账号（无需手动 linking）。
> `BETTER_AUTH_TRUSTED_PROVIDERS` 是唯一事实源，Better Auth 配置和 OAuth linking 逻辑都引用它。

## Services (`services/`)

| Service                   | Responsibility                                                         |
| ------------------------- | ---------------------------------------------------------------------- |
| `AuthService`             | Facade — 委托到子服务，不包含业务逻辑                                  |
| `CredentialAuthService`   | 注册、登录、密码验证（通过 Better Auth API）                           |
| `AuthAccountService`      | 账号生命周期（改密码、改邮箱、删账号）                                 |
| `AuthTokenService`        | JWT access/refresh token 生成、session CRUD                            |
| `AuthOAuthFacadeService`  | OAuth 流程编排（state → authorize → callback → profile → link/create） |
| `AuthOAuthService`        | OAuth profile → user 链接/创建逻辑                                     |
| `AuthOAuthStateService`   | OAuth state 生成与验证（CSRF 防护）                                    |
| `AuthNotificationService` | 安全通知（登录提醒、密码变更通知），通过 `INotificationSender` port    |
| `AuthRateLimitService`    | 登录失败限流（基于 `RedisService.atomicIncrement`）                    |
| `PasswordReauthService`   | 敏感操作前的密码重验（re-entry，非 token）                             |
| `VerificationCodeService` | 邮箱验证码生成与校验                                                   |

### Identity 子目录 (`services/identity/`)

| Service                   | Responsibility                             |
| ------------------------- | ------------------------------------------ |
| `CredentialAuthService`   | 注册/登录（通过 Better Auth `auth.api.*`） |
| `PasswordReauthService`   | 敏感操作密码重验                           |
| `RateLimitService`        | 登录失败计数与锁定                         |
| `VerificationCodeService` | 邮箱验证码 6 位随机码 + TTL                |

## Repositories (`repositories/`)

| Repository              | Port Interface              | Table                               |
| ----------------------- | --------------------------- | ----------------------------------- |
| `AuthSessionRepository` | `AuthSessionRepositoryPort` | `AuthSession`                       |
| `AuthAccountRepository` | `AuthAccountRepositoryPort` | `AuthAccount` (Better Auth managed) |

## Better Auth Adapter (`adapters/`)

`AuthBetterAuthAdapter` 封装 [Better Auth](https://better-auth.com) 库：

- 使用 Prisma adapter 对接 Lucent 的合并 `User` 模型
- 密码哈希使用 argon2（`ARGON2_OPTIONS` 配置在 `config/argon2-options.ts`）
- 字段映射：`name` → `nickname`，`image` → `avatar`
- 不暴露 HTTP 路由——仅作为 service 被调用

## JWT & Session

- **Access token**: 短期 JWT，通过 `JwtAccessStrategy` 验证
- **Refresh token**: 长期 JWT，存储于 `AuthSession` 表
- **Session**: 每次 login 创建一条 session 记录，logout 时删除
- Token 配置（secret, TTL, issuer, audience）通过 `ConfigKey.Jwt` 读取
- `UserPayload` 是 JWT payload 类型，包含 `sub` (userId)

## Guards & Decorators

| Symbol              | File                                   | Purpose            |
| ------------------- | -------------------------------------- | ------------------ |
| `JwtAuthGuard`      | `guards/jwt-auth.guard.ts`             | 全局 JWT 认证守卫  |
| `@Public()`         | `decorators/public.decorator.ts`       | 标记路由不需要认证 |
| `@CurrentUser()`    | `decorators/current-user.decorator.ts` | 注入 `UserPayload` |
| `JwtAccessStrategy` | `strategies/jwt-access.strategy.ts`    | Passport JWT 策略  |

## Module Exports

通过 `index.ts` barrel 导出：

- `AuthService` — 被 `account` 模块使用
- `AuthBetterAuthAdapter` — 被测试和内部使用
- `PasswordReauthService` — 被敏感路由使用（密码重验）
- `JwtAuthGuard` — 全局守卫注册
- `@Public()`, `@CurrentUser()` — 跨模块装饰器
- `UserPayload` (type) — JWT payload 类型
- OAuth provider classes — 被外部引用
- 各种 DTO — 被 `account` 模块引用

## Dependencies

**Imports**: `UserModule`, `NotificationsModule`, `MailModule`, `PassportModule`,
`JwtModule`

**Cross-Module DI**: `INotificationSender` (Phase 3 port 隔离)，
`UserService`（直接注入，未 port 化——auth 是 account 管理协作者，port 化收益低）

## API Route Summary

| Method   | Path                               | Auth   | Description              |
| -------- | ---------------------------------- | ------ | ------------------------ |
| `POST`   | `/auth/register`                   | Public | 注册（需验证码）         |
| `POST`   | `/auth/login`                      | Public | 登录                     |
| `POST`   | `/auth/send-verification-code`     | Public | 发送邮箱验证码           |
| `POST`   | `/auth/verify-email`               | Public | 验证邮箱                 |
| `POST`   | `/auth/forgot-password`            | Public | 忘记密码（发送重置链接） |
| `POST`   | `/auth/reset-password`             | Public | 重置密码                 |
| `POST`   | `/auth/oauth/{provider}/authorize` | Public | 创建 OAuth 授权 URL      |
| `POST`   | `/auth/oauth/{provider}/callback`  | Public | OAuth 回调登录           |
| `POST`   | `/auth/logout`                     | Bearer | 登出                     |
| `GET`    | `/auth/sessions`                   | Bearer | 活跃会话列表             |
| `DELETE` | `/auth/sessions/:id`               | Bearer | 撤销指定会话             |
| `POST`   | `/auth/refresh`                    | Bearer | 刷新 token               |
