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
- `ADMIN`：指标、用户、审计、内容读写和运维读取；不含 `admin:manage`；全队列读写。
- `EDITOR`：仅内容读取与写入；无队列权限点。
- `VIEWER`：指标、用户、审计、内容与运维只读；全队列只读。

权限在 `constants/permissions.ts` 固定；`GET /api/v1/admin/me` 返回身份资料、角色和服务器派生的权限集合。

每个注册队列各派生一个读点与写点（`queue:<name>:read` / `queue:<name>:write`），队列清单与点位由 `common/queue/queue-names.ts` 的 `QUEUE_NAMES` 单一来源生成——新增队列自动获得两个权限点，无需改本模块。

## API Surface

- `GET /api/v1/admin/metrics/overview`：`metrics:read`，只返回聚合账户和产品事件计数。
- `GET /api/v1/admin/users`、`GET /api/v1/admin/users/:id`：`users:read`，只返回账户摘要，不包含健康资料；列表 `limit` 最大为 100。
- `GET /api/v1/admin/audit-logs`：`audit:read`，只返回操作者与资源摘要，不返回 metadata、IP 或 user-agent；列表 `limit` 最大为 100。
- `GET/PUT /api/v1/admin/content/legal-documents`：读写权限分别为 `content:read` / `content:write`；写路径调用 legal-documents owner service、失效公开缓存并记录 actor 与变更摘要。
- `GET/POST/PUT/DELETE /api/v1/admin/content/safety-tips`：读写权限分别为 `content:read` / `content:write`；写路径调用 medicines owner service、失效缓存并审计 actor 与前后摘要。

## 队列面板（/admin/queues）

bull-board 面板，直接挂在 Fastify 上（不经 Nest 控制器），与 `/api` 前缀和版本化无关，**不新开端口**。队列清单来自 `BullmqQueueFactory.getQueues()` 的进程内注册表；`REDIS_URL` 未配置时为空列表。

- **鉴权**：所有 `/admin/queues/*` 请求沿用 Lucent 访问 JWT（HS512 + issuer/audience）并校验 `AdminUser` 角色；未登录 401、已登录非管理员或无队列读点 403。面板自带 UI 无法附加 `Authorization`，因此运维以 `?access_token=<jwt>` 打开一次即换取面板路径限定的 `HttpOnly` + `SameSite=Lax` 短时 cookie。
- **按队列收权**：只读范围交给 `BullMQAdapter.setVisibilityGuard`（每队列读点过滤列表、详情、worker 与调度器）；写操作在 bull-board 的 `before` 钩子校验——队列级变更要该队列写点，全局暂停/恢复要全队列写点。能力全开，不设 `readOnlyMode`。
- **审计口径**：非 `GET` 的 `/admin/queues/api/*` 请求经 Fastify `onResponse` 写 `audit_logs`，`action` 形如 `admin.queue.<verb>`（全局暂停/恢复为 `admin.queue.pauseAll` / `resumeAll`），`resource_type` 为 `queue`，`resource_id` 为目标队列，metadata 记 method/path/status。拒绝的写请求同样留痕。

## 显式初始化

管理员提升必须先有 active 且已验证邮箱的用户，再显式执行 `pnpm admin:seed <email> <role>`。安装、启动和迁移不会自动授予管理员。

## 内部结构

- `services/console.service.ts`：只读聚合、用户摘要和审计列表编排；由模块 barrel 导出供 API provider 调用。
- 内容变更写服务由 `legal-documents` 和 `medicines` 所有者模块提供，Admin 只负责鉴权和 API 编排。
- `guards/admin.guard.ts`：要求已登录用户具备任一管理员角色。
- `guards/admin-permission.guard.ts`：按 `@RequirePermission()` 执行细粒度权限检查。
- `constants/permissions.ts`：角色到权限的代码矩阵。
- `services/queue-panel.service.ts`：`OnApplicationBootstrap` 里装配 bull-board、按队列设置可见性守卫、注册鉴权与审计钩子。
- `services/queue-panel-auth.service.ts`：面板 JWT 校验 + 角色解析为按队列权限点。
- `constants/queue-panel.constants.ts` / `services/queue-panel.utils.ts`：面板路径、cookie 名与请求/审计路径解析（纯函数）。

## 测试承接

`controllers/admin.controller.spec.ts`、`services/access.service.spec.ts`、`services/console.service.spec.ts`、`dto/admin-identity.dto.spec.ts`、`dto/admin-users.dto.spec.ts`、`dto/admin-audit-logs.dto.spec.ts`、`guards/admin.guard.spec.ts`、`guards/admin-permission.guard.spec.ts` 与 `constants/permissions.spec.ts`。内容写入审计由 `legal-documents/services/admin.service.spec.ts` 与 `medicines/services/admin.service.spec.ts` 覆盖；HTTP auth/audit 集成断言位于 `test/e2e/product-events/product-events.e2e-spec.ts`。

队列面板由 `services/queue-panel-auth.service.spec.ts`（JWT → 角色 → 权限点）与 `services/queue-panel.utils.spec.ts`（cookie/路径解析）覆盖；`services/queue-panel.service.spec.ts` 用真实 Fastify 实例断言路由、握手、写授权与审计落点；端到端 401/403/200 与「变更落 `audit_logs` 并可从 `GET /api/v1/admin/audit-logs` 查到」由 `test/e2e/admin/queue-panel.e2e-spec.ts` 承接。
