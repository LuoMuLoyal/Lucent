---
status: active
owner: backend
---

# Lucent 微服务 Monorepo 改造计划

> 2026-10-18 起草。
> 目标：把 Lucent 从**单包 NestJS 单体**改造为 **pnpm workspace + Turborepo monorepo
> （`apps/*` + `libs/*` 各为独立包）上的粗粒度微服务**，
> 服务间 **gRPC 同步 + 消息队列异步（事务性 outbox）**；前端（`admin/`、Luminous）**不收编**。
> 裁决：**一次性切换（big-bang）**——不设试点、不保留单体与微服务并行的中间可部署态；
> 改造在长命分支完成后**一次切生产**，未完成则系统不可用。因此第 5 节的**完成定义（DoD）**
> 与第 7 节的**回滚预案**是本文档的硬约束，任何一项不满足都不许切。
>
> 本计划取代 2026-08-14 与 2026-09-30 两次已废置的「SaaS modules + monorepo」方向（那两次只到
> `apps/api + apps/admin` 的形态，未落地即删，历史见迁移日志 2026-09-30 与 2026-10-07）。
> 路径与结论以当日代码为准；表结构以 `prisma/models/*.prisma` 为准。
>
> 依据：本文的两张盘点（跨模块耦合、构建面断裂点）由代码静态扫描产出，摘要见附录 A。

---

## 0. 决策摘要

| 议题        | 裁决                             | 说明                                                                                                                        |
| ----------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 切换方式    | **一次性 big-bang**              | 长命分支 + 特性冻结，生产在完成前不切；不做绞杀者渐进上线                                                                   |
| 拆分粒度    | **粗粒度 5 个域服务 + 1 个边缘** | 见 §2.1；不做 26 个模块级细拆                                                                                               |
| 同步通信    | **gRPC**                         | `@nestjs/microservices` Transport.GRPC，契约在 `libs/contracts/proto`                                                       |
| 异步/一致性 | **消息队列 + 事务性 outbox**     | 见 §2.4；替代现有跨模块 `EventEmitter2`                                                                                     |
| 仓库形态    | **pnpm workspace + Turborepo**   | `apps/*` + `libs/*` 各为独立包，Turbo 编排构建/缓存；**放弃 Nest CLI monorepo 单包模式**与 `#generated` 全局别名（见 §2.2） |
| 前端        | **不收编**                       | `admin/` 保持独立 pnpm 工程链进镜像；Luminous 不进本仓                                                                      |
| 对外契约    | **保持不变**                     | 公开 API/OpenAPI 仍由 gateway 唯一产出，Luminous 与 admin **零改动**                                                        |
| 数据库      | 切换期**共享 `public` schema**   | schema-per-service 作为切换后的**后续波次**（见 §2.4、§11）                                                                 |

**红线**：公开 HTTP 契约（路径、operationId、响应形状、Problem Details、SSE）**不得变化**——
它是 Luminous 与 admin 唯一依赖面，任何变化都会把「一次性切换」放大成客户端同步改造。

---

## 1. 现状基线

- **单包 NestJS 单体**：入口 `src/main.ts` → `AppModule`（`src/app.module.ts` 用 `RouterModule`
  注册 `user` 前缀）；`sourceRoot: "src"`（`nest-cli.json`），构建产物扁平 `dist/main.js`。
- **26 个业务模块** `src/modules/*` + `src/common`（跨切面：api/queue/llm/metrics/...）+ 根级
  `config/`、`prisma/`、`i18n/`、`mail/`、`llm-runtime/`、`admin-console/`。
- **跨模块耦合已收敛为三种缝**（附录 A 全量）：
  1. **reader port**（`DailyRecordReaderPort` / `MedicineDoseLogReaderPort` /
     `MedicineReminderReaderPort` / `IUserSettingsPort` / `IUserHealthContextReader` /
     `IReportSummaryReader` / `INotificationSender`）；
  2. **领域事件**（`src/common/events/domain-events.ts` 7 个事件，跨模块 `emitAsync`/`@OnEvent`）；
  3. **读模型直读**（`today-analysis`/`today-suggestion`/`reports` 按 ADR-0009 豁免，直接 Prisma）。
- **基础设施**：Prisma 7 + PostgreSQL（单库 `lucent`）、Redis + BullMQ（10 个队列，见附录 A）、
  OTel/Winston/Prometheus、`nestjs-i18n`、zod 4 校验与序列化。
