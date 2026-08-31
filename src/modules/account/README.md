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
  (AuthService、密码/邮箱 DTO、`@CurrentUser`、`UserPayload`)、`../user`
  与 `../audit-log`(控制器直接写审计)。
- 被引用:无(仅由 app.module 注册,无其他模块依赖本模块)。

## 内部结构

- `services/account.service.ts` — `AccountService`:账号档案读取/更新、身份
  解绑、改邮箱/改密码/注销,编排 AuthService 与 UserService。

## 测试承接

- `account.controller.spec.ts`
- `services/account.service.spec.ts`
