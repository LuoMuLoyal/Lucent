---
status: active
owner: backend
---

# user

## 模块意图

User 表的 owner 模块(ADR-0009):为 auth 与 account 提供用户读写(创建、查询、
更新),**刻意不设 controller**——面向用户的端点分别位于 auth 与 account。

## 边界

- 管:User 记录的持久层操作(含 P2002 冲突 → RESOURCE_CONFLICT 映射;
  `create` 缺省建空 `UserProfile`)。
- 不管:注册/登录流程与凭据(auth);账号自助端点(account);健康档案
  (user-health-context)与偏好设置(user-settings)。

## 分层形态（ADR-0024 判定）

本模块**只有 `application/` + `infrastructure/` 两层，这是判定结论不是迁移未完成**：

- **无 `adapters/`**：没有 controller，也没有队列/事件/ACL。端点住在 auth 与
  account，本模块是它们背后的内部服务。为不存在的交付面造 `adapters/` 没有意义。
- **无 `domain/`**：`User` 没有独立于表结构的不变量。唯一的规则是
  「P2002 → `RESOURCE_CONFLICT`」与「`create` 缺省建空 profile」，两者都是
  持久层语义，不是业务规则。按 ADR-0024「不为 CRUD 硬造富领域模型」不建聚合。
- 若将来出现真实领域规则（例如账号状态机独立于 `User.status` 列），再补
  `domain/`；**不要因为「四层看起来更整齐」而建空壳**。

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

- `application/ports/users.ts` — `UserRepositoryPort` 端口、`USER_REPOSITORY`
  注入 token(接口在运行时擦除，故需 token)与 `UserStatusSnapshot`;
  同文件含 `PrismaUsers` 实现(见下)。
- `application/use_cases/user.ts` — `UserService`:用户查询(`findById`/
  `findByEmail`,均过滤软删)、创建、更新(`update` 走 Result,
  `updateByEmail` 返回 `Promise<User | null>`)。
- `application/use_cases/admin.ts` — `UserAdminService`:管理面生命周期写
  (`setStatus` active/suspended、`softDelete`),写后记 actor/target 与前后态审计。
- `infrastructure/persistence/users.ts` — `PrismaUsers`:`UserRepositoryPort` 的
  Prisma 实现。模块用 `{ provide: USER_REPOSITORY, useExisting: PrismaUsers }`
  绑定;`PrismaModule` 是 `@Global()`，故无 `imports`。

## 测试承接

- `application/use_cases/user.spec.ts`
- `application/use_cases/admin.spec.ts`
- `infrastructure/persistence/users.spec.ts`