- **构建/工具链**：SWC builder、`#generated/*` import map（**219 处** import 站点，四处定义需一致：
  `package.json#imports`、`tsconfig.json#paths`、`.swcrc#paths`、两个 vitest alias）、
  vitest 四套配置、dependency-cruiser/eslint.arch/oxlint/knip、`scripts/` 独立 tsconfig（`rootDir: ".."`，
  跨到 `../prisma/`）、`scripts/contract/export-openapi.ts` 动态 import `dist/app.module.js`。
- **部署**：单 slot 单进程（ADR-0004），三机 compose（主板 / 图库 / 监控）；`Dockerfile` 单镜像
  `COPY dist/` + `/app/admin/dist`；`entrypoint.sh` 跑 `prisma migrate deploy` 后 `node dist/main.js`。
- **历史包袱**：`prisma.Path/` 空目录、无引用（迁移时顺手删）。

---

## 2. 目标架构

### 2.1 服务拓扑（粗粒度）

| 服务             | 职责                                                                                                            | 归入的现有模块                                                                                                         | 拥有的表（按 `prisma/models/`）                                                                                                                        | 暴露                           |
| ---------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| **gateway**      | HTTP 边缘/BFF：路由、鉴权、限流、i18n、Problem Details、序列化、SSE、`/metrics`、`/admin` 静态、`/admin/queues` | 各模块的 **controller / dto / guards / filters / pipes**；`admin-console`                                              | 无（不直连业务库）                                                                                                                                     | REST `/api/v1`（**现状不变**） |
| **identity**     | 身份、账户、用户、设置、RBAC、审计                                                                              | auth、account、user、user-settings、admin、audit-log                                                                   | `user.prisma`、`account.prisma`、`admin.prisma`                                                                                                        | gRPC                           |
| **health**       | 健康上下文、记录、事件、剂量、提醒、导出、保留                                                                  | user-health-context、daily-records、health-events、medicine-dose-logs、medicine-reminders、data-export、data-retention | `user-health-context.prisma`、`daily-records.prisma`、`health-events.prisma`、`medicine-user.prisma`（用户侧）、`platform.prisma`（DataExportRequest） | gRPC + MQ                      |
| **knowledge**    | 药品与知识库、AI 助手、LLM 运行时、文件、法务、环境                                                             | medicines、assistant、llm-runtime、files、environment、legal-documents、app-info                                       | `medicine-knowledge.prisma`、`medicine-user.prisma`（SafetyTip/RiskCheck）、`assistant.prisma`、`platform.prisma`（LegalDocument）                     | gRPC（含 server-streaming）    |
| **insights**     | 读模型：今日分析 / 建议、报告、遥测                                                                             | today-analysis、today-suggestion、reports、product-events                                                              | `suggestions.prisma`、`platform.prisma`（UserClinicSummaryShare、UserProductEvent）                                                                    | gRPC + MQ                      |
| **notification** | 通知、偏好、邮件、投递                                                                                          | notifications、notification-preferences、mail                                                                          | `platform.prisma`（UserNotification、UserNotificationPreference）、`medicine-user.prisma`（UserReminderDelivery）                                      | gRPC + MQ                      |

**共享/横切**（`libs/`，见 §2.2）：`common`、`config`、`contracts`（proto + 生成类型 + zod DTO）、
`events`（事件契约 + outbox helper）、`authz`（RBAC 权限矩阵）、`i18n`、`observability`、`prisma`、`audit`。

> **待裁决**：`admin` 是否独立成服务（当前归 identity，但其通用数据层要跨服务扇出，见 §4.5、§11）。
> `testing-support` 归 gateway（仅测试运行挂载）。

### 2.2 仓库布局（pnpm workspace + Turborepo）

```
pnpm-workspace.yaml    # packages: ["apps/*", "libs/*"]
turbo.json             # 任务图与缓存（build/typecheck/lint/test/...）
package.json           # 根：共享 devDeps + turbo，不放业务代码
apps/
  gateway/     package.json  nest-cli.json  src/main.ts  tsconfig.json
  identity/    health/  knowledge/  insights/  notification/
libs/
  common/ config/ contracts/ events/ authz/ i18n/ observability/ prisma/ audit/
    each: package.json (name "@lucent/<x>", exports "./dist/index.js" + d.ts)
prisma/               # 共享 DB 阶段：schema 与 migrations 仍在根
scripts/  docs/  test/  admin/  deploy/  monitoring/   # 位置不变
```

**形态**：根 `package.json` 只放共享 devDeps 与 `turbo`；`apps/*`、`libs/*` 各是独立包。
应用通过 `workspace:*` 依赖 `@lucent/*`；**服务之间不互相依赖**（只依赖 `libs/*` 与 proto 契约）。

