# 极光推送服务端集成实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `PushDeliveryService` 通过极光 REST API 按用户 alias 真实下发推送；未配置凭据时保持静默降级，并移除不再需要的服务端设备注册 API/数据表。

**Architecture:** Luminous 在登录后把 Lucent 用户 UUID 设置为 JPush alias，退出时删除 alias；Lucent 只负责按 alias 推送，不再查询或维护设备表。`JpushConfig` 由根 `ConfigModule` 注册，`JpushPushProvider` 封装 REST v3 `/v3/push`，`PushDeliveryService` 负责调用提供方并吞掉推送故障，避免影响提醒和建议业务。

**Tech Stack:** NestJS 11, TypeScript 6, Zod 4, Node.js 24 原生 `fetch`, Vitest, Prisma 7, PostgreSQL, `@nestjs/config`。

---

## 审核结论与执行约束

- 原计划漏掉了 `AppModule` 的 `jpushConfig` 注册；若不补上，`ConfigService.getOrThrow(ConfigKey.Jpush)` 会在启动时失败。
- 原计划把 `.gradle`、客户端 SDK 签名和手动 Xcode 操作混入服务端计划；客户端部分已移到 Luminous 计划，并按实际 Kotlin DSL/Xcode 工程重写。
- 原计划把代码、数据库迁移、OpenAPI 产物和文档放进同一提交；本计划拆成配置、提供方、业务接线、数据库/API 合同、文档五个边界，每个代码提交同时带迁移日志以满足 pre-commit 文档检查。
- `UserDevice` 表删除是不可逆的数据定义变更。执行删除前必须只读核查 development/test 数据库行数；即使为空，也要在实际运行迁移前向用户确认。未确认时只执行到删除前的安全步骤并暂停。
- 不把 AppKey、Master Secret 或数据库凭据写入仓库；示例文件只放空值/非机密默认地址。
- 当前日期为 2026-08-06，所有迁移日志追加到 `docs/02-logs/migration-log/2026-08-06.md`，不能覆盖已有内容。

## 验收标准

- `JpushConfig` 已注册并验证成对凭据；四个 `JPUSH_*` 环境变量有示例和文档。
- 提供方覆盖空配置、空 alias、Basic Auth、Android/iOS payload、1000 alias 分批和非 2xx 错误。
- `PushDeliveryService` 按 alias 调用提供方，未配置/提供方失败均不向上抛错。
- `user-devices` 路由、模块、i18n、E2E、Prisma `UserDevice` 模型和相关 helper 引用全部移除；`UserDevicePlatform` 仅在 OpenAPI/`UserSession` 仍需要时保留。
- OpenAPI 不再包含 `/api/v1/user/user-devices`；Luminous 计划负责随后重新生成客户端。
- `pnpm test`、`pnpm typecheck`、`pnpm lint:check`、`pnpm build`、`pnpm docs:check` 在环境允许时通过；真实极光下发保留为真机/服务凭据验证项。

---

### Task 0: 固化审核后的计划

**Files:**

- Modify: `plans/2026-08-03-jpush-integration.md`

- [ ] **Step 1: 检查两个仓库状态并确认只保留用户已有改动**

Run:

```powershell
git -C Lucent status --short --branch
git -C Luminous status --short --branch
```

Expected: Lucent 的原计划文件可见；Luminous 的既有 `l10n.yaml` 修改不被覆盖或暂存。

- [ ] **Step 2: Commit**

```powershell
git add plans/2026-08-03-jpush-integration.md
git commit -m "docs(push): 审核并完善极光服务端实施计划"
```

---

### Task 1: JPush 环境变量、配置注册与验证

**Files:**

- Modify: `src/config/env/env-keys.enum.ts`
- Modify: `src/config/env/config-keys.enum.ts`
- Create: `src/config/services/jpush.config.ts`
- Create: `src/config/services/jpush.config.spec.ts`
- Modify: `src/config/env/environment.validation.ts`
- Modify: `src/config/env/environment.validation.spec.ts`
- Modify: `src/app.module.ts`
- Modify: `.env.development.example`
- Modify: `.env.test.example`
- Modify: `.env.production.example`
- Modify: `docs/01-reference/environment.md`
- Modify: `docs/01-reference/environment-variables.md`
- Modify: `docs/02-logs/migration-log/2026-08-06.md`

