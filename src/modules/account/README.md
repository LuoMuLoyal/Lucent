---
status: active
owner: backend
---

# account

## 模块意图

当前登录用户的账号自助管理:查看/更新个人资料、身份解绑、改邮箱、改密码与
账号注销。它是 auth(凭据与会话)之上的用户入口——auth 负责"证明你是你",
account 负责"证明之后如何管理账号"。

## 边界

- 管:`/account` 下的账号自助操作(资料、身份绑定、邮箱/密码、注销)与
  敏感操作的审计写入。
- 不管:注册/登录/会话/OAuth 流程(auth 模块);User 表底层 CRUD(user 模块);
  用户健康档案与偏好(user-health-context / user-settings)。

## 依赖方向

- imports:`AuthModule`、`UserModule`(DI);barrel 引用 `../auth`
  (`AuthService`、`AuthIdentityService`、`PasswordReauthService`、密码/邮箱/
  OAuth DTO 与 schema、`@CurrentUser`、`UserPayload`)、`../user` 与
  `../audit-log`(控制器直接写审计)。
- 被引用:无(仅由 app.module 注册,无其他模块依赖本模块)。

## 内部结构

- `account.controller.ts` — `/account` 全部端点;除 `GET`/`PATCH` 与身份解绑外,
  改密码、设密码、改邮箱、注销、OAuth 身份链接都**直接调 `AuthService`**
  并把审计交给 `AuditLogService.logFireAndForget`。只读聚合(`AccountDto`)由
  `AccountService` 提供。
- `services/account.service.ts` — `AccountService`:账号档案读取/更新
  (`users` + `accounts` 联查)、身份解绑。编排 `UserService`、
  `AuthIdentityService`、`PasswordReauthService`;不含凭据运维逻辑。
  身份解绑在事务内复检「是否已设密码 + 剩余身份数」,堵住与并发改密的 TOCTOU
  窗口;解绑最后一个登录方式返回 403。

## 不变量与陷阱

- `hasPassword` 来自 `AuthIdentityService.hasPassword`(是否存在
  `providerId = 'credential'` 的 account 行),不是 `user.password`——不存在
  `user.password` 字段。判断「能否安全解绑/注销」一律经它,不要自己查表。
- 身份解绑必须先密码重验(`PasswordReauthService`)。
- 账号自我注销后,本模块所有端点对该用户返回 401/403:auth 的 access token
  策略拒绝非 `active` 用户。

## 测试承接

- `account.controller.spec.ts`
- `services/account.service.spec.ts`
