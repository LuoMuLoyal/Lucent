---
status: active
owner: backend
---

# auth

## 模块意图

认证与安全基础设施:注册/登录/会话/OAuth/密码重置/邮箱验证全流程。
基于 Better Auth(凭据与 argon2 密码哈希)+ JWT(access/refresh 双 token)双层
架构,支持 6 种 OAuth 提供商与本地凭据登录,并向全应用供给守卫与认证装饰器。

## 边界

- 管:凭据认证、JWT 会话、OAuth 链接、邮箱验证码、登录限流、敏感操作密码
  重验;全局 `JwtAuthGuard`、`@Public()`、`@CurrentUser()`、`UserPayload`。
- 不管:User 表 CRUD(user 模块,直接注入的协作者);登录后的账号自助管理
  (account 模块);通知实际投递(notifications 模块)。

## 依赖方向

- imports:`UserModule`、`NotificationsModule`、`MailModule`、Passport/Jwt。
- 被引用:几乎所有模块经 barrel 取 `@Public()`/`@CurrentUser()`/`UserPayload`;
  DI 层被 `account`、`assistant`、`data-export`、`files`、`user-settings` 导入。
  exports:`AuthService`、`AuthBetterAuthAdapter`、`PasswordReauthService`。

## 内部结构

- `services/auth.service.ts` — facade,委托子服务,自身不含业务逻辑。
- `services/identity/credential.service.ts` — 注册/登录(经 Better Auth API)。
- `services/identity/password-reauth.service.ts` — 敏感操作前密码重验(非 token)。
- `services/identity/rate-limit.service.ts` — 登录失败限流(基于 Redis)。
- `services/identity/verification-code.service.ts` — 邮箱验证码生成与校验。
- `services/token.service.ts` — JWT access/refresh 生成与 session CRUD。
- `services/account.service.ts` — auth 账号生命周期(改邮箱/密码等)。
- `services/oauth/facade.service.ts` — OAuth 流程编排(state→authorize→callback)。
- `services/oauth/oauth.service.ts` — OAuth profile → 用户链接/创建。
- `services/oauth/state.service.ts` — OAuth state 生成与 CSRF 校验。
- `services/notification.service.ts` — 安全通知(登录提醒、密码变更)。
- `adapters/better-auth.adapter.ts` — 封装 Better Auth + Prisma 映射。
- `providers/` — 6 个 OAuth 提供商;Apple/Google 为受信提供商(自动关联账号)。
- `repositories/` — session/account 仓储(port + Prisma 实现)。
- `guards/jwt-auth.guard.ts`、`strategies/jwt-access.strategy.ts`、`decorators/`。

## 测试承接

`controllers/*.spec.ts`、`services/**.spec.ts`、`providers/*.spec.ts`、
`repositories/*.spec.ts`、`guards/jwt-auth.guard.spec.ts`、
`strategies/jwt-access.strategy.spec.ts`、`decorators/*.spec.ts`