**为什么用 pnpm workspace + Turbo，而不是 Nest CLI monorepo 单包**：

- **贴合微服务**：每个服务是独立包，可独立依赖版本、独立构建、（将来）独立发布；Turbo 任务图 +
  本地/远程缓存让「只重建被改动的服务与其依赖」成为默认行为。
- **正面解决 R-pre 的两处 Docker 陷阱**：弃用 `COPY /app/node_modules` 与 `pnpm prune --prod`
  （2026-09-30 探针已证伪），改 **`turbo prune --scope=@lucent/<svc> --docker`** 生成最小化安装上下文
  （裁剪后的 `pnpm-lock.yaml` + 各包 `package.json`），镜像内 `pnpm install --frozen-lockfile` +
  `turbo run build`，生产依赖用 `pnpm deploy --prod`（自包含目录）。**新路径尚未实测，P0 必须真实镜像验证**。
- **放弃 Nest CLI monorepo 模式**：`nest-cli.json` 不再用 `"monorepo": true`；每个 app 是标准 Nest 包
  （各自 `nest-cli.json`，`sourceRoot: "src"`，`nest build` 产出各自 `dist/main.js`）。Nest CLI monorepo
  与 pnpm workspace 是两套编排哲学，混用会打架。

**代价：`#generated/*` 必须改为工作区包（本计划最高风险项）**。Node 的 package `imports` 目标**必须在包内**，
无法跨包指向根 `generated/`（2026-10-07 迁移日志中 `scripts/` 补 `#generated` 映射失败于
`ERR_INVALID_PACKAGE_TARGET` 即此规则）。因此：

- 生成 client 收进 **`libs/prisma`**：根 `prisma/schema.prisma` 的 generator `output` 重定向到
  `libs/prisma/src/generated`，该包 `exports` 出 client 与全部 enum/类型；
- 全仓 **219 处** `#generated/prisma/client.js`（及 enum/类型引用）**codemod 为 `@lucent/prisma`**；
- 删除四处 `#generated` 定义（`package.json#imports`、`tsconfig`/`.swcrc` 的 `paths`、两份 vitest alias）。

**构建编排**：`libs/*` 用 `tsc`（`composite: true` + project references）产出 `dist` 与 `.d.ts`；
apps 用 `nest build`（SWC）。`turbo.json` 定义 `build`（`dependsOn: ["^build"]`，缓存 `dist/**`）、
`typecheck`、`lint`、`test`、`test:e2e`、`export:openapi`、`docs:verify`（根级，`cache: false`）；按需用
`--filter=@lucent/<pkg>` 或 `--filter='...[origin/main]'` 做增量。远程缓存（自托管）列为待裁决。

### 2.3 进程间通信

- **同步（gRPC）**：`@nestjs/microservices` + `Transport.GRPC`，proto 为服务 API 的**事实源**，
  位于 `libs/contracts/proto/*.proto`，生成 TS 类型（`libs/contracts/src/generated`）。
  gateway 用 `ClientsModule`/`ClientGrpc` 持有各服务的类型化客户端。**server-streaming** 承载
  assistant 对话 SSE 与文件下载流。
- **同步调用判据**：请求/响应式读取、需要调用方等待完成的命令。**长耗时/可重试工作一律异步**
  （如今日建议重算、报告 PDF、餐食分析）。
- **异步（消息队列 + outbox）**：见 §2.4。替代现有跨模块 `EventEmitter2`；**模块内**监听器可保留
  `EventEmitter2`，**跨服务**监听器迁移为 MQ 消费者（现有事件矩阵 1:1 映射，见附录 A）。
- **BullMQ 保留**，但**按服务收口**为服务内后台任务（health：餐食分析、提醒派发；
  insights：AI 摘要、PDF；knowledge：药品识别；notification：邮件）。**不做跨服务 job 耦合**。

### 2.4 数据与一致性

- **数据库拓扑**：切换期**保留单实例单库 `lucent` 的 `public` schema**，由代码约定各服务只读写
  自己的表；跨服务数据**只能**经 gRPC（强一致读）或事件（派生）。**schema-per-service 是切换后的
  后续波次**（附录 TODO），理由：数百条关系的外键 + 单一 `prisma` 迁移史，在切换窗口内拆 schema
  只会把风险叠在风险上，且对首日用户零收益。
- **事务性 outbox**：每个服务一张 `<service>.outbox`；状态变更与事件写入**同一 Prisma 事务**，
  由服务内 `OutboxRelay`（轮询或 `LISTEN/NOTIFY`）发布到 broker。**禁止双写**。
