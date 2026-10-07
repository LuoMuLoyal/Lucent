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

权限在 `constants/permissions.ts` 固定；`GET /api/v1/admin/me` 返回身份资料、角色和服务器派生的权限集合。

## API Surface

- `GET /api/v1/admin/metrics/overview`：`metrics:read`，只返回聚合账户和产品事件计数。
- `GET /api/v1/admin/users`、`GET /api/v1/admin/users/:id`：`users:read`，只返回账户摘要，不包含健康资料；列表 `limit` 最大为 100。
- `GET /api/v1/admin/audit-logs`：`audit:read`，只返回操作者与资源摘要，不返回 metadata、IP 或 user-agent；列表 `limit` 最大为 100。
- `GET/PUT /api/v1/admin/content/legal-documents`：读写权限分别为 `content:read` / `content:write`；写路径调用 legal-documents owner service、失效公开缓存并记录 actor 与变更摘要。
- `GET/POST/PUT/DELETE /api/v1/admin/content/safety-tips`：读写权限分别为 `content:read` / `content:write`；写路径调用 medicines owner service、失效缓存并审计 actor 与前后摘要。

## 显式初始化

管理员提升必须先有 active 且已验证邮箱的用户，再显式执行 `pnpm admin:seed <email> <role>`。安装、启动和迁移不会自动授予管理员。

## 内部结构

- `services/console.service.ts`：只读聚合、用户摘要和审计列表编排；由模块 barrel 导出供 API provider 调用。
- 内容变更写服务由 `legal-documents` 和 `medicines` 所有者模块提供，Admin 只负责鉴权和 API 编排。
- `guards/admin.guard.ts`：要求已登录用户具备任一管理员角色。
- `guards/admin-permission.guard.ts`：按 `@RequirePermission()` 执行细粒度权限检查。
- `constants/permissions.ts`：角色到权限的代码矩阵。

## 测试承接

`controllers/admin.controller.spec.ts`、`services/access.service.spec.ts`、`services/console.service.spec.ts`、`dto/admin-identity.dto.spec.ts`、`dto/admin-users.dto.spec.ts`、`dto/admin-audit-logs.dto.spec.ts`、`guards/admin.guard.spec.ts`、`guards/admin-permission.guard.spec.ts` 与 `constants/permissions.spec.ts`。内容写入审计由 `legal-documents/services/admin.service.spec.ts` 与 `medicines/services/admin.service.spec.ts` 覆盖；HTTP auth/audit 集成断言位于 `test/e2e/product-events/product-events.e2e-spec.ts`。
