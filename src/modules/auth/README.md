---
status: active
owner: backend
---

# auth

## 模块意图

认证与安全基础设施:注册/登录/会话/OAuth/密码重置/邮箱验证全流程。
Lucent 自持身份层(accounts 表存本地凭据与 OAuth 身份,argon2 密码哈希);
JWT(access/refresh 双 token)双层架构,支持 5 种 OAuth 提供商与本地凭据
登录,并向全应用供给守卫与认证装饰器。

身份层的两条分流必须分清:本地凭据身份是单行 `providerId = 'credential'`
(`CREDENTIAL_PROVIDER_ID`,`issuer = 'local:credential'`,`accountId` 即
userId,一个用户至多一条);每个 OAuth 链接各是一条独立身份行
(`issuer = providerId = 提供商标识`,`accountId = 提供商侧用户 id`)。

## 限界上下文(ADR-0024 目标形态)

本模块承载 **Identity & Access** 上下文(auth)。按 ADR-0024 计划中的聚合
边界(迁移到四层骨架时生效,当前仍是 service 形态):

- 聚合根:`Account`(含 OAuth identity 集)、`Session`(refresh 轮换)、
  `VerificationChallenge`(一次性消费)。
- 关键不变量:凭据校验反枚举、受信提供商自动关联(here 定义并保持唯一来源)、
  session 停用即时失效。
- 领域事件(计划):`account_registered`、`identity_linked`、
  `session_revoked`、`password_reset` 等,经 outbox 发布给下游上下文。

## 边界

- 管:凭据认证、JWT 会话、OAuth 链接、邮箱验证码、登录限流、敏感操作密码
  重验;全局 `JwtAuthGuard`、`@Public()`、`@CurrentUser()`、`UserPayload`。
- 不管:User 表 CRUD(user 模块,直接注入的协作者);登录后的账号自助管理
  (account 模块);通知实际投递(notifications 模块)。

## 依赖方向

- imports:`UserModule`、`NotificationsModule`、`MailModule`、Passport/Jwt;
  `AuditLogService` 与 `INotificationSender` 经 barrel 取。
- 被引用:几乎所有模块经 barrel 取 `@Public()`/`@CurrentUser()`/`UserPayload`;
  DI 层被 `account`、`assistant`、`data-export`、`files`、`user-settings`、`admin`
  导入。exports:`AuthService`、`AuthIdentityService`、`PasswordReauthService`、
  `AuthSessionAdminService`。

## 内部结构

- `services/auth.service.ts` — facade,委托子服务,自身不含业务逻辑。
- `services/identity/credential.service.ts` — 注册/登录(本地凭据)。
- `services/identity/identity.service.ts` — Lucent 自持身份层:argon2 哈希、
  accounts 读写、本地用户创建与凭据校验。`TRUSTED_IDENTITY_PROVIDERS`
  (=`apple`/`google`)在此定义,是"受信提供商可自动关联账号"的唯一来源;
  `AuthOAuthService` 也引用它来拒绝这些提供商的显式链接。
- `services/identity/password-reauth.service.ts` — 敏感操作前密码重验(非 token)。
- `services/identity/rate-limit.service.ts` — 登录失败限流(基于 Redis)。
- `services/identity/verification-code.service.ts` — 邮箱验证码生成与校验。
- `services/identity/password-management.service.ts` — 改/设/重置密码、改邮箱、
  验证码下发;消费 `AuthIdentityService`、`EmailVerificationService`、
  `PasswordReauthService` 与 `INotificationSender`。
- `services/token.service.ts` — JWT access/refresh 生成与 session CRUD。
- `services/session-admin.service.ts` — 管理面会话撤销(`AuthSessionAdminService`),
  包装 `AuthTokenService.revokeAll`/`revokeById`,供 admin 强制下线并审计。
- `services/account.service.ts` — auth 账号生命周期(改邮箱/密码等)。
- `services/oauth/facade.service.ts` — OAuth 流程编排(state→authorize→callback)。
- `services/oauth/oauth.service.ts` — OAuth profile → 用户链接/创建。
- `services/oauth/state.service.ts` — OAuth state 生成与 CSRF 校验。
- `services/notification.service.ts` — 安全通知(登录提醒、身份绑定)。
- `services/identity/email-verification.service.ts` — 邮箱验证 token 签发与消费。
- `providers/` — 5 个 OAuth 提供商(`wechat_web`/`wechat_mobile`/`apple`/
  `google`/`qq`,见 `types/oauth.types.ts`);Apple/Google 为受信提供商(自动关联账号)。
- `repositories/` — session/account 仓储(port + Prisma 实现)。
- `guards/jwt-auth.guard.ts`、`strategies/jwt-access.strategy.ts`、`decorators/`。

## 不变量与陷阱

- 反枚举:所有凭据失败折进同一个桶(`kind: 'authentication'` /
  `AUTH_WRONG_PASSWORD`,见 `services/identity/credential-failure.ts`)——
  不暴露账号是否存在、是否有密码、验证码是否正确。注册先校验验证码再看邮箱
  是否已注册(邮箱已存在与验证码错误同码),登录的"用户不存在/无密码/密码错"
  也折叠成同一码并计入限流。
- **依赖故障绝不能折进反枚举桶**:Argon2/DB/签 token/缓存异常由调用方映射为
  `DEPENDENCY_UNAVAILABLE`(或超时码)原样上抛。这条分界是安全保证而非风格:
  把宕机报成"密码错"会引导用户重置一个并没有问题的密码。
- 限流按邮箱(`auth:login-failure:*`,窗口 15 分钟、10 次后锁 1 小时)与
  userId(`auth:reauth-failure:*`)分桶,缓存故障保留原始异常。
- `JwtAccessStrategy` 拒绝 `status !== 'active'` 的 token,用户被停用后旧
  access token 立即失效。

## 测试承接

`services/**/*.spec.ts`、`providers/**/*.spec.ts`、
`repositories/*.spec.ts`、`guards/jwt-auth.guard.spec.ts`、
`strategies/jwt-access.strategy.spec.ts`、`decorators/*.spec.ts`
