# Auth / Security PIN

Last updated: 2026-07-20

- The optional TOTP 2FA system has been replaced with an in-app 6-digit Security PIN.
- `User` carries `securityPinEnabled`, `securityPinHash`, `securityPinChangedAt`, and
  `securityElevationVersion` instead of the old `twoFactor*` columns.
- PIN management endpoints live under `/api/v1/settings/security-pin/*`: enable, verify, change,
  disable.
- A successful verify returns a short-lived signed elevation JWT (`scope: security_elevation`, 15
  minutes) carried in the `x-security-elevation` header.
- Elevation tokens are invalidated when the PIN is enabled, changed, or disabled because
  `securityElevationVersion` is bumped.
- Sensitive routes (`POST /account/password`, `POST /account/email`, `DELETE
/account/identities/:identityId`, `POST /user/data-export-requests`, `GET
/user/data-export-requests/latest`) are protected by `SecurityElevationGuard` and
  `@RequireSecurityElevation()`.
- Credential login no longer returns 2FA challenge fields (`requiresTwoFactor`, `tempToken`).
- `User.email` has a database-level unique constraint (`@unique`); the application-layer duplicate
  check is retained as an early interception.
- Auth Controller has been split into three focused controllers: `local.controller.ts`
  (register, login, verification code, password reset), `oauth.controller.ts` (WeChat, Apple, QQ),
  and `session.controller.ts` (logout, session list, revoke, refresh). A shared `buildAuthResponse`
  helper eliminates duplicated user+tokens serialization.
- `LocalController` and `OAuthController` are marked `@Public()` at class level (no access token
  required). `SessionController.refresh` is marked `@Public()` at method level (refresh uses the
  refreshToken body, so the access token may be expired). The remaining `SessionController` routes
  (`logout`, `sessions`, `revokeSession`) require a valid access token.
- Multiple security parameters are now environment-configurable with Joi validation: verification
  code TTL/cooldown/rate-limit, OAuth state TTL, and mail queue tuning (attempts, backoff,
  concurrency, retention).
- **审计日志**：敏感操作（密码变更/设置、邮箱变更、OAuth 身份绑定/解绑、账户删除）通过
  `AuditLogService.logFireAndForget()` 异步写入 `audit_logs` 表，记录 `userId`、`action`、
  `resourceType`/`resourceId`、`metadata`、`ipAddress`、`userAgent`。审计写入失败不阻塞
  请求（错误吞咽 + warn 日志）。`AuditLogModule` 是 `@Global()` 模块，任何 controller
  可直接注入 `AuditLogService`。
- `AuthNotificationService` 通知类型语义已修正：`notifyOAuthLogin` 使用 `type: 'oauth_login'`，
  `notifyIdentityLinked` 使用 `type: 'identity_linked'`（原均误用 `password_changed`）。
- `SecurityPinService.loadSecurityPinUser()` 已迁移到 `prisma.nonDeleted.user.findFirst` API。
