---
status: active
owner: backend
---

# Admin 控制台管理项扩展计划

> 2026-10-18 起草（同日二次修订：补全 Prisma 全表覆盖 + 角色分级权限）。
> 目标：把 Prisma 全部表接进管理面板，按角色分级：
> **SUPER_ADMIN 读写全开**；**ADMIN 读全 + 部分写**；**VIEWER 只读**。
> 运行时配置（env / 开关 / 参数）由 rnacos 负责（见 `2026-08-02-rnacos-runtime-config-tuning.md`），
> **不在本计划内**，本计划不新增配置存储，**不新开 ADR**。
> 路径与结论以当日代码为准；表结构见 `prisma/models/*.prisma`。

## 0. 原则与约束

**原则**

1. 全部 51 张表接入：读对所有管理员角色开放；写按角色分级（见第 3 节）。
2. SUPER_ADMIN 读写全开（含原始表 CRUD）；ADMIN 读全 + 内容/用户/ops 部分写；VIEWER 只读。
3. 运行时配置归 rnacos，本计划不落地配置读写与存储。
4. 密钥/凭证字段（password、token、hash）**永不出现在响应里**，也**不允许写入**——这是安全红线，不是权限开关。

**既有约束**

| 约束                              | 来源                   | 对本计划的影响                                                                                             |
| --------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| 跨模块写走 owner 服务             | ADR-0009               | 有 owner 服务的写（内容/用户状态/会话/分享）走 owner；通用原始表 CRUD 作为管理面受控例外，改动记入迁移日志 |
| 跨模块读允许，软删走 `nonDeleted` | ADR-0009               | 只读/通用层用 `PrismaService`，软删表必须过滤 `deletedAt`                                                  |
| 错误用 RFC 9457 Problem Details   | ADR-0012               | 新端点复用 `ProblemDetailsDto`、`@SerializeOptions`                                                        |
| 运行时配置归口                    | ADR-0018 + rnacos 计划 | admin 面不新增配置表/API                                                                                   |
| OpenAPI 是契约                    | `Lucent/AGENTS.md`     | 契约变更跑 `pnpm export:openapi`，再重生成 Luminous client                                                 |
| 模块 README 与迁移日志            | `Lucent/AGENTS.md`     | 每阶段同步模块 README、追加 `docs/logs/migration-log/YYYY-MM-DD.md`                                        |

控制面三件套（勿混淆）：

- 后端 API：`src/modules/admin/`，挂在 `/api/v1/admin/*`（Nest 控制器）。
- 管理 SPA：`admin/`（独立 pnpm 工程），由 `src/admin-console/` 挂在 `/admin`。
- 队列面板：bull-board，直挂 Fastify `/admin/queues`（不经 Nest，`queue-panel.service.ts`）。

---

## 1. Prisma 表 → 管理面 映射矩阵

51 张表全列。**读**：全部管理员角色可读。**写**三档：
`通用`=经通用原始表 CRUD，仅 SUPER_ADMIN；`角色`=仅 SUPER_ADMIN（角色管理）；`管理`=ADMIN + SUPER_ADMIN（有 owner 服务的业务写）。

### 1.1 账户与权限

| 表            | 归口模块            | 写                         | 备注                                                                      |
| ------------- | ------------------- | -------------------------- | ------------------------------------------------------------------------- |
| `AdminUser`   | admin               | 角色（SUPER_ADMIN）        | 现仅 CLI seed 授予；新增角色管理 API                                      |
| `User`        | user                | 管理（状态/软删，ADMIN+）  | `UserStatus.suspended` 已存在但无写入口                                   |
| `UserProfile` | user-health-context | 通用（SUPER_ADMIN）        |                                                                           |
| `UserSession` | auth                | 管理（撤销，ADMIN+）+ 通用 | `refreshTokenHash` 脱敏                                                   |
| `UserSetting` | user-settings       | 通用                       |                                                                           |
| `AuditLog`    | audit-log           | 通用（建议只读展示）       | 已接 `GET /admin/audit-logs`                                              |
| `Account`     | auth                | 通用（SUPER_ADMIN）        | **禁读写** `password`/`accessToken`/`refreshToken`/`idToken`/`rawProfile` |

### 1.2 用户健康上下文 / 用药 / 记录