- **broker 选型（待裁决，推荐 NATS JetStream）**：轻量、原生 stream + 消费组、便于 compose；
  备选 Kafka（重）或 BullMQ-over-Redis（最省运维，但 pub/sub 扇出语义弱）。
- **投递语义**：at-least-once + 消费端**幂等**（按 `event_id` 去重表）。现有「收事件→失效缓存/
  入队重算」的订阅语义天然幂等，直接迁移。
- **跨服务写**：当前同进程事务内完成的跨模块写（如 health-events ownership 在 daily-records/
  dose-logs 内消费、audit 在事务内落库）需改为二选一：**同步 gRPC 命令**（需调用方等待完成）
  或**编排式 saga + 补偿**。逐例登记在 P4（本节完成时补一张「跨服务写清单 + 补偿动作」表）。
- **Prisma**：共享 DB 阶段 `prisma/schema.prisma`（含 migrations）仍在根、单迁移史；生成 client 输出
  重定向到 `libs/prisma/src/generated` 并由 **`@lucent/prisma`** 暴露。schema 拆分波次再按服务建
  `libs/prisma-<svc>` 独立 client。

### 2.5 对外契约

- **公开 OpenAPI 只由 gateway 产出**：`pnpm export:openapi` 仍启动 gateway 应用，输出仍写
  `docs/reference/generated/openapi.json`；Luminous 客户端与 admin 均**不重生成**（零外部变更）。
- **内部契约** = proto（服务 API）+ `libs/contracts` 的共享事件/zod 类型；gateway 持有的 zod DTO
  仍是 HTTP 校验与 OpenAPI 的输入，**不下沉到服务**。
- 由此 gateway 会变「厚」（持有全部 controller/dto/guard），这是 BFF 的预期代价，换取对外契约原样。

### 2.6 横切关注点

- **config**：`libs/config`（env schema + AppConfig），各进程校验自己需要的子集；仍 env-only（ADR-0018）。
  新增 `SERVICE_NAME`、各服务端口、gRPC/NATS 地址。
- **auth**：JWT 在 gateway 验证；向服务传**已验身份元数据**（`x-lucent-actor`：HMAC/PASETO 签名，
  含 `userId`/`roles`/`scopes`/`traceparent`，短 TTL）。RBAC 权限矩阵下沉 `libs/authz`，
  gateway 无往返即可执行 `@RequirePermission`；敏感操作再查 identity 会话（吊销生效）。
  **待裁决**：签名元数据 vs mTLS。
- **i18n**：`libs/i18n`；gateway 解析 locale，服务返回**错误码**，gateway 渲染 (保持 ADR-0012)。
- **observability**：`libs/observability`；W3C trace context 经 gRPC metadata 与 MQ header 透传；
  增加 `service.name`；每服务内部端口暴露 `/metrics`/`/health`，gateway 保留公开 `/metrics`；
  监控栈按服务加仪表盘与告警规则。
- **audit**：由 `@Global` 进程内服务改为**跨服务能力**——切换期用 `libs/audit` 直写审计表（共享 DB 前提），
  后续波次改事件 sink（`audit.recorded` 由 identity 消费落库）。需同步落库的场景走 identity gRPC。

### 2.7 部署形态

- `compose.yaml`（主板）新增 `gateway/identity/health/knowledge/insights/notification` + `nats`；
  仅 gateway 发布 `3000`，其余服务**不发布宿主端口**；每服务独立 healthcheck。
- **每服务独立镜像**：`turbo prune --scope=@lucent/<svc> --docker` 生成该服务的最小安装上下文，
  镜像只含该服务产物与其 workspace 依赖（`pnpm deploy --prod` 自包含）。比「单镜像多入口」更贴合
  独立伸缩/回滚；代价是 6 份镜像与 6 条构建流水线（Turbo 缓存摊薄）。**待裁决**：若想省镜像可退回
  单镜像多入口（用一个镜像装全部 `apps`，`SERVICE` 环境变量选入口）。
- `entrypoint.sh` 的 `prisma migrate deploy` 只由**一个** 迁移者执行（gateway 或 identity），
  其余服务等待其健康。ADR-0004/ADR-0023 需修订。
- `admin/` 仍按目录独立构建并链进镜像，位置不变。

---

## 3. 边界映射的关键取舍

- **`admin` 通用数据层**：`resource-registry.ts` + `data.service.ts` 结构性触及 ~51 张表，
  在微服务下**不能直连他服务库**。方案：每服务暴露 `AdminResource` gRPC（实现同一注册表契约：
  分页/`q`/过滤/脱敏白名单/软删），identity 侧聚合；写仍走 owner 服务。**这是本计划最具分量的工作项之一**。