- [ ] **Step 1: 先写配置测试**

测试必须覆盖：`ConfigKey.Jpush` 注册键；未配置时四字段默认值；环境变量读取和 `JPUSH_APNS_PRODUCTION=true` 转换；只配置 AppKey 或只配置 Master Secret 时 `validateEnvironment()` 抛出包含缺失键的错误；两者都为空时不抛错。

- [ ] **Step 2: 运行配置测试确认当前实现失败**

```powershell
pnpm test src/config/services/jpush.config.spec.ts src/config/env/environment.validation.spec.ts
```

Expected: 新配置测试因 `JpushConfig`/枚举/校验尚不存在而失败。

- [ ] **Step 3: 增加枚举、配置工厂和校验**

新增 `JPUSH_APP_KEY`、`JPUSH_MASTER_SECRET`、`JPUSH_APNS_PRODUCTION`、`JPUSH_API_BASE_URL`；新增 `ConfigKey.Jpush = 'jpush'`。配置工厂使用 `registerAs(ConfigKey.Jpush, ...)`，读取值时对 AppKey、Master Secret、API URL 做 `trim()`，默认 API URL 为 `https://api.jpush.cn`，APNs 生产开关仅在值为 `true` 时为真。环境 schema 使用现有 `optionalString`、`z.enum(['true','false']).optional()`、`optionalUri`；在 `assertTencentCosEnvironment` 后调用成对凭据校验。

- [ ] **Step 4: 把配置工厂加载到根 ConfigModule**

在 `src/app.module.ts` 导入 `jpushConfig`，并把它加入 `ConfigModule.forRoot({ load: [...] })`。这一步不能只在 `NotificationsModule` 中声明 `forFeature`，因为通知模块的 provider factory 使用根配置命名空间。

- [ ] **Step 5: 更新三个环境示例和参考文档**

每个示例文件追加以下无凭据配置，不填真实值：

```text
# JPush（极光推送）— AppKey 与 Master Secret 同时为空时静默禁用
JPUSH_APP_KEY=
JPUSH_MASTER_SECRET=
JPUSH_APNS_PRODUCTION=false
JPUSH_API_BASE_URL=https://api.jpush.cn
```

在环境变量参考中说明：AppKey/Master Secret 必须成对出现；未配置时不发送；Master Secret 只通过运行环境 secret 注入；`JPUSH_APNS_PRODUCTION` 必须与 iOS provisioning/APNs 环境匹配。

- [ ] **Step 6: 运行定向验证**

```powershell
pnpm test src/config/services/jpush.config.spec.ts src/config/env/environment.validation.spec.ts
pnpm docs:check
```

Expected: 配置测试通过，文档检查输出已识别迁移日志/环境文档。

- [ ] **Step 7: Commit**

```powershell
git add src/config/env/env-keys.enum.ts src/config/env/config-keys.enum.ts src/config/services/jpush.config.ts src/config/services/jpush.config.spec.ts src/config/env/environment.validation.ts src/config/env/environment.validation.spec.ts src/app.module.ts .env.development.example .env.test.example .env.production.example docs/01-reference/environment.md docs/01-reference/environment-variables.md docs/02-logs/migration-log/2026-08-06.md
git commit -m "feat(config): 新增极光推送环境变量与配置"
```

---

### Task 2: PushProvider 端口与 JPush REST 提供方

**Files:**

- Create: `src/modules/notifications/services/push-provider.port.ts`
- Create: `src/modules/notifications/services/jpush.provider.ts`
- Create: `src/modules/notifications/services/jpush.provider.spec.ts`
- Modify: `docs/02-logs/migration-log/2026-08-06.md`

- [ ] **Step 1: 先写 `jpush.provider.spec.ts`**

测试覆盖以下六个行为：凭据缺失时 `isConfigured=false` 且不调用 `fetch`；alias 为空时不调用 `fetch`；请求 URL 为 `${apiBaseUrl}/v3/push`、方法为 POST、Content-Type 为 JSON、Authorization 为 `Basic base64(appKey:masterSecret)`；payload 含 `platform=['android','ios']`、`audience.alias`、Android/iOS 标题正文和 extras、`apns_production`、86400 秒 TTL；2500 个 alias 产生 1000/1000/500 三次请求；非 2xx 响应抛出含状态码的错误。

- [ ] **Step 2: 运行单测确认失败**