| 表                          | 归口模块            | 写   |
| --------------------------- | ------------------- | ---- |
| `UserAllergy`               | user-health-context | 通用 |
| `UserCondition`             | user-health-context | 通用 |
| `UserCurrentMedicine`       | user-health-context | 通用 |
| `UserMedicineReminder`      | medicine-reminders  | 通用 |
| `UserReminderDelivery`      | medicine-reminders  | 通用 |
| `UserMedicineDoseLog`       | medicine-dose-logs  | 通用 |
| `MedicineRiskCheckRecord`   | medicines           | 通用 |
| `UserDailyRecord`           | daily-records       | 通用 |
| `UserDailyRecordAttachment` | daily-records       | 通用 |
| `HealthEvent`               | health-events       | 通用 |
| `HealthEventCheckIn`        | health-events       | 通用 |
| `HealthEventMedicine`       | health-events       | 通用 |

### 1.3 建议 / 分析 / 助手 / 通知 / 导出

| 表                                  | 归口模块                 | 写                         |
| ----------------------------------- | ------------------------ | -------------------------- | ------------------------------------------------------- |
| `UserSuggestion`                    | today-suggestion         | 通用                       |
| `UserSuggestionBaseline`            | today-suggestion         | 通用                       |
| `UserSuggestionBaselineObservation` | today-suggestion         | 通用                       |
| `UserSuggestionMaterialization`     | today-suggestion         | 通用                       |
| `UserTodayAnalysisMaterialization`  | today-analysis           | 通用                       |
| `UserSuggestionFeedback`            | today-suggestion         | 通用                       |
| `AssistantConversation`             | assistant                | 通用                       |
| `AssistantMessage`                  | assistant                | 通用                       |
| `AssistantSummaryHistory`           | assistant                | 通用                       |
| `AssistantMemory`                   | assistant                | 通用                       |
| `AssistantRegeneration`             | assistant                | 通用                       |
| `UserNotificationPreference`        | notification-preferences | 通用                       |
| `UserNotification`                  | notifications            | 通用                       |
| `DataExportRequest`                 | data-export              | 通用                       |
| `UserClinicSummaryShare`            | reports                  | 管理（撤销，ADMIN+）+ 通用 | `tokenHash` 脱敏                                        |
| `UserProductEvent`                  | product-events           | 通用                       | 只读为主；已有 funnel 端点（`ops:read`/`metrics:read`） |

### 1.4 内容 / 知识库

| 表                             | 归口模块        | 写                            | 备注         |
| ------------------------------ | --------------- | ----------------------------- | ------------ |
| `LegalDocument`                | legal-documents | 管理（已接，ADMIN+）          |              |
| `MedicineSafetyTip`            | medicines       | 管理（已接，ADMIN+）          |              |
| `MedicalQaChunk`               | medicines       | 管理（QA 编辑，ADMIN+）+ 通用 |              |
| `DrugSourceImport`             | medicines       | 通用                          | 导入台账     |
| `CnMedicineProduct`            | medicines       | 通用                          | 导入参考数据 |
| `CnMedicineLeaflet`            | medicines       | 通用                          | 导入参考数据 |
| `CnMedicineProductLeafletLink` | medicines       | 通用                          |              |
| `MedicineLeafletChunk`         | medicines       | 通用                          | 派生 RAG 块  |
| `DrugbankDrug`                 | medicines       | 通用                          | 导入参考数据 |
| `DrugbankPassageChunk`         | medicines       | 通用                          | 派生 RAG 块  |
| `DrugbankExternalLink`         | medicines       | 通用                          |              |
| `DrugbankTarget`               | medicines       | 通用                          |              |
| `DrugbankDrugTarget`           | medicines       | 通用                          |              |
| `DrugbankTargetSequence`       | medicines       | 通用                          |              |
| `DrugbankDrugSequence`         | medicines       | 通用                          |              |
| `DrugbankStructure`            | medicines       | 通用                          |              |

> 知识库表由导入流程写，管理面通用 CRUD 仅在 SUPER_ADMIN；重复导入会覆盖手改（提示即可）。

---

## 2. 管理面设计

### 2.1 三种呈现形态

| 形态               | 覆盖                                     | 说明                                                                                             |
| ------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **用户详情聚合页** | 1.1–1.3 中所有 user-owned 表（约 31 张） | `GET /admin/users/:id` 详情，按域分 tab：账户/健康上下文/用药/记录/事件/建议/助手/通知/导出/分享 |
| **全局资源浏览器** | 跨用户或参考类表                         | 通用列表页，分页/搜索/按列过滤                                                                   |
| **可写管理页**     | 内容/角色/状态等                         | 有写操作的页面，按角色显示写控件                                                                 |