- **`product-events`**：被 health-events、reports、today-suggestion、admin 消费。归 insights（遥测/分析），
  记录路径改为 fire-and-forget 事件，读取走 gRPC/聚合。
- **`medicine-user.prisma` 跨界**：用户侧（health）、SafetyTip/RiskCheck（knowledge）、
  ReminderDelivery（notification）同处一个 Prisma 文件——共享 DB 阶段按代码约定分区，
  schema 拆分波次再物理分离。
- **read-model（today-analysis/today-suggestion/reports）**：ADR-0009 豁免直读他模块表；微服务下
  直读改为 **reader-port gRPC**（附录 A 端口表即改造输入）+ 事件增量重算。
- **`reports ↔ assistant` 双向环**、**`reports ↔ data-export` 双向**：拆分时须按调用方向切开
  （读/写分离），否则 gRPC 会成环。

附录 A 的**消费侧端口表**与**领域事件矩阵**是各服务 gRPC 方法与 MQ 订阅的**规划输入**。

---

## 4. 关键跨服务流走查（改造验收面）

1. **登录/刷新**：gateway → identity gRPC（签发）；后续请求 gateway 本地验签，敏感操作查会话。
2. **记录变更 → 建议重算**：health 提交事务写 + outbox 发 `DAILY_RECORD_CHANGED` 等 →
   insights 消费者幂等触发重算；reports 缓存失效同理。**不再有进程内 `emitAsync`**。
3. **提醒投递**：health 调度（BullMQ）→ gRPC `notification.send` → notification 三渠道投递 →
   投递结果事件回 health 落 `UserReminderDelivery`。至少一次 + 幂等（ADR-0011/0013 语义保留）。
4. **assistant 工具读**：knowledge 经 gRPC 读 identity 设置、health 健康上下文；SSE 由 gateway 透传
   server-streaming。
5. **admin 通用数据层**：gateway/admin UI → identity 聚合 → 各服务 `AdminResource` gRPC 扇出。
6. **审计**：各服务写路径落审计（切换期 `libs/audit` 直写；后续波次事件 sink）。

---

## 5. 分阶段执行与完成定义

**全部在长命分支 `refactor/microservices` 完成；生产在中途不切（big-bang）。**

### P0 — 定稿、ADR 与工具链 spike（先决条件）

- 交付：ADR-0024 服务拓扑与边界、ADR-0025 IPC 选型（gRPC + broker）、ADR-0026 事件/outbox 与
  一致性、ADR-0027 数据所有权与共享 DB 取舍；proto 骨架；服务边界文档（并入本计划或模块 README）。
- **工具链 spike（两条，先于 P1）**：
  1. 真实镜像验证 `turbo prune --scope=@lucent/<svc> --docker` + `pnpm install --frozen-lockfile` +
     `pnpm deploy --prod` 的 prod-only 运行时（构建期不报错**且**运行期可解析，2026-09-30 的两处
     失败模式不再出现）；
  2. `#generated → @lucent/prisma` codemod 原型，在隔离目录对 219 处跑通并 `pnpm typecheck` 全绿。
- 门禁：`pnpm docs:verify`、`pnpm docs:links`；spike 结论回写本计划。

### P1 — Workspace 脚手架（**行为不变**的重构）

- 建 `pnpm-workspace.yaml` + `turbo.json` + `apps/gateway` + `libs/*`；把
  `common/config/prisma/i18n/observability` 下沉 `libs/`（包名 `@lucent/*`）；**所有业务模块暂留
  gateway**（单进程跑通）。
- 执行 `#generated → @lucent/prisma` codemod；每包 tsconfig（libs `composite`）、各 app `nest build`
  产出各自 `dist`、Docker 改 `turbo prune` + `pnpm deploy`、CI 改 `turbo run`。
- 门禁：`turbo run check` 全绿、`export:openapi` 产物**零 diff**、`/admin` 与 `/admin/queues` 正常、
  e2e/contract/security 全绿。

### P2 — 服务骨架与通信地基

- 每个服务建 app + proto + gRPC server；gateway 仍用**进程内适配器**调用（feature flag 切换）；
  接 NATS + outbox + 幂等消费者。
- 门禁：单测/e2e 在「进程内」与「gRPC」两种模式均绿。

### P3 — 逐个抽取服务（identity → health → knowledge → insights → notification）

- 每个服务：迁移 provider、gateway 切换为 gRPC client、删除进程内适配器、迁移其监听器到 MQ。
- 门禁（每服务）：该服务 e2e + contract 绿；dependency-cruiser 无跨服务深 import；OpenAPI 零 diff。