```powershell
pnpm test src/modules/notifications/services/jpush.provider.spec.ts
```

Expected: 因提供方文件不存在而失败。

- [ ] **Step 3: 实现端口和提供方**

`PushMessage` 保持 `{ title: string; body: string; data?: Record<string, unknown> }`；`PushProvider` 暴露 `isConfigured` 和 `send(aliases, message)`。`JpushPushProvider` 使用 `JPUSH_MAX_ALIASES_PER_REQUEST = 1000`，逐批串行 POST；响应非 2xx 时读取并截断响应正文后抛错；不打印 AppKey、Master Secret 或完整请求正文。

- [ ] **Step 4: 运行单测和文档检查**

```powershell
pnpm test src/modules/notifications/services/jpush.provider.spec.ts
pnpm docs:check
```

- [ ] **Step 5: Commit**

```powershell
git add src/modules/notifications/services/push-provider.port.ts src/modules/notifications/services/jpush.provider.ts src/modules/notifications/services/jpush.provider.spec.ts docs/02-logs/migration-log/2026-08-06.md
git commit -m "feat(notifications): 新增 JPush alias 推送提供方"
```

---

### Task 3: PushDeliveryService 业务接线

**Files:**

- Modify: `src/modules/notifications/services/push-delivery.service.ts`
- Modify: `src/modules/notifications/services/push-delivery.service.spec.ts`
- Modify: `src/modules/notifications/notifications.module.ts`
- Modify: `docs/01-reference/contracts/reminder-contract.md`
- Modify: `docs/01-reference/architecture.md`
- Modify: `docs/01-reference/code-quality.md`
- Modify: `docs/02-logs/migration-log/2026-08-06.md`

- [ ] **Step 1: 重写 PushDeliveryService 单测**

移除 Prisma mock，使用 fake `JpushPushProvider` 覆盖：未配置时不发送；已配置时以 `[userId]` alias 传递完整 payload；provider reject 时 `sendToUser()` resolve 为 `undefined`。

- [ ] **Step 2: 重写服务并接入模块 factory**

`PushDeliveryService` 构造函数注入 `JpushPushProvider`，保持现有 `sendToUser(userId, payload)` 调用签名；未配置只写 debug 日志；提供方错误只写 warn 日志。`NotificationsModule` 通过 `ConfigService.getOrThrow<JpushConfig>(ConfigKey.Jpush)` 创建 `JpushPushProvider`，保留 `PrismaModule` 给 `NotificationsService` 使用。更新通知契约/架构文档，删除“查询 UserDevice/no-op stub”的现状描述，改为 alias + best-effort JPush。

- [ ] **Step 3: 运行定向验证**

```powershell
pnpm test src/modules/notifications/services/push-delivery.service.spec.ts src/modules/medicine-reminders/services/scheduler.service.spec.ts src/modules/today-suggestion/services/notification/escalation.service.spec.ts
pnpm typecheck
pnpm docs:check
```

- [ ] **Step 4: Commit**

```powershell
git add src/modules/notifications/services/push-delivery.service.ts src/modules/notifications/services/push-delivery.service.spec.ts src/modules/notifications/notifications.module.ts docs/01-reference/contracts/reminder-contract.md docs/01-reference/architecture.md docs/01-reference/code-quality.md docs/02-logs/migration-log/2026-08-06.md
git commit -m "feat(notifications): 通过 JPush alias 投递推送"
```

---

### Task 4: 删除旧设备注册模块与数据库表（有破坏性迁移，需先确认）

**Files:**

- Delete: `src/modules/user-devices/`
- Delete: `src/i18n/zh-CN/user-devices.json`
- Delete: `src/i18n/en/user-devices.json`
- Delete: `test/e2e/user-devices/`
- Modify: `src/app.module.ts`
- Modify: `prisma/schema.prisma`
- Modify: `test/helpers/unit-helpers.ts`
- Modify: `test/helpers/e2e-helpers.ts`
- Modify: `docs/01-reference/architecture.md`
- Modify: `docs/01-reference/contracts/reminder-contract.md`
- Modify: `docs/02-logs/migration-log/2026-08-06.md`

- [ ] **Step 1: 做只读核查，不修改数据库**

确认 `user_devices` 在 development/test 数据库中的行数，并核对代码/测试之外没有运行时引用：