### 2.2 通用数据层（读写，地基）

一个资源注册表驱动通用端点，避免为 50 张表手写端点：

- `src/modules/admin/constants/resource-registry.ts`：资源键 → `{ model, softDelete, searchFields, columnAllowlist, omitFields, redact }`。
  - `omitFields`/`redact` 强制脱敏（`Account.password`、`UserSession.refreshTokenHash`、`UserClinicSummaryShare.tokenHash`）；`Account` 的凭证字段同时**禁写**。
  - `softDelete` 为真的表自动走 `prisma.nonDeleted`。
- `GET /api/v1/admin/data/:resource`：`page`/`limit`(≤100)/`q`/过滤（含 `userId`）/排序 → `{ items, total, page, limit }`。
- `GET /api/v1/admin/data/:resource/:id`：单行。
- `POST/PUT/DELETE /api/v1/admin/data/:resource[/:id]`：写，**仅 SUPER_ADMIN**（`data:write`）。
- 资源键不在注册表 → 404；权限不足 → 403。
- 前端：通用资源浏览器 `DataBrowser`（`admin/src/features/data-browser`）读 `admin/src/config/data-resources.ts`
  的资源描述；用户详情页独立为 `admin/src/features/user-detail`（同源描述表 + 聚合端点 tab）。
- 读用 `PrismaService`（ADR-0009 允许跨模块读）；有 owner 服务的写仍走 owner；纯通用写作为管理面受控例外，记入迁移日志。

### 2.3 管理写操作（有 owner 服务，ADMIN + SUPER_ADMIN）

| 操作                        | owner               | 端点                                                                                                                              |
| --------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 用户状态 suspend/reactivate | `user`              | `PATCH /admin/users/:id/status`                                                                                                   |
| 用户软删                    | `user`/`auth`       | `DELETE /admin/users/:id`                                                                                                         |
| 撤销会话（强制下线）        | `auth`              | `DELETE /admin/users/:id/sessions/:sessionId`                                                                                     |
| 撤销 clinic share           | `admin`（受控例外） | `DELETE /admin/users/:id/shares/:shareId`（`reports`→`product-events`→`admin` 成环，admin 直写 `revokedAt` + 审计，不发用户遥测） |
| 法律文档更新                | `legal-documents`   | 已接                                                                                                                              |
| 安全贴士 CRUD               | `medicines`         | 已接                                                                                                                              |
| QA chunk 编辑               | `medicines`         | `PUT /admin/content/qa-chunks/:id`                                                                                                |
| 授予/改/撤管理员角色        | `admin`             | `PUT/DELETE /admin/admins/:userId`（**仅 SUPER_ADMIN**）                                                                          |

### 2.4 脱敏红线（强制，安全非权限）

- 永不返回、永不接受写入：`Account.password`/`accessToken`/`refreshToken`/`idToken`/`rawProfile`、
  `UserSession.refreshTokenHash`、`UserClinicSummaryShare.tokenHash`。
- 注册表 + 序列化 schema 双重保证；新增资源默认拒绝未声明字段。

---

## 3. 权限模型（角色分级）

文件：`src/modules/admin/constants/permissions.ts`（`constants/permissions.spec.ts` 同步）。

权限点：`metrics:read`、`users:read`、`users:write`（用户状态/会话/分享）、`audit:read`、`content:read`、`content:write`、
`ops:read`、`data:read`（通用读）、`data:write`（通用原始表 CRUD）、`admin:manage`（角色管理）。

| 角色          | 权限                                                                                                |
| ------------- | --------------------------------------------------------------------------------------------------- |
| `SUPER_ADMIN` | 全部（含 `data:write`、`admin:manage`）——读写全开                                                   |
| `ADMIN`       | 全部 `*:read` + `users:write` + `content:write` + `ops:read`；**不含** `data:write`、`admin:manage` |
| `EDITOR`      | `content:read` + `content:write`                                                                    |
| `VIEWER`      | 全部 `*:read`（含 `data:read`、`audit:read`、`metrics:read`），无写                                 |

即：VIEWER 只读；ADMIN 读全 + 内容/用户/ops 部分写；SUPER_ADMIN 全开。队列权限点（`queue:<name>:read|write`）不受影响。

