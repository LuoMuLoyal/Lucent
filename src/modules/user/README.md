---
status: active
owner: backend
---

# user

## 模块意图

User 表的纯内部服务模块:为 auth 与 account 提供用户读写(创建、查询、
更新),刻意不设 controller——面向用户的端点分别位于 auth 与 account。

## 边界

- 管:User 记录的持久层操作(含 P2002 冲突 → RESOURCE_CONFLICT 映射;
  `create` 缺省建空 `UserProfile`)。
- 不管:注册/登录流程与凭据(auth);账号自助端点(account);健康档案
  (user-health-context)与偏好设置(user-settings)。

## 依赖方向

- imports:无业务模块依赖(审计经全局 `AuditLogService`)。
- 被引用:barrel 导出 `UserService` 与 `UserAdminService`;消费方 `auth`(凭据流程、
  密码管理、账号生命周期、OAuth facade、邮箱验证)、`account`、`admin`(管理面
  停用/软删)。直接注入,未 port 化。
- 账号自助软删仍走 auth:`AuthAccountRepository.softDeleteUser` 在 auth 的
  repositories 里写 `deletedAt` + `status: deleted`;管理面的停用/软删经
  `UserAdminService` 落同一语义。本模块的读(如 `findById`/`findByEmail`)经
  `prisma.nonDeleted` 自动排除已删用户。

## 内部结构

- `services/user.service.ts` — `UserService`:用户查询(`findById`/
  `findByEmail`,均过滤软删)、创建、更新(`update` 走 Result,
  `updateByEmail` 返回 `Promise<User | null>`)。
- `services/admin.service.ts` — `UserAdminService`:管理面生命周期写
  (`setStatus` active/suspended、`softDelete`),写后记 actor/target 与前后态审计。

## 测试承接

- `services/user.service.spec.ts`
- `services/admin.service.spec.ts`