### P4 — 数据与一致性硬化

- outbox relay、幂等表、跨服务写清单 + saga 补偿、admin 数据层 gRPC 扇出、audit 策略落地。

### P5 — 装配与全量门禁（staging 全栈）

- compose 起全部服务；跑 contract / security / perf / e2e 全量；做**浸泡**与故障演练
  （单服务重启、 broker 抖动、幂等重放）。

### P6 — 切换与退役

- 维护窗口部署新栈 → gateway 接管 `3000` → 冒烟；观察窗口后才删除单体入口与旧适配器。

**完成定义（DoD，缺一不可）**

1. 6 个服务在 compose 全栈起齐且健康；gateway 对外契约零 diff（path/operationId/响应形状）。
2. `turbo run check`、`test:e2e:ci`、`test:contract`、`test:security` 全绿；OpenAPI 产物幂等。
3. 所有跨服务依赖只经 gRPC/MQ（depcruise 规则为零违例）。
4. 停掉任一下游服务，gateway 以 Problem Details 报明确错误、不 500 崩溃；恢复后自愈。
5. outbox 无积压、消费者幂等重放通过；`UserReminderDelivery`、`today-analysis` 重算、审计链路
   端到端验证通过。
6. 回滚预案在 staging 演练成功（见 §7）。
7. Luminous 客户端与 `admin/` 构建产物**无改动**即通过冒烟。

---

## 6. 构建与工具链改造清单（按断裂风险排序）

1. **`#generated/*` → `@lucent/prisma`（219 处，最高风险）**：Node 的 `imports` 目标必须在包内
   （跨包会 `ERR_INVALID_PACKAGE_TARGET`，见 2026-10-07 日志），故生成 client 收进 `libs/prisma`，
   全仓 codemod，并删除四处 `#generated` 定义（`package.json#imports`、`tsconfig`/`.swcrc` 的 `paths`、
   两份 vitest alias）。
2. **Docker 产线**：弃用 `COPY /app/node_modules` 与 `pnpm prune --prod`（R-pre 已证伪），改
   `turbo prune --scope=@lucent/<svc> --docker` → `pnpm install --frozen-lockfile` → `turbo run build` →
   `pnpm deploy --prod` 落地自包含 prod 目录。**必须真实镜像验证**（构建期不报错、运行期可解析）。
3. **入口链**：`entrypoint.sh` 的 `node dist/main.js` → 各服务包自己的 `dist/main.js`；
   `scripts/contract/export-openapi.ts` 动态 import 的 `dist/app.module.js` / `dist/setup-app.js` /
   `dist/common/api/*.js` 改指 gateway 包产物。
4. **`prisma.config.ts` 反向 import 应用源码**：`import './src/config/env/env-file-paths'` →
   `@lucent/config`（注意 pnpm 下 `prisma.config.ts` 的 workspace 解析）；`fix-generated-prisma-internal.ts`
   的生成路径同步到 `libs/prisma/src/generated`。
5. **工具链 glob**：`eslint.config.ts`、`eslint.arch.config.ts`、`.oxlintrc.json`、`knip.config.ts`、
   `.dependency-cruiser.cjs`、`scripts/arch/check-ast-conventions.ts` 全部 `src/**` → `apps/**`+`libs/**`；
   dependency-cruiser 改写成**服务边界**规则（禁跨服务依赖，只准 `libs/*` 与 proto client；`libs` 不得
   反向 import `apps`）。类型感知 lint 需覆盖多包（root `tsconfig.eslint.json` 汇总 references）。
6. **vitest**：改成 **`vitest.workspace.ts`**（列出 `apps/*`、`libs/*` 各项目）；`root: 'src'` 与
   `reportsDirectory` 语义按包重设；e2e 仍指 `test/**`。
7. **`scripts/tsconfig.json`**：`rootDir: ".."`、`include` 跨到 `../prisma/fix-generated-prisma-internal.ts`
   ——随 prisma 生成路径调整；`scripts/admin/seed-admin.ts` 的 `../../generated/prisma/client.js` → `@lucent/prisma`。
8. **CI**：改为 **`turbo run <task>`**（`ci.yml`），用 `--filter='...[origin/main]'` 增量 + Turbo 缓存；
   SWC 缓存键 `hashFiles('src/**/*.ts')` 失效；`docker.yml`/`release.yml` 改多包 harness
   （per-service `turbo prune`）。
9. **`src/i18n/i18n.module.ts`**：`typesOutputPath` 写 `src/generated/i18n.generated.ts`，且
   `isRunningFromSource()` 以「祖先目录名 == `src`」判定——迁到 `libs/i18n` 后两者都需修正。