---

## 4. 分阶段执行

### Phase 1 — 用户与权限管理

**1a. 用户状态/会话/分享**（ADMIN + SUPER_ADMIN）：`user` 新增 `UserAdminService`（`setStatus`/`softDelete`），`auth` 撤销会话，`reports` 撤销 share。端点见 2.3。守卫：不能操作自己；`SUPER_ADMIN` 需二次确认。审计记 actor/target/前后态。
**1b. 管理员角色管理**（仅 SUPER_ADMIN）：`GET/PUT/DELETE /admin/admins[/:userId]`（`admin:manage`）；不能改自己角色、不能撤销最后一个 `SUPER_ADMIN`。覆盖 TODO「播种脚本不在镜像」。

### Phase 2 — 通用数据层地基 + 用户详情 + 全局资源页

**2a. 资源注册表与通用端点**（见 2.2）：`resource-registry.ts` + `GET/POST/PUT/DELETE /admin/data/:resource`。
**2b. 用户详情聚合页**：`GET /admin/users/:id/related` 返回按域分组的预览；SPA 侧以 tab 呈现。
**2c. 全局资源页**：知识库、遥测、任务、投递、会话、分享等——由 2a 的通用浏览器覆盖，无逐表页面。

### Phase 3 — 内容与 ops 入口

**3a. 内容页扩展**：QA chunk 编辑。
**3b. 漏斗面板**：新增 `GET /admin/metrics/funnel`（`metrics:read`），委托 `ProductFunnelService`（`product-events` barrel 导出）；保留旧 `/user/product-events/funnel`。
**3c. 队列面板入口**：SPA 侧栏「Queues」项，新窗口 `/admin/queues`，按 `queue:*:read` 过滤；依赖状态页只读展示 LightRAG/Semantica 启用态。

### Phase 4 — 前端整合与清理

- 侧栏重组：只保留真实项；模板页（`apps`/`chats`/`tasks`/`help-center`/`clerk`/settings stubs）按 `admin/knip.config.ts` 删除或移出导航。
- 修 `admin/index.html` head 元数据（TODO「控制台 head 仍是上游模板元数据」）。
- 新资源接入四处：`data-provider.ts`、`access-control-provider.ts`、`nav-access.ts`+`sidebar-data.ts`、`main.tsx` resources + route；写控件按角色显隐（`access-control-provider` 按 `can()`）。
- 前端无自动化测试：`admin` 的 vitest browser 与全部 Playwright/chromium 用例已删除
  （决策与理由见迁移日志 2026-10-18）；改动靠 `pnpm lint`/`pnpm build`/`pnpm knip`/`pnpm format:check` 加人工冒烟。

---

## 5. 每阶段交付物（契约与文档）

1. `pnpm export:openapi`（生成物禁手改），再 `Luminous` 重生成 client（`dart run scripts/contract/bootstrap.dart`）。
2. 更新 `src/modules/admin/README.md`；涉 owner 变更同步对应模块 README。
3. 追加 `docs/logs/migration-log/YYYY-MM-DD.md`（append-only；注明通用原始表写是 ADR-0009 的管理面受控例外）。
4. 权限变更同步 `constants/permissions.ts` + `constants/permissions.spec.ts`。

> 不新开 ADR。

## 6. 测试

- 后端：resource-registry 单测（未知资源 404、VIEWER 写 403、脱敏断言、软删过滤）；e2e 遵循既有约定——资源端点补「跨用户/越权 → 404/403」、list 补 `limit` 上限用例（`test/e2e/admin/`）。
- 前端：无自动化测试——`admin` 的 vitest browser 与 Playwright/chromium 用例已删除（2026-10-18）。

## 7. 待裁决点

1. **ADMIN 的"部分写"边界**：本文取 `users:write`+`content:write`+`ops:read`；是否再收/再放。
2. **通用原始表写**：`data:write` 是否仅 SUPER_ADMIN（本文如此），还是给 ADMIN 开部分表。
3. **知识库手改风险**：导入会覆盖，是否仅提示或禁用写。

## 8. 建议实施顺序

Phase 1a → 1b（写能力）→ 2a 通用层地基 → 2b 用户详情 → 2c 全局资源页 → Phase 3 → Phase 4 清理随行。每阶段独立成迁移日志条目。
