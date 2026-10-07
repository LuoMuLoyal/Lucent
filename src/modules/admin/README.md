---
status: active
owner: backend
---

# admin

## 模块意图

管理端共享身份、角色权限判定与管理员 API。管理员是已认证的 `User` 加一条 `AdminUser` 记录；认证沿用 Lucent JWT，不建第二套密码或 session。

## 边界

- 管：封闭角色与权限矩阵、管理员身份解析、管理 API。
- 不管：用户登录与凭证、通用数据库 CRUD、前端权限作为安全边界。
- `AdminUser` 只记录用户外键和角色；权限集合固定在 `constants/permissions.ts`。

## 角色能力

- `SUPER_ADMIN`：全部权限，含 `admin:manage`。
- `ADMIN`：指标、用户、审计、内容读写和运维读取；不含 `admin:manage`。
- `EDITOR`：仅内容读取与写入。
- `VIEWER`：指标、用户、审计、内容与运维只读。

权限在 `constants/permissions.ts` 固定；当前阶段未新增管理 API 路由。

## 显式初始化

管理员提升必须先有 active 且已验证邮箱的用户，再显式执行 `pnpm admin:seed <email> <role>`。安装、启动和迁移不会自动授予管理员。

## 内部结构

- `services/access.service.ts`：通过 `AdminUser` 查询角色并判定权限。
- `guards/admin.guard.ts`：要求已登录用户具备任一管理员角色。
- `guards/admin-permission.guard.ts`：按 `@RequirePermission()` 执行细粒度权限检查。
- `constants/permissions.ts`：角色到权限的代码矩阵。

## 测试承接

`guards/admin.guard.spec.ts`、`guards/admin-permission.guard.spec.ts`、`constants/permissions.spec.ts`。