10. **docs 工具**：`scripts/docs/links.ts` 的 `PATH_TOKEN_RE` 前缀表
    （`docs|src|plans|scripts|test|monitoring|deploy|.github`）与 `scripts/docs/verify.ts` 的
    `resolve(repoRoot,'src','modules')` 模块 README 覆盖检查；**全仓 `src/...` 路径记号重写**。
11. **`prisma.Path/`**：空目录无引用，迁移时删除。

---

## 7. 回滚与运维窗口

- **回滚锚点**：保留旧单进程镜像 tag 与旧 `.env`。
- **数据库向后兼容是回滚前提**：长命分支期间**只允许加列/加表**；**不允许**在切换窗口做删列、
  拆 schema、改外键。破坏性变更一律**推迟到切换后**——这正是 ADR-0004 里蓝绿退役的教训
  （同库、schema 变更对新旧代码同时可见，回滚路径即断）。
- **窗口**：远超 ADR-0004 的 15–45s，按**小时级维护窗口**准备，并预告 SSE 客户端终止事件。
- **回滚动作**：停新服务 → 起旧镜像（同一 DB，schema 仅被向后兼容地扩展）→ 冒烟。
- **故障演练**：P5 必须在 staging 演练「切一半回滚」。

---

## 8. 测试与验收

- **多进程 e2e**：现有 `test/e2e` 改为对 compose 全栈发起（gateway 入口不变，客户端视角无感）；
  contract/security/perf 套件保留。
- **进程内↔gRPC 双模**：P2–P3 期间同一业务用例在两种模式各跑一遍，作为抽取正确性的证据。
- **边界测试（arch）**：depcruise 新增规则——服务间只准 `libs/*` 与对方 proto client；`libs` 不得
  反向 import `apps`。
- **outbox/MQ**：幂等重放、乱序、broker 抖动、消费者重启的集成用例。
- **admin 数据层**：`AdminResource` gRPC 契约的脱敏与软删断言（沿用现 e2e 约定，含 limit 上限）。

---

## 9. 交付物（每阶段）

1. **ADR**（新增，只增不改）：0024 拓扑、0025 IPC、0026 事件/outbox、0027 数据所有权；
   修订 ADR-0004/0023 的部署形态。
2. **proto** + `libs/contracts` 生成物；`libs/{common,config,events,authz,i18n,observability,prisma,audit}`；
   `pnpm-workspace.yaml` + `turbo.json` 任务图。
3. **模块 README**：迁移后模块读路径变更需同步；`docs/README.md` 模块索引与 `src/...` 路径记号全量重写。
4. **`docs/reference/generated/openapi.json`**：`pnpm export:openapi` 重导出，**须零 diff**。
5. **迁移日志**：每阶段追加 `docs/logs/migration-log/YYYY-MM-DD.md`（append-only）。
6. **compose** 全栈定义 + 监控按服务仪表盘/告警；`docs/howto/deploy.md` 与 `deployment.md` 更新。

> 不新开「当前状态」叙述文档；状态下沉模块 README，事实进迁移日志，决策进 ADR。

---

## 10. 风险登记

| 风险                                                     | 等级   | 缓解                                                       |
| -------------------------------------------------------- | ------ | ---------------------------------------------------------- |
| big-bang 无中间可部署态，分支长期漂移                    | **高** | 定期 rebase/合并、切换前特性冻结、DoD 硬门禁               |
| 分布式新失效模式（部分失败、消息丢失/重复）              | 高     | outbox + 幂等 + gRPC 超时/重试/熔断策略、故障演练          |
| 跨服务数据一致性（User/审计/product-events）             | 高     | 明确强一致走 gRPC、派生走事件；跨服务写 saga 清单化        |
| admin 通用数据层跨服务扇出                               | 高     | 先定 `AdminResource` gRPC 契约，再实现；脱敏在每服务侧强制 |
| 工具链路径断裂（§6 清单）                                | 中     | P1 一次性改齐并用 `turbo run check` 兜底                   |
| workspace Docker 产线（turbo prune + pnpm deploy）未实测 | **高** | P0 真实镜像 spike，未通过不得进入 P1                       |
| `#generated → @lucent/prisma` codemod（219 处）遗漏/漏改 | **高** | 脚本一次性改齐 + `pnpm typecheck` + 全量测试兜底           |
| 多包构建配置（composite/references/Turbo 任务图）出错    | 中     | P0 spike 定稿模板；每包最小可验证                          |
| SSE/流式经 gateway↔knowledge                             | 中     | server-streaming + 背压/取消传播测试                       |
| 共享 DB 非真隔离                                         | 中     | 代码约定 + depcruise 强制；schema 拆分列为后续波次         |
| 团队/运维学习曲线（gRPC/ broker）                        | 中     | P0 出 ADR 与 runbook；staging 演练                         |