```powershell
rg -n "UserDevice|userDevice|user-devices|user_devices" src prisma test docs/01-reference generated
pnpm prisma migrate status
```

若数据库可连接，使用现有数据库只读客户端执行：

```sql
SELECT COUNT(*) FROM "user_devices";
```

Expected: 得到 development/test 行数；若任一数据库有行、无法确认连接目标，或发现未知引用，停止并报告，不执行删除。

- [ ] **Step 2: 向用户确认可以删除 `user_devices` 表**

这是本计划的强制人工门槛。确认前不得运行 `prisma migrate dev --name remove-user-devices`，不得执行任何 `DROP TABLE`。

- [ ] **Step 3: 删除代码/模型引用**

移除 `UserDevicesModule` 的根 imports 和 `/user` RouterModule child；删除模块、i18n、E2E；删除 `User.devices` 和 `model UserDevice`，保留 `UserDevicePlatform` 直到生成 OpenAPI 验证确认它仍被 `UserSession`/DTO 使用；删除两个 test helper 对 `userDevice` 的 mock/cleanup。

- [ ] **Step 4: 生成并检查 Prisma 迁移**

```powershell
pnpm prisma migrate dev --name remove-user-devices
pnpm prisma generate
```

Expected: 只生成删除 `user_devices` 表及其关系的迁移；检查迁移 SQL 和 `git diff`，确认没有意外删除其他表/索引。

- [ ] **Step 5: 运行服务端定向验证**

```powershell
pnpm test
pnpm typecheck
pnpm lint:check
pnpm docs:check
```

用 `rg` 验证无残留引用；不再调用已删除路径的单测。

- [ ] **Step 6: Commit**

```powershell
git add -A src/modules/user-devices src/app.module.ts src/i18n prisma/schema.prisma prisma/migrations test/helpers docs/01-reference/architecture.md docs/01-reference/contracts/reminder-contract.md docs/02-logs/migration-log/2026-08-06.md
git commit -m "refactor(notifications): 移除旧设备注册模块与数据表"
```

---

### Task 5: 导出 OpenAPI 合同

**Files:**

- Modify: `docs/openapi.json`
- Modify: `docs/02-logs/migration-log/2026-08-06.md`

- [ ] **Step 1: 重新生成 OpenAPI**

```powershell
pnpm export:openapi
```

- [ ] **Step 2: 检查合同删除范围**

```powershell
rg -n "user-devices|UserDevicesController|RegisterDeviceDto|DeviceResponseDto" docs/openapi.json
rg -n "UserDevicePlatform" docs/openapi.json
```

Expected: 第一条无输出；第二条只有在 `UserSession`/其他仍存 DTO 使用时才有输出。

- [ ] **Step 3: Commit**

```powershell
git add docs/openapi.json docs/02-logs/migration-log/2026-08-06.md
git commit -m "chore(contract): 重导出移除设备注册接口的 OpenAPI"
```

---

### Task 6: 服务端全量验证与计划收尾

- [ ] **Step 1: 运行全量检查**

```powershell
pnpm test
pnpm typecheck
pnpm lint:check
pnpm format:check
pnpm build
pnpm docs:check
pnpm docs:verify
```

- [ ] **Step 2: 检查提交内容和敏感信息**

```powershell
git diff origin/dev...HEAD --stat
git diff origin/dev...HEAD -- .env* src/config/services/jpush.config.ts
git status --short
```

Expected: 不包含真实凭据；Luminous 原有 `l10n.yaml` 修改不出现在 Lucent；所有提交边界清晰。

- [ ] **Step 3: 将计划标记为已停止驱动并删除**

在迁移日志追加“本计划实施完毕，计划文件已删（实施完毕文件已删）”，然后删除本计划文件；不要在计划文件中留下完成标记。

- [ ] **Step 4: Commit**

```powershell
git add plans/2026-08-03-jpush-integration.md docs/02-logs/migration-log/2026-08-06.md
git commit -m "chore(plans): 完成极光服务端计划并清理计划文件"
```

---

## 跨仓库交接给 Luminous

Lucent 的 Task 5 完成后，Luminous 执行其计划中的 OpenAPI 客户端重新生成；不得手改生成客户端。服务端真实推送验证需要双方都提供对应的 JPush AppKey、Master Secret、Android 包名/iOS Bundle ID 和 APNs 环境，这些只通过本地/部署环境注入。
