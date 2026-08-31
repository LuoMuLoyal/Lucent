---
status: active
owner: backend
---

# user

## 模块意图

User 表的纯内部服务模块:为 auth 与 account 提供用户 CRUD(创建、查询、
更新、软删),刻意不设 controller——面向用户的端点分别位于 auth 与 account。

## 边界

- 管:User 记录的持久层操作(含 P2002 冲突 → RESOURCE_CONFLICT 映射)。
- 不管:注册/登录流程与凭据(auth);账号自助端点(account);健康档案
  (user-health-context)与偏好设置(user-settings)。

## 依赖方向

- imports:无业务模块依赖。
- 被引用:barrel 导出 `UserService`;消费方 `auth`、`account`(auth 直接
  注入,系 account 管理协作场景,未 port 化)。

## 内部结构

- `services/user.service.ts` — `UserService`:用户创建/查询/更新/软删。

## 测试承接

- `services/user.service.spec.ts`