---

## 11. 待裁决点

1. **broker**：NATS JetStream（推荐）vs Kafka vs BullMQ-over-Redis。
2. **DB 拓扑**：切换期共享 `public` schema + 后续 schema-per-service（推荐）vs 切换即拆。
3. **镜像形态**：每服务独立镜像（推荐，`turbo prune --scope`）vs 单镜像多入口。
4. **proto 代码生成**：`ts-proto`（推荐，类型好）vs 运行时 `@grpc/proto-loader`。
5. **admin 归属**：留在 identity 并 gRPC 扇出（推荐）vs 独立服务。
6. **身份透传**：签名 metadata（推荐，简单）vs mTLS。
7. **审计**：`libs/audit` 直写（切换期）vs 事件 sink（后续波次）的切换时点。
8. **`testing-support` 归属**：gateway（推荐，仅测试挂载）vs 独立。
9. **Turbo 远程缓存**：自托管 remote cache vs 仅本地缓存（CI 命中率与运维成本权衡）。
10. **`libs/*` 构建**：`tsc` project references（推荐）vs `swc`/`tsup` 各自打包。

---

## 附录 A — 耦合与工具链盘点摘要

### A.1 跨服务 reader/writer 端口（拆分输入）

| 端口                         | 提供方 → 消费方（拆分后）                                                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `DailyRecordReaderPort`      | health → insights                                                                                                            |
| `MedicineDoseLogReaderPort`  | health → insights                                                                                                            |
| `MedicineReminderReaderPort` | health → insights                                                                                                            |
| `IUserSettingsPort`          | identity → insights、knowledge(assistant)                                                                                    |
| `IUserHealthContextReader`   | health → knowledge(assistant)                                                                                                |
| `INotificationSender`        | notification ← identity(auth)、health(reminders/data-export)、insights(today-suggestion/analysis)、notification(preferences) |
| `IReportSummaryReader`       | insights → notification(preferences)                                                                                         |

### A.2 领域事件矩阵（`src/common/events/domain-events.ts`）

| 事件                                       | 发布方              | 订阅方                                     | 拆分后流向                    |
| ------------------------------------------ | ------------------- | ------------------------------------------ | ----------------------------- |
| `DAILY_RECORD_CHANGED`                     | daily-records       | today-analysis、reports、today-suggestion  | health → insights             |
| `DOSE_LOG_CHANGED`                         | medicine-dose-logs  | 同上                                       | health → insights             |
| `REMINDER_CHANGED`                         | medicine-reminders  | medicines(risk)、reports、today-suggestion | health → knowledge、insights  |
| `HEALTH_CONTEXT_CHANGED`                   | user-health-context | medicines(risk)、reports、today-suggestion | health → knowledge、insights  |
| `SETTINGS_CHANGED`                         | user-settings       | reports、today-suggestion                  | identity → insights           |
| `HEALTH_EVENT_CHANGED`                     | health-events       | today-analysis、reports、today-suggestion  | health → insights             |
| `TODAY_SUGGESTION_MATERIALIZATION_CHANGED` | today-suggestion    | today-analysis                             | insights → insights（服务内） |

### A.3 BullMQ 队列（按服务收口）

`lucent-cron`、`lucent-reminder-dispatch` → health；`lucent-mail` → notification；
`lucent-meal-analysis` → health；`data-export` → health；`medicine-recognition` → knowledge；
`today-analysis`、`suggestion-*`、`report-summary`、`clinic-summary-pdf` → insights。

### A.4 现有模块间 import 依赖（71 条边的聚集）

密集/双向簇：`reports ↔ data-export`、`reports ↔ assistant`、`auth ↔ user`（单向 6）；
纯枢纽：`admin`（audit-log/auth 各 7）；读模型消费者：`today-analysis`/`today-suggestion`
（依赖 daily-records + medicine-dose-logs + settings + notifications）。`audit-log`（`@Global`）、
`notifications`（`INotificationSender`）、`product-events`、`user-settings`/`user-health-context`
是**共享缝**而非拆分点。完整 71 条边与文件级位置见本次盘点产物（未入库）。

### A.5 构建面断裂点

11 项，按风险排序见 §6。最高风险：`#generated` → `@lucent/prisma` codemod（219 处）与
workspace 下的 Docker 产线（`turbo prune` + `pnpm deploy`），两者都在 P0 spike 先验证。
