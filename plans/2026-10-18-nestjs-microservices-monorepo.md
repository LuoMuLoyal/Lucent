---
status: active
owner: backend
---

# Lucent 绞杀者式微服务改造计划

> 2026-10-18 起草；2026-10-19 改为**绞杀者（Strangler Fig）模式**，同日第二轮按
> **标准微服务**收敛；第三轮把部署改为 **Nomad + rnacos**，并将自建 Semantica 收编为
> **`services/ontology`**（TS + Python 的受控多语言仓库，LightRAG 仍外置）。
>
> 目标：在 **Kong 边缘 + RabbitMQ 事件总线** 的支撑下，按 bounded context 逐片把单包 NestJS
> 单体绞杀为 **identity / health / medicine / assistant / insights / notifications / content
> 七个领域/支撑服务 + admin BFF + 一个 Python 推理支撑服务（ontology）**。
> 旧单体在整个迁移期持续在线。服务间
> **gRPC 同步 + RabbitMQ 异步（事务性 outbox）**，一致性为**最终一致性**，不引入 saga。
>
> **2026-10-19 本轮裁决（标准收敛）**：
>
> - **多语言（受控）**：业务服务与 admin BFF 只用 TypeScript；**唯一** Python 单元是
>   `services/ontology`（自建 Semantica FastAPI，本体/OAG 推理），因为它是核心能力且与
>   Lucent 契约共同演进，收进仓库利于契约与客户端同 PR 变更。
>   LightRAG 仍是第三方镜像，继续外置；不引入 Go/Rust 服务。
> - **服务边界**：按 bounded context 划 **identity / health / medicine / assistant / insights /
>   notifications / content 七个领域/支撑服务 + admin BFF**；不按现有依赖面合并
>   （notifications、assistant、content 从旧 knowledge/identity 中拆出）。
> - **部署**：**Nomad 调度 + rnacos 服务发现**（本地仍用 Compose）；状态服务外置；
>   不引入 K8s/Docker Swarm/PM2，也不再单独引入 Consul。
> - **RabbitMQ** 作为跨服务消息总线；**BullMQ 不退役**，降级为服务内任务/定时队列。
> - **数据**：单 Postgres 实例、**每服务独立 database**；独立 role、独立 Prisma client、
>   独立迁移史；**不做 schema 隔离**。
> - **仓库**：根包只做 workspace 编排；legacy 单体移入 `apps/legacy`。
> - **共享层收敛**：只保留 `contracts`、`observability`、`api`、`config`、`testing`、`messaging`、
>   `discovery`（服务发现客户端，技术上必需，避免每服务各写一份 resolver）；
>   不再共享 `common`、`ai`、`authz`、`i18n`、`audit`、`prisma-*`。
> - **每服务弹性契约**：超时、重试、熔断、幂等键、DLQ、背压、优雅停机、readiness。
> - **服务间认证**：短期 **service JWT**（`sub`=服务名、`aud`=目标服务、`scope`=能力）；
>   mTLS 作为集群硬化项后置。
>
> **命名策略**：模块名、目录、文件名、类名、公开路径、operationId、DTO 字段、错误码与
> 事件名全部重构，并在 **P0.5 一次性硬切**；不保留 v1 别名、不做双路径。硬切后新契约
> 成为整个绞杀期的稳定基线，提取阶段不再改名。
>
> **仍然不变**：最终拓扑是 7 个领域/支撑服务 + admin BFF + 1 个推理支撑服务（ontology）；
> 服务间只经 gRPC/RabbitMQ；
> 每个服务独占 database；不引入 saga；跨服务写只有「单所有者写」与「事件派生」两种形态。
>
> 本计划取代 2026-08-14 与 2026-09-30 两次已废置的 monorepo 方向（历史见迁移日志
> 2026-09-30 与 2026-10-07）。路径与结论以当日代码为准；表结构以 `prisma/models/*.prisma` 为准。

---

## 0. 决策摘要

| 议题        | 裁决                                                                                                                                                              |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 切换方式    | **绞杀者渐进**：Kong 第一天挡在单体前；按路由/资源逐片切换，旧栈全程可服务                                                                                        |
| 拓扑        | **Kong + 7 个领域/支撑服务（identity/health/medicine/assistant/insights/notifications/content）+ admin BFF + `services/ontology` 推理支撑服务**；单体是过渡期上游 |
| 提取顺序    | content → telemetry/事件底座 → medicine → notifications → health → insights 读模型 → assistant → identity → admin → 收尾                                          |
| 网关        | **Kong**（DB 模式）：独立 `kong` database + 独立 role；路由、按资源重写、SSE/流式透传；JWT 分阶段上移                                                             |
| 网关管理    | **decK + Git** 管配置；不引入 Konga（第三方 UI，自己还要一个库）                                                                                                  |
| 同步通信    | **gRPC**，契约在 `libs/contracts/proto`；未提取能力经**单体 ACL 适配器**访问                                                                                      |
| 异步/一致性 | **RabbitMQ + 事务性 outbox + 幂等消费**；共存期由单体事件桥接；不引入 saga、不做补偿事务                                                                          |
| 数据库      | **单 Postgres 实例、每服务独立 database**；独立 role、独立 Prisma、独立迁移；无跨库查询/FK/事务                                                                   |
| 命名与契约  | **P0.5 一次性命名硬切**：模块/目录/文件/类/路径/operationId/DTO/错误码/事件名统一改；客户端同步发版；无 v1 别名                                                   |
| 契约基线    | 硬切后的 OpenAPI 成为 P1–P9 的稳定基线；提取期禁止再改公开命名，内部契约可演进                                                                                    |
| 回滚        | **读片路由回滚**；写片在首笔写入前可回滚，之后 forward-fix；旧库保留到 P9                                                                                         |
| 仓库形态    | **pnpm workspace + Turborepo**；根只做编排，legacy 在 `apps/legacy`，新服务在 `apps/*`                                                                            |
| 语言        | **TS 业务服务 + Python 推理服务**；Python 仅 `services/ontology`（Semantica）；LightRAG 仍外置；不引入 Go/Rust                                                    |
| 共享层      | 只共享 `contracts` / `observability` / `api` / `config` / `testing` / `messaging` / `discovery`                                                                   |
| 弹性        | 每服务必备：超时、重试+jitter、熔断、幂等键、DLQ、背压、优雅停机、readiness                                                                                       |
| 服务认证    | **短期 service JWT**（`sub`=服务名、`aud`=目标、`scope`）；mTLS 后置                                                                                              |
| ADR         | 只新增 **2 个**：绞杀者/服务边界/数据所有权、边缘/IPC/部署；其余不写 ADR                                                                                          |
| 部署        | **Nomad 调度 + rnacos 服务发现**（3 节点起步）；本地 Compose；状态服务外置；不用 K8s/Swarm/PM2                                                                    |

**成功判据**：任一时刻，站内所有公开端点都有明确 owner；切换中的资源要么在旧栈、要么在
新服务，不存在双写。**读片**可随时路由回滚；**写片**在首笔新写入前可回滚，之后以
forward-fix 为主，旧库保留到 P9。

---

## 1. 现状基线

- **单包 NestJS 单体**：入口 `src/main.ts` → `AppModule`（`src/app.module.ts` 用 `RouterModule`
  把绝大多数用户域模块挂在 `user` 前缀下）；`sourceRoot: "src"`，构建产物扁平 `dist/main.js`。
- **26 个业务模块** `src/modules/*` + `src/common` + 根级 `config/`、`prisma/`、`i18n/`、
  `mail/`、`llm-runtime/`、`admin-console/`；约 30 个 controller、168 个端点、非测试代码约 84k 行。
- **公开路径是模块级的，不是服务级的**：`/api/v1/user/daily-records`、`/user/reports`、
  `/user/assistant` 同挂 `user` 前缀。因此**不能按 `/user` 前缀切服务**，边缘必须按
  「资源段」路由，见 §2.2。
- **跨模块耦合已收敛为三种缝**：
  1. **reader port**（`DailyRecordReaderPort` / `MedicineDoseLogReaderPort` /
     `MedicineReminderReaderPort` / `IUserSettingsPort` / `IUserHealthContextReader` /
     `IReportSummaryReader` / `INotificationSender`）；
  2. **领域事件**（`src/common/events/domain-events.ts` 7 个事件，跨模块 `emitAsync`/`@OnEvent`）；
  3. **读模型直读**（`today-analysis`/`today-suggestion`/`reports` 直接 Prisma）。
- **基础设施**：Prisma 7 + PostgreSQL（单库 `lucent`、单一 `public` schema）、Redis + BullMQ
  （12 个队列）、OTel/Winston/Prometheus、`nestjs-i18n`、zod 4。
- **AI 面已经是异构的**：LightRAG 与 Semantica 均为独立 Python 服务（Neo4j 本体推理），
  Lucent 只做 HTTP 客户端与 envelope 归一；`assistant` 的编排仍是 TypeScript/LangGraph。
  本计划把 **Semantica 源码收进 `services/ontology`**，LightRAG 继续用第三方镜像外置。
- **构建/工具链**：SWC builder、`#generated/*` import map（约 220 处 import 站点，四处定义需一致）、
  vitest 多套配置、dependency-cruiser/eslint.arch/oxlint/knip、`scripts/` 独立 tsconfig。
- **部署**：单进程、单镜像；`entrypoint.sh` 跑 `prisma migrate deploy` 后 `node dist/main.js`。
- **历史包袱**：`prisma.Path/` 空目录、无引用（迁移时顺手删）。

---

## 2. 目标架构

### 2.1 服务拓扑与提取顺序

**边界判据**：bounded context + 数据所有权 + 变更节奏 + 一致性边界 + 团队所有权；
调用图只作诊断，不作为合并/拆分依据。本质耦合（同一聚合/不变量/事务）不拆；
偶然耦合（共享代码、读模型方便、历史 import）拆掉。

| 服务              | 职责                                                                         | 归入的现有模块                                                                                            | 提取批次 | 实现语言    | 最终数据                  |
| ----------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------- | ----------- | ------------------------- |
| **Kong**          | 边缘：路由、按资源重写、SSE/流式透传、限流、CORS、分阶段 JWT 校验            | 无业务表；独立 `kong` database（路由/插件/凭据）+ 路由清单                                                | P0       | Kong + decK | `kong`（独立库）          |
| **content**       | 内容读面：平台信息、法务文档、环境说明、文件与流式下载                       | app-info、environment、legal-documents、files                                                             | P1       | TypeScript  | `lucent_content`          |
| **medicine**      | 药品知识：目录、说明书、风险规则、检索语料与索引重建、药品识别               | medicines（目录/数据导入/SafetyTip/RiskCheck/语料）                                                       | P3       | TypeScript  | `lucent_medicine`         |
| **notifications** | 通知投递：偏好、模板、站内/邮件/推送、投递日志、重试                         | notifications、notification-preferences、mail                                                             | P4       | TypeScript  | `lucent_notifications`    |
| **health**        | 健康写模型：上下文、记录、事件、剂量、提醒、保留                             | user-health-context、daily-records、health-events、medicine-dose-logs、medicine-reminders、data-retention | P5       | TypeScript  | `lucent_health`           |
| **insights**      | 遥测 + 读模型：产品事件、今日分析/建议、报告、导出                           | product-events、today-analysis、today-suggestion、reports、data-export                                    | P2、P6   | TypeScript  | `lucent_insights`         |
| **assistant**     | 对话式助手：会话、记忆、LLM runtime、工具路由、LightRAG/ontology 客户端、SSE | assistant、llm-runtime                                                                                    | P7       | TypeScript  | `lucent_assistant`        |
| **identity**      | 身份与访问：auth、账户、用户、设置、RBAC、会话、审计落库                     | auth、account、user、user-settings、audit-log                                                             | P8       | TypeScript  | `lucent_identity`         |
| **admin BFF**     | 管理台后端：聚合读、运营写入口、队列面板、`/admin` 静态资源                  | admin、admin-console                                                                                      | P9       | TypeScript  | 无业务表                  |
| **ontology**      | 推理支撑（非 bounded context）：本体/OAG 查询与推理、PROV-O 溯源             | 自建 `semantica-service`（FastAPI）；Neo4j 外置                                                           | P7       | Python      | `lucent_ontology` + Neo4j |
| **legacy**        | 未提取能力的宿主；过渡期唯一全量实现                                         | 剩余模块 + 对外暴露临时 ACL 适配器                                                                        | P0–P9    | TypeScript  | `lucent`（P9 归档）       |

`ontology` **不是第 8 个领域服务**：它不拥有用户/业务数据，只拥有推理所需的本体与
PROV-O 溯源，按「推理支撑件」对待；领域边界仍以 7 个服务为准。它也不参与
North–South 业务路由，只被 assistant（及离线重建任务）经内部契约调用。

**为什么这样排序**：

- **先读后写**：P1 的 content 读面（app-info/environment/legal-documents/files）几乎无状态、
  无跨库写，用来验证 Kong 路由、路径重写、文件流式与回滚机制。
- **再做小写面**：P2 的 product-events 是 write-only、无读契约、失败可丢的遥测路径，
  用来验证 outbox/MQ/幂等，而不拿核心健康数据冒险。
- **medicine 先于 health/insights/assistant**：药品知识是只读、无用户数据的上游；
  health 的风险/提醒、insights 的建议、assistant 的检索都依赖它。先提取 medicine，
  后面三片只需一个稳定的 gRPC 读契约，不再反复走 legacy ACL。
- **notifications 先于 health**：health 的提醒需要投递，insights 的建议也可能触发通知；
  先把外部供应商、重试、DLQ 隔离开，再搬核心写模型。notifications 只经 legacy ACL 读用户联系方式。
- **health 先于 insights**：insights 的读模型消费 health 事件；health 不走完，insights 只能
  直读旧表，拆不干净。
- **insights 先于 assistant**：assistant 的工具需要读报告摘要与今日建议；等 insights 读接口稳定后再搬。
- **assistant 后置**：它依赖 identity 设置、health 上下文、medicine 检索、insights 报告；
  等这些读接口稳定后再搬，避免 ACL 反复改。
- **identity 倒数第二**：JWT 可本地验签，提取前各服务不需要同步调用 identity 就能鉴权；
  它是所有域的共同依赖，最后搬风险最低。
- **admin 最后**：它聚合所有 owner 的资源；owner 全部到位后，`AdminResource` gRPC 扇出才有意义。
- **服务可分片提取**：同一服务的路由可分批切换（如 insights 的遥测与读模型），
  不要求一次搬完一个域。

**admin 为什么独立**：`admin` 的 `resource-registry.ts` + `data.service.ts` 结构性触及约 51 张表。
放进 identity 会让 identity 变成第二个网关；独立后 admin 只做聚合与运营入口，读写一律经 owner
服务的 gRPC，不直连任何业务库。它是 BFF，不是第 8 个领域服务。

**边界归属**：

- **notifications 独立**：通知、偏好、邮件、投递重试归 notifications；`UserReminderDelivery` 归 health。
  identity 只保留用户联系方式与账号状态，不承担投递。
- **assistant 独立**：会话、记忆、prompt、工具路由、`llm-runtime` 归 assistant；
  medicine 只提供检索/风险读接口，不拥有对话状态。
- **content 独立**：app-info/environment/legal-documents/files 归 content；文件走对象存储/流式，
  不与药品知识混部。
- `data-export` 从 health 移到 **insights**（它读 `ReportsService`、产 PDF），消除 health↔insights 环。
- `platform.prisma` 按表拆：通知/偏好 → notifications；导出请求/分享/产品事件 → insights；
  法务/app-info/environment → content；文件元数据 → content。
- `medicine-user.prisma` 按表拆：用户侧四表 + `UserReminderDelivery` → health；
  SafetyTip/RiskCheck/药品目录 → medicine。
- `data-retention` 不再是一个跨库 cron：各服务只清自己的表。
- `reports ↔ assistant` 双向环：`HistoricalAiSummaryService` 与 `llm-runtime` 归 **assistant**，
  assistant 经 insights 的单向 gRPC 读报告；insights 不调用 assistant，调用图保持 DAG；
  不建共享 `libs/ai`。
- **audit**：各服务发 `audit.recorded`；identity 是唯一落库者。审计先不独立，出现
  不可篡改/独立保留要求时再拆。

**共享层**（`libs/`，只放技术与契约，不放业务逻辑）：

| 包                   | 内容                                                                | 允许谁依赖          |
| -------------------- | ------------------------------------------------------------------- | ------------------- |
| `libs/contracts`     | proto、事件 schema、错误码、公开 wire schema、路由/数据所有权类型   | 所有服务 + legacy   |
| `libs/observability` | OTel、日志、指标、trace context 传播                                | 所有服务 + legacy   |
| `libs/api`           | Problem Details filter、gRPC status 映射、SSE helper                | 所有 HTTP/gRPC 服务 |
| `libs/messaging`     | RabbitMQ 连接、publisher confirms、outbox relay、幂等消费 helper    | 使用 MQ 的服务      |
| `libs/config`        | env 解析与校验的基础工具；各服务仍只校验自己的子集                  | 所有服务 + legacy   |
| `libs/discovery`     | `NacosNamingClient` 封装：注册/注销、实例订阅、健康实例选择与连接池 | 所有服务            |
| `libs/testing`       | testcontainers、RabbitMQ/Postgres fixture、契约测试 helper          | 测试                |

**不共享**：`common`、`ai`、`authz`、`i18n`、`audit`、`prisma-*`。业务逻辑、权限判定、
本地化文案、审计规则、Prisma client 一律留在 owner 服务内；共享这些会把微服务重新粘成分布式单体。

### 2.2 绞杀者边缘

Kong 从 P0 起就是唯一入口；初始 100% 流量回源到单体，行为与现在完全一致。

- **DB 模式 + 独立 `kong` 库**：在现有 Postgres 实例上新建 `kong` database 与独立 role，
  `kong migrations bootstrap` 一次，升级时 `kong migrations up`；不复用 `lucent` 业务库。
  数据库故障时业务本来也不可用，因此不额外为“网关控制面独立故障域”做过度设计。
- **配置用 decK + Git**：路由/插件/凭据以 `deploy/kong/` 下的声明配置为准，CI 校验后
  `deck sync`；不引入 Konga。Kong Admin API 只对运维网络开放。
- **路由清单是事实源**：`deploy/kong/route-ownership.yaml` 记录
  `public path（正则）→ owner service → 内部重写路径 → 阶段`。Kong 配置由该清单生成，
  CI 校验它覆盖 `docs/reference/generated/openapi.json` 的全部 operation，且一条路径只能有一个 owner。
- **按资源段路由**：用户域都在 `/api/v1/user/*` 下，因此匹配第二段资源名；公开根路径按实际清单登记。
  例如：
  `^/api/v1/user/(daily-records|medicine-dose-logs|health-events|medicine-reminders)(/|$)` → health；
  `^/api/v1/user/assistant(/|$)` → assistant；
  `^/api/v1/user/medicines(/|$)` → medicine；
  `^/api/v1/user/(files|legal-documents|environment|app-info)(/|$)` → content；
  `^/api/v1/user/(notifications|notification-preferences)(/|$)` → notifications；
  `^/api/v1/user/(today-analysis|today-suggestion|reports|data-export|product-events)(/|$)` → insights；
  `^/api/v1/user/(account|user|user-settings)(/|$)` → identity；
  `^/api/v1/auth(/|$)` → identity。
  Kong 负责 rewrite 到服务内部规范路径（服务不实现公开的 `/user` 前缀）。
- **命名基线**：P0.5 已把公开路径、operationId、DTO 字段与内部模块/目录/文件/类名统一到新命名。
  迁移期新服务按这套基线实现，不再逐片改名；客户端只在 P0.5 同步发版一次。
- **响应一致性**：新服务必须返回与基线一致的状态码、响应形状、Problem Details 与 SSE 事件序列。
  差异由契约测试与影子流量兜住，见 §8。
- **分阶段上移鉴权**：
  1. 共存初期 Kong 只做透传，JWT 仍由各应用校验（避免同时改单体）；
  2. 所有新服务接入统一鉴权模板后，Kong 统一校验 JWT 并注入签名 actor 头；
  3. 单体在退役前保留本地校验作为纵深防御。
- **灰度与影子**：
  - 灰度：按 header（内部账号/特定 userId）→ 按百分比 upstream 权重 → 100%；
  - 影子读：把选定读请求复制到新服务，比较状态码与响应（剔除时间戳、ID 排序等易变字段），
    影子流量不落业务写、不触发通知；
  - 影子实现放 `deploy/shadow/` 的小代理，不把比较逻辑塞进 Kong。
- **ACL 适配器**：未提取能力由单体暴露 `/internal/legacy/*`（HTTP 或 gRPC），仅服务网络可达。
  新服务只依赖该适配器的接口，不依赖单体内部模块；每提取一片就删掉对应 ACL 方法。
- **Kong 不承载业务逻辑**，不做 BFF 聚合。

### 2.3 仓库布局（共存期）

```
package.json              # 根：只放 workspace devDeps、turbo 与脚本，不放业务代码
pnpm-workspace.yaml       # packages: ["apps/*", "libs/*"]
pyproject.toml            # 根：只声明 uv workspace 与 [tool.turbo].name，不放依赖
uv.lock
turbo.json                # futureFlags.experimentalPythonWorkspaces = true
apps/
  legacy/                 # 原单体：src/ prisma/ test/ nest-cli.json package.json
  content/  medicine/  notifications/  health/  insights/  assistant/  identity/  admin/
    package.json  nest-cli.json  src/main.ts  tsconfig.json  prisma/
services/
  ontology/               # 自建 Semantica：pyproject.toml  uv.lock  src/  tests/  Dockerfile
libs/
  contracts/ observability/ api/ messaging/ config/ testing/ discovery/
deploy/
  kong/  shadow/  nomad/  rnacos/
scripts/contract/route-ownership.ts
docs/
```

- **标准布局**：根包不再是应用；P0.5 把 `src/`、`prisma/`、`test/`、`nest-cli.json` 与 legacy
  `package.json` 移入 `apps/legacy/`，根只做编排。`scripts/`、`docs/`、`deploy/` 留在根。
- **命名重构在 P0.5 一次做完**：模块、目录、文件、类、路由、DTO、operationId 一并改齐；
  P1 起的提取阶段只搬代码，不再改名。旧→新映射表用于 codemod 与客户端迁移，完成后删除。
- **新服务不依赖 legacy**：只依赖 `libs/*`、proto 与 ACL 契约。legacy 可依赖 `libs/*`。
- **每服务自带 Prisma**：`apps/<svc>/prisma/schema.prisma` + 自己的 `src/generated/`；
  不建 `libs/prisma-*`，避免跨服务共享数据模型。
- **`libs/*` 用 `tsc`**（`composite: true` + project references）产出 `dist` 与 `.d.ts`。
- **P9 收尾**：删除 `apps/legacy/`，根包保持纯 workspace 编排。
- **admin 前端仍是独立工程链**，构建产物由 admin BFF 静态托管，Kong 路由 `/admin` 过去。
- **Python 只占 `services/ontology`**：自带 `pyproject.toml`、`uv.lock`、`Dockerfile`；
  根 `pyproject.toml` 只做 uv workspace 声明，不放依赖，避免变成第二份依赖清单。
- **不共享跨语言代码**：TS 不 import Python，Python 不 import TS；唯一耦合是
  `libs/contracts` 里的 HTTP/proto schema 与生成客户端。

### 2.4 进程间通信

- **边缘（Kong）**：DB 模式 + 独立 `kong` 库，配置由 decK 从 Git 同步；按 §2.2 的路由清单转发；
  SSE 关闭缓冲直接透传；上传/下载流不落盘。限流与 CORS 在边缘，细粒度权限在服务。
- **同步（gRPC）**：`@nestjs/microservices` + `Transport.GRPC`，proto 位于
  `libs/contracts/proto/*.proto`。服务间同步调用只允许**读**与**单所有者写**。
  **server-streaming** 承载 assistant 对话 SSE 与 content 文件下载流。
- **异步（RabbitMQ + outbox）**：跨服务事件统一走 **RabbitMQ**。
  - 拓扑：共享 `lucent` vhost + 每服务独立账号/权限；业务事件用 topic exchange，
    命令用 direct exchange；队列名带服务前缀，用 quorum queue，消费端手动 ack + prefetch 限流；
    不用每服务 vhost（会阻断跨服务事件，除非再加 shovel/federation）；
  - 新服务：状态变更与 outbox 写入同一事务，由 `OutboxRelay` 发布，publisher confirms 确认；
  - legacy：P2 前加**事件桥**（`EventEmitter2` → RabbitMQ），把跨边界领域事件发出去；
    bridge 是有损的过渡件，涉及写入的消费者必须配 reconciliation；
  - 投递语义：at-least-once + 消费端按 `event_id` 去重；
  - **DLQ**：每个业务队列配 `x-dead-letter-exchange`；毒消息进 DLQ，提供查看与重放工具；
  - **事件契约版本**：事件带 `schemaVersion`，只做向后兼容演进；schema 放 `libs/contracts`；
  - 每提取一片，把该域的监听器从单体内桥接改为服务原生消费。
- **BullMQ 不退役**：RabbitMQ 负责跨服务事件，BullMQ 继续负责**服务内**的定时任务、
  延迟任务、重试与批处理（`lucent-cron`、周报、提醒调度等）。两者职责不同：
  不要用 RabbitMQ 替代 BullMQ 的 repeatable job，也不要用 BullMQ 做跨服务事件总线。
  各服务自带 Redis 连接与队列，key/队列名带服务前缀，不做跨服务 job 耦合。
- **身份**：用户 JWT 本地验签；actor 上下文（`userId`/`roles`/`scopes`/`traceparent`）经
  gRPC metadata 与 MQ header 传递；敏感操作在 identity 提取后查会话/吊销，
  提取前走 legacy ACL（`identity-introspect`）。
- **服务认证**：内部 gRPC/HTTP 调用带**短期 service JWT**（5–15 分钟，EdDSA/RS256）：
  `sub`=调用方服务名、`aud`=目标服务、`scope`=允许的操作；目标服务校验签名、`aud`、`scope`
  与调用方 allowlist。service JWT 只证明“服务是谁”，actor header 只证明“用户是谁”，两者不混用。
  RabbitMQ 用共享 vhost + 每服务独立账号与权限；消息信封带 `producer`，消费端按 allowlist 校验。
  集群内再加 NetworkPolicy；mTLS/SPIFFE 作为后续硬化项，不阻塞本次拆分。
- **错误语义**：HTTP 边界统一 Problem Details；gRPC status 在 `libs/api` 映射，
  错误码注册表保持稳定。

### 2.5 数据与一致性

**拓扑（P0 起）**

- **单 Postgres 实例、每服务独立 database**：
  `lucent`（legacy）、`lucent_content`、`lucent_medicine`、`lucent_notifications`、
  `lucent_health`、`lucent_insights`、`lucent_assistant`、`lucent_identity`、
  `lucent_ontology`（推理溯源；Neo4j 图库仍在外部）。
  admin BFF 不建业务库。不做 schema 隔离；每个 database 用默认 schema。
- 每服务**独立 role**，只对自己的 database 有 DDL/DML 权限；legacy role 不允许连接服务库。
- 每服务**独立 Prisma schema、独立 client、独立迁移史**：`apps/<svc>/prisma/`，
  `migrate deploy` 只跑自己的库。P0 spike 先验证新库创建、迁移、回滚与连接池。
- `ontology` 不用 Prisma：Python 侧自带迁移/初始化脚本，只对 `lucent_ontology` 有权限；
  Neo4j 的 `lucent_graph` 由 ontology 独占访问，Lucent 业务服务不直连。

| 服务              | database               | 拥有的数据                                                                    |
| ----------------- | ---------------------- | ----------------------------------------------------------------------------- |
| **content**       | `lucent_content`       | app-info、environment、legal-documents、文件元数据/对象存储引用               |
| **medicine**      | `lucent_medicine`      | 药品目录、说明书/DrugBank 派生、SafetyTip/RiskCheck、语料/chunk/索引状态      |
| **notifications** | `lucent_notifications` | 通知偏好、模板、投递任务/日志、渠道凭据引用                                   |
| **health**        | `lucent_health`        | health context、daily records、health events、dose logs、reminders、retention |
| **insights**      | `lucent_insights`      | product events、今日分析/建议、报告、导出请求、AI 摘要物化                    |
| **assistant**     | `lucent_assistant`     | 会话、消息、记忆、prompt/工具运行记录、AI 摘要生成任务                        |
| **identity**      | `lucent_identity`      | auth/account/user、user settings、RBAC、session、audit log                    |
| **admin BFF**     | 无                     | 只做聚合与运营入口，不拥有业务表                                              |
| **ontology**      | `lucent_ontology`      | PROV-O 溯源/审计链；本体词表与推理配置；不含用户/业务数据                     |

- **禁止跨 database 查询、外键、事务**。不装 `dblink`/FDW 做跨库 join；`userId` 等只是逻辑引用，
  引用完整性由应用校验 + 对账 job 保证。
- **表所有权清单**：`deploy/data-ownership.yaml` 记录每张表 → owner service → 迁移状态。
  这是 ETL、授权和代码审查的共同事实源。

**单片切换（写片）**

1. 在目标库建表（从 owner 服务的 Prisma 迁移生成）；准备一次性复制脚本。
2. 短暂冻结该资源的写（分钟级）；`pg_dump`/批量 copy 到目标库。
3. 校验行数、关键字段校验和、序号/时间戳边界；重复执行幂等。
4. 路由切到新服务；旧库对应表标记为只读（保留作灾备快照）。
5. 更新 monolithic admin 的读适配器：该资源改走 owner 服务 gRPC，不再读旧库。
6. soak 后删除 legacy 对应代码与旧表；旧库只保留归档快照。

**回滚边界（必须说清楚）**

- **读片**：随时路由切回 legacy，旧库仍在，5 分钟级回滚。
- **写片**：首笔新写入前可路由切回；切流并接受写入后，旧库已不是权威源，
  **回滚改为 forward-fix**。旧库保留到 P9 作为灾备快照，但不承诺反向 ETL。
- 这是 database-per-service 的必然代价：想保留写片双向回滚，就得引入双写或反向 CDC，
  两者都比 forward-fix 复杂。本计划选择不引入。

**其余规则**

- **无跨库外键**。现有 `user.prisma` 的 46 条 `onDelete: Cascade` 改为事件驱动的异步清理。
- **无跨库事务**。跨服务写只有两种形态：单所有者 gRPC 命令、事件派生。任何需要多服务
  原子性的流程，要么重设计为最终一致，要么砍掉。不引入 saga。
- **admin 读路径随片演进**：共存期 admin 仍在 legacy，但不能跨库直读；每迁一个域，
  admin 的对应读适配器就切到该域 gRPC。admin 提取（P9）只是把适配器集中到 admin BFF。
- **用户删除**：identity 标记删除并发出 `USER_DELETED`；各服务异步清理自有数据；
  不做分布式事务，不等待全局完成。
- **保留策略**：各服务独立执行自己的保留清理。
- **审计**：各服务发 `audit.recorded`；identity 消费并落 `AuditLog`；
  需要同步落库的走 identity gRPC。
- **数据复制是逐片的**，不是切换日一次性全量；每片都有行数、关键校验和、重复执行幂等。
- **单实例是务实妥协**：逻辑上 database-per-service，物理上共享故障域与资源。
  扩容时可按 database 迁到独立实例，连接串切换即可，不改变代码。

### 2.6 命名与对外契约

- **P0.5 一次性硬切**：在单体里统一完成新命名——服务名、模块名、目录/文件名、类名、
  公开路径、operationId、DTO 字段、错误码、领域事件名、队列名。**不保留 v1 别名、不做双路径、
  不做兼容层**。
- 这是一次全站 breaking change：Luminous 与 `admin/` 客户端在 P0.5 同一发布窗口重新生成并发版；
  旧客户端不保证可用。除这次之外，迁移期不再有面向客户端的契约变更。
- **硬切后导出新的 OpenAPI golden snapshot**，作为 P1–P9 每片切换的契约基线；
  `scripts/contract/contract-diff.ts` 只比较新服务与这份基线。
- 新服务在内部用规范路径，Kong 按路由清单重写到公开路径；内部重写对外不可见。
- `docs/reference/generated/openapi.json` 在 P0.5 重新生成一次，完工后再由合并产物覆盖。
- gRPC proto 同步使用新命名；内部契约可独立演进，但不得反向改变公开 HTTP 命名。
- **提取期改名禁令**：P1–P9 任何 PR 若改动公开路径、operationId 或 DTO 字段名，CI 直接阻断。
  内部文件/类名如需进一步整理，只能在契约不变的前提下单独 refactor。
- **范围边界**：P0.5 改代码标识符与公开契约；数据库表名/列名不在这次硬切范围，
  避免与逐片数据迁移叠加。DB 命名如需调整，另开独立迁移。
- **长期版本策略**：P0.5 的硬切是一次性迁移例外；此后公开 API 以 `/api/v1` 为稳定面，
  breaking change 走新 major 版本（`/api/v2`）并保留弃用期。不要在提取期再用“硬切”当常态。

### 2.7 横切关注点

- **config**：`libs/config` 只提供 env 解析/校验工具；各服务定义并校验自己的 env 子集，仍 env-only。
- **authz**：不共享权限矩阵；`libs/contracts` 只放 role/scope 枚举与错误码，
  具体判定在 owner 服务内。Kong 执行粗粒度，服务执行细粒度。
- **i18n**：不共享业务文案；各服务用 `nestjs-i18n` 渲染自己的 Problem Details，
  错误码与文案键以 `libs/contracts` 为准。
- **observability**：`libs/observability`；W3C trace context 经 gRPC metadata 与 RabbitMQ header
  透传；每服务暴露 `/metrics`、`/health/live`、`/health/ready`；Kong 暴露边缘指标；
  **路由清单的 owner 标签进指标**，便于按片观察错误率与延迟。
  后端**沿用现有 VictoriaMetrics 栈**（VictoriaMetrics/VictoriaLogs/VictoriaTraces 或现有 VM
  cluster 组件），OTel Collector 统一导出；不新增 Prometheus/Tempo/Loki 另一套栈。
- **audit**：不共享审计实现；各服务经 `libs/messaging` 发 `audit.recorded` 事件，
  identity 是唯一落库者。
- **api**：`libs/api` 提供 Problem Details filter、序列化、SSE helper 与 gRPC status 映射。
- **messaging**：`libs/messaging` 提供 RabbitMQ 连接、publisher confirms、outbox relay、
  幂等消费与 DLQ helper；不含业务事件语义（语义在 `libs/contracts`）。
- **弹性模板**：每个服务必须实现 §2.9 的弹性契约，模板放在 `libs/api`/`libs/messaging`
  之外的 service template 中，不共享业务配置。

### 2.8 多语言策略（TypeScript + Python）

- **TypeScript 仍是默认**：content、medicine、notifications、health、insights、assistant、
  identity、admin BFF 与 legacy 全部 TS。
- **唯一 Python 单元是 `services/ontology`**：自建 Semantica（FastAPI）承担本体/OAG 推理，
  是核心能力且与 Lucent 契约共同演进，因此收进仓库；它是推理支撑件，不是第 8 个域服务。
  **assistant 持有客户端与检索编排**；**medicine 只拥有药品语料与索引重建任务**。
- **LightRAG 继续外置**：第三方镜像（`ghcr.io/hkuds/lightrag`），源码不归本仓；
  只保留 `deploy/lightrag/` 的配置与 prompt。按外部服务对待（超时、重试、熔断、降级、指标）。
- **不再有 Go/Rust 服务**：如未来需要，先在边界稳定后重写单个服务并另开计划，
  不在本计划预留半成品目录。
- **构建编排用 Turborepo 2.11+ 的多语言 Task Graph（experimental）**：
  - 根 `pyproject.toml` 声明 `[tool.uv.workspace] members = ["services/ontology"]` 与
    `[tool.turbo].name`；`turbo.json` 开 `experimentalPythonWorkspaces`；
  - 根 `uv.lock` 是锁文件，Turbo 不生成也不更新它，CI 用 `uv lock --check` 阻断漂移；
  - `turbo run build/test/lint/check` 自动映射到 `uv build` / `pytest` / `ruff` / `mypy`；
  - `uv` 版本在 CI 与开发环境钉死；experimental 期间保留 `uv run pytest` 直跑作为 fallback。
- **Python 打包与镜像**：独立多阶段 Dockerfile，不把 Python 塞进 Node 镜像；模型权重与
  vendor 的 wheel 树不进 Git，走构建期下载或私有 registry；`THIRD_PARTY_NOTICES` 继续维护。
- **契约是唯一跨语言边界**：ontology 的 `/query`、`/reason` schema 放 `libs/contracts`，
  生成 TS 客户端；TS 与 Python 之间不共享代码、不做进程内调用。
- **可观测**：ontology 接 OTel Python SDK，HTTP 客户端与 gRPC metadata 都要传播 `traceparent`；
  指标/日志进现有 VictoriaMetrics 栈。

### 2.9 服务弹性契约（每服务强制）

每个新服务在模板里就要带齐，缺一项不算完成：

| 能力     | 要求                                                                                     |
| -------- | ---------------------------------------------------------------------------------------- |
| 超时     | 所有出站调用必须有超时：gRPC deadline、HTTP timeout、RabbitMQ 消费处理超时；禁止无限等待 |
| 重试     | 只对幂等操作重试；指数退避 + jitter；有上限与总预算；非幂等写不自动重试                  |
| 熔断     | 按依赖（DB/Redis/gRPC/RabbitMQ）独立熔断；半开探测；熔断状态进指标                       |
| 幂等键   | HTTP 写支持 `Idempotency-Key`；gRPC 写带幂等 token；MQ 消费按 `event_id` 去重            |
| DLQ      | RabbitMQ 每队列配 DLX/DLQ；毒消息隔离；提供查看、重放、丢弃工具                          |
| 背压     | 消费端 prefetch/并发上限；HTTP 限流；过载返回 429/503 + `Retry-After`；禁止无界队列      |
| 优雅停机 | 停止接新请求 → 等待 in-flight 完成 → 关闭连接；Nomad `kill_signal`/`kill_timeout` 对齐   |
| 健康检查 | `/health/live` 与 `/health/ready` 分离；readiness 检查关键依赖；依赖失败时摘流量         |
| 隔离     | DB/Redis/gRPC 连接池按依赖分池；慢依赖不拖垮整个服务（bulkhead）                         |
| 可观测   | 每个出站调用有 span；超时/重试/熔断/DLQ 计数进指标；日志带 `trace_id`/`event_id`         |

这些是服务模板的一部分，不靠“记得写”。P2 起每个新服务必须通过弹性验收用例。

### 2.10 服务发现与部署约定（Nomad + rnacos）

**目标**：用 **Nomad 做调度、rnacos 做注册中心/服务发现**，本地仍用 Compose；
不引入 K8s/Docker Swarm/PM2，**也不引入 Consul**。

**为什么是 rnacos 而不是 Consul**：rnacos 已经在本仓生产运行（`qingpan/rnacos:v0.8.7`，
单节点，承担运行时配置中心），Node 侧原生绑定 `nacos-sdk-rust-binding-node@0.8.0`
已在 `package.json` 依赖并由 `src/config/runtime/rnacos-config-source.ts` 使用。
该绑定同时导出 `NacosNamingClient`（`registerInstance`/`deregisterInstance`/
`selectOneHealthyInstance`/`subscribe`，gRPC 推送），服务发现**零新依赖**即可用。
相比之下 Consul 需要新增一整套 server + 每节点 agent + ACL。在 Nomad 与 Kong 上的
两处缺口用少量胶水补，仍比多运维一个系统便宜。

- **注册中心**：复用现有 rnacos 实例升级为「注册中心 + 配置中心」。数据由 raft +
  节点文件存储（`nacos_db`），备份该目录即备份全部数据；单机等同单节点集群，
  后续按需加节点。**不引入 Consul**；rnacos 与 Postgres/Redis/RabbitMQ 一样属状态服务，
  不进 Nomad 普通 job（现有 Compose 单机继续用，集群化时独立部署）。
- **Nomad 没有 Nacos provider**：`service` provider 只有 `consul`/`nomad`，因此
  **注册放应用侧**——服务启动时用 `NacosNamingClient.registerInstance` 注册
  `ip:port`（临时实例 + 心跳），优雅停机时 `deregisterInstance` 再退出（与 §2.9
  `kill_signal`/`kill_timeout` 对齐）。Nomad 自己的 `service`/健康检查与 Nacos 注册
  并存：Nomad 管调度与 `/health/ready`，Nacos 管「谁在哪里」。
- **服务内发现**：`libs/discovery` 封装 `NacosNamingClient`：启动注册、订阅实例变化、
  维护 `key → 健康实例列表` 缓存、按 weighted-random/round-robin 选实例并维护连接池；
  gRPC 客户端不写死 host，经该包拿到目标地址。所有服务共用，避免各写一份 resolver。
- **原生绑定约束**：`libs/discovery` 依赖 `nacos-sdk-rust-binding-node`，镜像必须按目标
  架构（x64/arm64）带对应 `.node`；沿用现有的懒加载方式，未启用发现时（legacy/单测）
  不加载原生代码。该绑定没有真正的 `close()`/`unSubscribe()`，客户端按进程生命周期
  单例复用，注册/订阅只做一次。
- **Kong 接入（唯一缺口）**：Kong OSS 没有原生 Nacos discovery，Nacos 也不提供 DNS/SRV。
  P0 采用**静态 upstream + decK**：7 个服务、3 个节点，把「节点 IP + 固定端口」写进
  `deploy/kong/` 的 Git 配置；只有增删节点才改配置。当节点频繁伸缩时，再上
  `deploy/rnacos/` 里的同步器（订阅 Nacos → Kong Admin API 维护 upstream target），
  不换网关。
- **gRPC 寻址**：每节点一实例 + 固定端口，`libs/discovery` 直接拿到 `ip:port`，
  不依赖 DNS/SRV，也绕开 grpc-js 对 SRV 支持有限的问题。
- **Kong**：DB 模式，作为边缘 job 跑在入口节点，暴露 80/443；只有它有宿主端口。
  多入口节点时前面加一层 L4 LB 或 DNS 轮询；`deck sync` 仍在 CI/发布流程里做。
- **集群形态**：3 台小 VM（建议 4C8G 起）同时跑 Nomad server+client；本地开发用
  Compose，不要求每人装 Nomad。
- **Nomad job**：每个服务一个 job，配 `update { canary = 1, auto_revert = true }`、
  资源限制、`restart`/`reschedule`；ACL 开启，按服务划分 policy；密钥用 Nomad Variables
  （Vault 后置）。rnacos 账号/口令与现有 `RNACOS_*` 环境变量衔接。
- **状态服务外置**：Postgres、Redis、RabbitMQ、VictoriaMetrics、rnacos 不放进 Nomad 的
  普通 job。优先托管或独立 VM；必须自管时用 host volume + 独立备份，不和 7 个无状态
  服务抢调度。
- **发布**：CI 构建镜像 → 推 registry → `nomad job plan` → `nomad job run`（canary，健康后
  promote）；迁移做成一次性 batch job，先跑迁移再更新服务；回滚用 `nomad job revert`
  或切回上一个镜像 tag。
- **可观测**：OTel Collector 作为 Nomad job（或现有栈内进程）统一导出到 VictoriaMetrics 栈；
  不新增 Prometheus/Tempo/Loki。
- **P9 后进程集合**：Kong + content + medicine + notifications + health + insights + assistant +
  identity + admin BFF + ontology（Python）+ RabbitMQ + Postgres + Redis + VictoriaMetrics 栈 +
  rnacos + Neo4j。ontology 用独立镜像/job，资源限制单独配。

---

## 3. 边界映射的关键取舍

- **admin 通用数据层**：共存期 admin 仍在单体，但**不能跨库直读**；每迁一个域，
  admin 的对应读适配器就切到该域 `AdminResource` gRPC，未迁的才读 legacy 库。
  写一律走 owner 服务；脱敏与软删在每个 owner 服务内强制。
- **product-events**：归 insights；记录路径改为 fire-and-forget 事件，读取走 gRPC。
- **read-model（today-analysis/today-suggestion/reports）**：直读改为 **reader-port gRPC** +
  事件增量重算；提取前读 health 的 legacy ACL。
- **reports ↔ assistant**：`llm-runtime`/`HistoricalAiSummaryService` 归 assistant，
  assistant 经 insights 的单向 gRPC 读报告；insights 不反向同步调用 assistant，否则 gRPC 会成环。
  `report-summary` 由 assistant 执行，结果以 `REPORT_SUMMARY_GENERATED` 事件回写 insights。
- **data-retention**：按服务拆散，各自清自己的表。
- **notifications**：独立服务；identity 只管用户联系方式，health/insights 只发投递命令、
  收投递结果事件。
- **medicine ↔ assistant**：medicine 拥有目录、风险规则与检索语料；结构化药品数据由 assistant
  经 gRPC 读，中文散文检索走 assistant 自己的 LightRAG 客户端（语料由 medicine 重建）。
  不复制药品数据，也不把 prompt/会话写回 medicine。
- **content**：独立服务；files 走对象存储/流式，app-info/environment/legal-documents 走只读内容接口。
- **事件桥**：只在共存期存在；P9 必须删除，不允许长期保留「单体 ↔ MQ」双栈。

---

## 4. 关键跨服务流走查

1. **登录/刷新**：Kong → legacy（identity 提取前）/ identity（P8 后）签发；
   提取前所有服务本地验签，提取后 Kong 验签并注入 actor 头，敏感操作查 identity 会话。
2. **记录变更 → 建议重算**：health 事务写 + outbox 发 `DAILY_RECORD_CHANGED` →
   insights 幂等消费并重算；共存期若 health 未提取，由 legacy 事件桥发出。
3. **提醒投递**：health 调度（BullMQ）→ notifications gRPC `notification.send`
   （P4 前走 legacy ACL）→ 三渠道投递 → 投递结果事件 →
   health 异步写 `UserReminderDelivery`。
4. **assistant 工具读**：assistant 经 gRPC 读 identity 设置、health 健康上下文、
   medicine 目录/风险、insights 报告摘要；散文检索走 LightRAG 客户端；
   SSE 由 Kong 透传 server-streaming。
5. **admin 通用数据层**：admin UI → Kong → admin BFF（P9 前为 legacy admin）→ 各 owner 服务
   `AdminResource` gRPC 扇出；共存期 admin 仍在单体直读（只读 legacy role）。
6. **审计**：各服务发 `audit.recorded`；identity 消费落库。
7. **用户删除**：identity 标记删除 + 发 `USER_DELETED`；各服务异步清理；最终一致，不等待。
8. **服务间调用**：调用方带短期 service JWT（`sub`/`aud`/`scope`）→ 目标校验签名与 `aud`/`scope`
   → 用户 actor 上下文另行透传；两者不混用。

---

## 5. 分阶段执行与完成定义

**每片独立可上线、可回滚；不设全局切换窗口。**

### P0 — 护栏与 spike

- 导出**现网契约快照**（供 P0.5 差异用）；建立 `route-ownership.yaml` 与 `data-ownership.yaml`，
  CI 校验路由覆盖与单 owner。
- Kong 挡在单体前，100% 透传；补按资源段重写、SSE/文件流规则。
- 两条 ADR：**ADR-0024 绞杀者、服务边界与数据所有权**（7 个 bounded context、分片、独立 database、
  回滚边界、旧库归档）；**ADR-0025 边缘、IPC 与部署**（Kong、gRPC、RabbitMQ/outbox、service JWT、
  Nomad + rnacos、事件桥）。
- 七条 spike：
  1. Kong DB 模式：独立 `kong` 库 bootstrap/migrations + decK sync + 按资源段路由/rewrite +
     SSE/文件流 + header 灰度；
  2. 每服务独立 database：独立 role、独立 Prisma client、独立迁移史、连接池隔离；
  3. 影子读比较与差异报告（含敏感字段脱敏）；
  4. 单片写冻结 → 跨库复制 → 路由切换 → 首笔写入前的回滚演练；
  5. RabbitMQ quorum queue + DLQ + publisher confirms + 幂等消费；
     service JWT 的签发/校验/轮换与 gRPC metadata 透传；
  6. **Nomad + rnacos**：`NacosNamingClient` 注册/注销与实例订阅（`libs/discovery` 雏形）、
     Nomad 健康检查与 Nacos 心跳并存、**Kong → Nacos 接入定案**（静态 upstream + decK，
     或 `deploy/rnacos/` 同步器）、canary 发布与 `nomad job revert`、迁移 batch job、
     ACL/Variables 与 `RNACOS_*` 衔接最小可用。
  7. **多语言构建**：Turbo 2.11 `experimentalPythonWorkspaces` + uv workspace 发现、
     `services/ontology` 的 `build/test/lint/check` 映射与缓存、`uv lock --check`、
     CI 中 `uv run pytest` fallback；确认 Turborepo 2.11+ 版本钉死。
- 门禁：P0 全部在预发跑通；Kong 透传下契约测试与现网行为一致；不通过不进 P0.5。

### P0.5 — 命名硬切（唯一一次公开契约破坏）

- 先定命名规范，再改代码：服务名、模块名、目录/文件名、类名、公开路径、operationId、
  DTO 字段、错误码、领域事件名、队列名。产出旧→新映射表。
- 用 codemod + 手工收敛完成单体重命名；同步改 `RouterModule` 前缀、OpenAPI、i18n 文案键与
  事件/队列常量；`#generated/*` 引用随文件移动更新。
- **一次性发布**：后端与 Luminous、`admin/` 客户端在同一维护窗口升级；不保留 v1 别名、
  不做双路径、不做兼容层。旧客户端在窗口后不再保证可用。
- 硬切后导出新的 OpenAPI golden snapshot，作为 P1–P9 的契约基线；CI 增加命名基线检查，
  阻断提取期对公开路径/operationId/DTO 字段名的改动。
- 门禁：全仓 typecheck/lint/arch/test 绿；客户端重新生成并通过 e2e；路由清单与新路径一致；
  新 golden snapshot 与命名映射表一致。

### P1 — content 读面（第一次绞杀）

- 建 `apps/content` 骨架，迁 app-info、environment、legal-documents、files（只读 + 文件流）。
- 影子读 → header 灰度 → 100%；旧路由从单体摘除。
- 门禁：影子差异为零（允许白名单字段）；文件上传/下载/流式与签名 URL 一致；回滚演练通过。

### P2 — telemetry 写面与事件底座

- 建 `apps/insights` 骨架，迁 product-events；引入 **RabbitMQ**、outbox、幂等消费、DLQ。
- legacy 加事件桥；事件契约与 `schemaVersion` 放 `libs/contracts`。
- 门禁：重复投递无重复副作用；RabbitMQ 抖动/消费者重启不丢已确认事件；
  DLQ 可查看/重放；回滚后事件不双发。

### P3 — medicine 知识域

- 建 `apps/medicine` 骨架，迁药品目录、说明书/DrugBank 导入、SafetyTip/RiskCheck、
  检索语料与索引、`medicine-recognition`。
- 对外提供只读目录/风险 gRPC；药品写入口仍经 admin/legacy 运营入口 → medicine 命令接口。
- 门禁：目录/风险规则一致；语料/索引重建可重入且结果与旧栈一致；不持有任何用户健康数据；
  admin 对应读适配器已切到 medicine gRPC。

### P4 — notifications 投递域

- 建 `apps/notifications` 骨架，迁 notifications、notification-preferences、mail；
  接管站内/邮件/推送三渠道与 `lucent-mail` 队列。
- identity 提取前，经 legacy ACL 读用户联系方式；投递结果以事件回给调用方。
- 门禁：三渠道投递与偏好一致；重试/DLQ/限流可用；供应商超时不拖垮调用方；
  `UserReminderDelivery` 仍由 health 写入。

### P5 — health 写模型

- 迁 user-health-context、daily-records、health-events、medicine-dose-logs、medicine-reminders、
  data-retention；写路径经 outbox 发领域事件。
- 依赖 P3 medicine 的目录/风险读接口与 P4 notifications 的投递命令。
- 门禁：读写在影子期一致；跨用户 404、limit 上限等 e2e 全绿；数据对账零差异；
  admin 对应读适配器已切到 health gRPC；旧库对应表只读。

### P6 — insights 读模型

- 迁 today-analysis、today-suggestion、reports、data-export；reader-port 改 gRPC/事件。
- 门禁：读模型结果与旧栈逐条比对（含空数据、边界日期）；PDF/导出字节级或语义级一致；
  `reports ↔ assistant` 无环；P7 前 `report-summary` 仍由 legacy 提供，insights 不直接调用 assistant。

### P7 — assistant 对话域

- 建 `apps/assistant` 骨架，迁 assistant、llm-runtime、`HistoricalAiSummaryService`；
  assistant 的编排保持 TypeScript（LangGraph），LightRAG 仍是外部服务，
  ontology 是 `services/ontology` 的 Python 推理支撑件（HTTP 客户端 + 超时/熔断/降级）。
- 同步把 `semantica-service` 源码收进 `services/ontology`，建立 Python 构建/测试 lane
  与独立镜像；对外契约不变（`/query`、`/reason`），先搬目录再谈优化。
- 工具读经 gRPC：medicine 目录/风险、health 上下文、insights 报告、identity 设置；
  中文散文检索走 LightRAG 客户端，本体推理走 ontology。
- 门禁：SSE 事件序列与首字节延迟不劣化；工具路由与权限门禁一致；检索评测集
  （recall/答案引用）不低于基线；LightRAG/ontology 超时或不可用时降级路径可用；
  `uv run pytest` 与 Turbo 的多语言任务都通过。

### P8 — identity 域

- 迁 auth、account、user、user-settings、audit-log；notifications/mail 已在 P4 独立。
- Kong 切到统一 JWT 校验；单体保留本地校验直到退役。
- 门禁：登录/刷新/吊销/MFA/权限矩阵全绿；审计链路完整；notifications 读取联系方式
  从 legacy ACL 切到 identity gRPC。

### P9 — admin BFF 与收尾

- 迁 admin；`AdminResource` gRPC 扇出替代剩余的 legacy 直读。
- 删除 legacy 路由、ACL 适配器、事件桥、旧代码；归档 `lucent` 旧库。
- 门禁：**零 legacy 流量、零 legacy 写权限、零跨 database 访问**；所有服务独占 database。

**完成定义（DoD，缺一不可）**

1. 路由清单覆盖 100% 公开 operation；Kong 后无未映射路径。
2. 每片都有影子对比记录、soak 记录、回滚演练记录；读片可 5 分钟内切回，
   写片在首笔写入前可切回，之后按 forward-fix 记录。
3. 公开契约以 P0.5 硬切后的新基线为准；P1–P9 零变化；Luminous 与 `admin/` 已在 P0.5
   同步升级并通过 e2e；上线代码中不存在 v1 别名或双路径。
4. 零跨 database 查询/FK/事务；DB 授权与 `data-ownership.yaml` 一致；
   legacy role 连不上服务库。
5. 跨服务依赖只经 gRPC/RabbitMQ；零跨服务 Prisma import；每服务独立 Prisma 与迁移史。
6. 数据对账逐片通过；outbox 无积压；DLQ 可重放；幂等重放通过；
   用户删除、保留清理、审计端到端通过。
7. 停任一下游服务，Kong 返回明确错误而非崩溃；恢复后自愈；
   超时/重试/熔断/背压/优雅停机验收用例全绿。
8. 单体、ACL、事件桥、旧库全部删除/归档；各服务独占 database；
   根包只剩 workspace 编排。

---

## 6. 构建与工具链改造清单（按断裂风险排序）

1. **路由所有权清单与 Kong 配置生成**：`scripts/contract/route-ownership.ts` 校验覆盖与单 owner，
   生成 decK 可同步的 Kong 声明配置；CI 阻断未登记路由，部署前 `deck sync`。
2. **共享契约包**：`libs/contracts`（proto、事件 schema、错误码、公开 wire schema、
   路由/数据所有权类型）先落地；**公开 HTTP DTO 仍由 owner 服务持有**，只把跨服务
   wire 契约放进去，避免共享业务 DTO。
3. **命名 codemod（P0.5，最高风险）**：旧→新映射表驱动模块/目录/文件/类/import 的重命名；
   `#generated/*`、`RouterModule`、OpenAPI operationId、i18n 键、事件/队列常量同步更新。
   一次改完，避免提取期反复改名。
4. **根布局迁移（P0.5）**：`src/`、`prisma/`、`test/`、`nest-cli.json`、legacy `package.json`
   移入 `apps/legacy/`；根 `package.json` 只留 workspace/turbo/脚本；同步修 tsconfig、
   `#generated/*`、vitest、eslint、knip、depcruise 的路径。
5. **Prisma 独立**：legacy 用 `apps/legacy/prisma` + `#generated/*`；新服务各自
   `apps/<svc>/prisma/schema.prisma` 与 `src/generated/`；每库独立迁移史，不共享 client。
6. **工具链 glob**：`eslint.config.ts`、`eslint.arch.config.ts`、`.oxlintrc.json`、`knip.config.ts`、
   `.dependency-cruiser.cjs`、`scripts/arch/check-ast-conventions.ts` 覆盖 `apps/**`+`libs/**`；
   dependency-cruiser 增加服务边界规则（禁跨服务依赖、禁跨服务 Prisma）。
7. **Turbo 任务图（多语言）**：升级到 2.11+，开 `experimentalPythonWorkspaces`；
   `build`/`lint`/`typecheck`/`test` 覆盖新旧包，Python 侧映射到
   `uv build`/`ruff`/`mypy`/`pytest`；CI 用路径过滤只跑受影响服务；保留 `uv run pytest` fallback。
8. **Docker 产线**：新服务独立镜像；legacy 镜像继续单进程。共存期同时存在两套入口脚本，
   P9 删除 legacy。
9. **vitest**：加 `vitest.workspace.ts`，列出 `apps/*`、`libs/*`；legacy 现有配置随目录迁移。
10. **OpenAPI**：P0.5 重新导出命名后的 spec；新服务导出自己的 spec；`merge-openapi.ts`
    合并为完成态产物，共存期用 P0.5 golden snapshot 做 diff。
11. **docs 工具**：`scripts/docs/links.ts` 与 `scripts/docs/verify.ts` 的路径记号加 `apps|libs`，
    `src/...` 改为 `apps/legacy/src/...`；P0.5 同步重写模块 README 与 `docs/README.md`。
12. **i18n**：不建 `libs/i18n`；legacy 继续用现有 `nestjs-i18n`，新服务各自配置 locale/
    文案目录；错误码与文案键在 `libs/contracts` 中登记，避免各服务私有码漂移。
13. **服务模板**：一个 NestJS 服务模板，内置 §2.9 弹性契约、RabbitMQ/outbox 接入、
    service JWT 校验、OTel、健康检查、Dockerfile 与 CI lane；新服务从模板生成。
14. **`prisma.Path/`**：空目录无引用，迁移时删除。
15. **Nomad/rnacos 资产**：`deploy/nomad/` 每服务 jobspec、`deploy/rnacos/`（注册中心
    配置与可选的 Kong upstream 同步器）、`libs/discovery`；CI 增加 `nomad job validate`/
    `nomad job plan`；迁移与发布拆成独立步骤；本地 Compose 与 Nomad 的 env/端口只经
    `libs/config` 子集映射，rnacos 连接复用现有 `RNACOS_*`，不做两套业务配置。
16. **Python 资产**：根 `pyproject.toml`（只声明 uv workspace 与 `[tool.turbo].name`）、
    `uv.lock`、`services/ontology` 的 `pyproject.toml`/`Dockerfile`/`AGENTS.md`；
    CI 加 `setup-uv`（钉版本）、`uv lock --check`、独立 lane；wheel 树与模型权重不进 Git。

---

## 7. 单片切换运行手册（可回滚）

1. **前置**：P0.5 命名硬切已完成，新契约基线已确立；路由与数据所有权已登记；
   契约差异测试绿；影子期无阻断差异。
2. **影子读**：复制读流量到新服务，比较状态码/响应；只读、无副作用。
3. **写冻结**：只冻结该资源（按表/路由），分钟级；公告与超时上限预先设定。
4. **跨库复制**：从 legacy 库复制到目标 database，校验行数、关键校验和；
   重复执行幂等；大表可分批/逻辑复制。
5. **灰度**：Nomad canary（1 个 alloc）健康后 promote；Kong 按 header 或 upstream 权重放量
   （白名单 → 1% → 10% → 50% → 100%）；每档看错误率、P95、对账。
6. **切读适配器**：legacy admin 对该资源的读从旧库切到 owner 服务 gRPC；
   旧库对应表标记只读。
7. **soak**：至少 7 天或覆盖一个完整业务周期；对账 job 每日跑。
8. **删除旧路**：删单体 controller/provider/路由；删对应 ACL 方法；归档旧表。
9. **回滚**：读片随时切回 legacy；写片在首笔新写入前切回，切流并接受写入后按 forward-fix。
   Nomad 侧用 `nomad job revert` 或切回上一个镜像 tag；不承诺反向 ETL；旧库保留到 P9 作为灾备快照。

---

## 8. 测试与验收

- **命名硬切（P0.5）**：旧→新映射表逐项校验；公开路径/operationId/DTO 字段无遗漏；
  旧路径零残留；Luminous 与 admin 从新 OpenAPI 重新生成并通过 e2e。
- **契约基线**：P0.5 的 OpenAPI golden snapshot；每片切换前后对同一 operation 做
  schema/状态码/错误码 diff；CI 阻断基线漂移。
- **影子与差分**：读路径逐字段比较（白名单剔除易变字段）；写路径用对账 job 比较数据库终态。
- **服务边界**：depcruise 规则——服务间只准 `libs/*` 与 proto client；`libs` 不得反向 import `apps`；
  禁止跨服务 Prisma import；扫描裸 SQL/连接串，确保 legacy role 连不上服务库。
- **RabbitMQ**：quorum queue、publisher confirms、手动 ack、prefetch、DLX/DLQ、重放工具；
  重复投递、乱序、broker 抖动、消费者重启、事件桥重启。
- **数据**：跨库复制行数与校验和、重复执行幂等、并发写冻结边界、旧库只读、forward-fix 演练。
- **admin 数据层**：`AdminResource` gRPC 契约的脱敏、软删、limit 上限断言；
  每片切换后 legacy admin 不再读该域旧库。
- **弹性**：每服务模板的验收用例——超时、重试+jitter、熔断、幂等键、DLQ、背压、
  优雅停机、readiness；少一项不算完成。
- **Python（ontology）**：Turbo 多语言任务与 `uv run pytest` 双路通过；`uv lock --check`
  无漂移；ruff/mypy 无新增；镜像按目标架构可构建并加载；契约测试覆盖 `/query`、`/reason`
  的请求/响应形状；`traceparent` 跨语言透传。
- **Nomad/rnacos**：`nomad job validate`/`plan` 无阻断差异；服务经 `libs/discovery`
  注册与订阅成功并随实例增减更新；Nomad 健康检查与 Nacos 心跳同时生效；
  Kong 能按静态 upstream（或同步器）找到实例；canary promote 与 `nomad job revert`
  演练通过；迁移 batch job 失败时服务不更新。
- **服务认证**：service JWT 的签名、`aud`/`scope` 校验、过期、轮换、错误 audience 拒绝；
  actor header 不能替代 service JWT。
- **故障演练**：单服务重启、RabbitMQ 抖动、数据库连接中断、Kong 上游全挂、回滚演练。
- **不做**：进程内↔gRPC 双模长期共存测试（ACL 是临时件，P9 必删）。

---

## 9. 交付物

1. **2 个 ADR**：0024 绞杀者、服务边界与数据所有权；0025 边缘、IPC、多语言构建与部署
   （Nomad + rnacos + Turborepo/uv）。
2. **P0.5 命名映射表**、重命名后的 OpenAPI 与重新生成的 Luminous/admin 客户端。
3. **路由/数据所有权清单** + Kong 配置生成器。
4. **proto** + `libs/contracts` 生成物；共享层只含
   `contracts/observability/api/messaging/config/testing/discovery` 七个包。
5. **7 个领域/支撑服务的 Prisma schema + 独立迁移**（admin BFF 无业务库）；
   `pnpm-workspace.yaml` + `turbo.json` 任务图；`apps/legacy` 标准布局；
   `services/ontology` 的 Python 工程 + `lucent_ontology` 迁移。
6. **服务模板**：弹性契约、RabbitMQ/outbox、service JWT、OTel、健康检查、Dockerfile、CI lane。
7. **影子代理与差异报告**；每片切换/回滚记录。
8. **合并后的 OpenAPI** + 契约 diff 报告。
9. **逐片数据复制脚本与对账报告**；旧库归档脚本。
10. **Nomad jobspec + rnacos 注册中心配置/ACL + `libs/discovery`**；canary promote 与
    `nomad job revert` 发布手册；迁移 batch job 定义。
11. **模块 README** 与 `docs/README.md` 的路径记号更新。
12. **迁移日志**：每阶段追加 `docs/logs/migration-log/YYYY-MM-DD.md`（append-only）。
13. **多语言工具链**：根 `pyproject.toml` + `uv.lock`、Turbo 2.11 多语言任务图、
    `services/ontology` 独立镜像与 CI lane、`uv run pytest` fallback。

---

## 10. 风险登记

| 风险                                            | 等级 | 缓解                                                                          |
| ----------------------------------------------- | ---- | ----------------------------------------------------------------------------- |
| 共存期过长，新旧双栈腐化                        | 高   | 每片有 soak 上限与删除旧路的硬门禁；P9 必须删桥/ACL                           |
| 路由清单与实际 owner 漂移                       | 高   | 清单是事实源；CI 校验 OpenAPI 覆盖与单 owner；Kong 配置由清单生成             |
| 写冻结窗口出问题                                | 高   | 分钟级窗口 + 预演 + 幂等复制 + 首笔写入前回滚演练                             |
| 跨 database 偷读                                | 高   | 独立 role + 连接串隔离 + 裸 SQL 扫描 + 对账                                   |
| 写片切流后无法回滚                              | 高   | 明确 forward-fix 策略；旧库保留快照；高风险片先做只读写 soak                  |
| 事件桥丢事件/重复                               | 高   | RabbitMQ 持久化 + 幂等消费 + 关键写路径 reconciliation job                    |
| RabbitMQ 运维复杂度                             | 中   | quorum queue、DLQ、监控与重放工具；共享 vhost + 每服务独立账号/权限           |
| 服务数量增加导致运维/CI/监控成本上升            | 中   | 7 个域服务分阶段提取；content 可晚提取，audit/telemetry 暂不拆                |
| 通知供应商故障拖垮调用方                        | 中   | notifications 独立、超时/重试/DLQ、熔断与降级；health/insights 异步投递       |
| Nomad 学习与运维成本                            | 中   | 目标是 3 节点小集群；P0 spike 打通注册/发现/发布；本地仍用 Compose            |
| Kong 无法直接消费 Nacos（无 DNS/SRV）           | 中   | P0 用静态 upstream + decK；节点频繁伸缩时上 `deploy/rnacos/` 同步器，不换网关 |
| 状态服务放进 Nomad 导致数据/备份复杂            | 高   | Postgres/Redis/RabbitMQ/VictoriaMetrics/rnacos 外置或托管，不进普通 job       |
| Kong upstream 与 Nacos 实例漂移                 | 中   | 静态 upstream 由 Git/CI 保证；上同步器后把订阅与健康检查纳入 CI 验收          |
| rnacos 注册中心尚无生产先例（现仅用于配置中心） | 中   | 复用已验证的 `nacos-sdk-rust-binding-node`；先做单节点 P0 spike，再按需扩集群 |
| service JWT 密钥轮换/泄露                       | 高   | 非对称密钥、短 TTL、`aud`/`scope` 校验、双密钥轮换窗口、调用方 allowlist      |
| 影子流量泄露 PII                                | 中   | 影子只读、脱敏、内部网络、采样与保留期                                        |
| admin 51 表扇出延迟                             | 高   | `AdminResource` 契约先定；分页与字段白名单在 owner 侧                         |
| P0.5 命名硬切造成全站短暂不可用/旧客户端失效    | 高   | 单次维护窗口 + 客户端同窗口发版 + 预发全量回归；不做兼容层但要留发布检查单    |
| 硬切后仍有人在提取期改名                        | 高   | 命名基线 CI 检查；公开路径/operationId/DTO 字段变更直接阻断                   |
| 契约在迁移中被动漂移                            | 高   | P0.5 golden snapshot + 每片差异测试 + 客户端 e2e                              |
| 共享 libs 重新长成分布式单体                    | 中   | 只允许七个技术共享包；业务代码/Prisma/权限/文案一律留在服务内                 |
| SSE/流式经 Kong                                 | 中   | P0 spike；关闭缓冲、取消传播、背压测试                                        |
| 工具链路径断裂                                  | 中   | P0.5 一次性迁到 apps/legacy；每片 `turbo run check`                           |
| 双工具链（Node + Python）长期维护成本           | 中   | 只保留一个 Python 单元；CI 独立 lane + 路径过滤；依赖更新分别自动化           |
| Turbo 多语言支持仍是 experimental               | 中   | 钉 Turbo 版本；CI 保留 `uv run pytest`/`uv build` 直跑 fallback               |
| Python 依赖/镜像体积膨胀                        | 中   | wheel 树与模型权重不进 Git；多阶段镜像 + 私有 registry + 构建缓存             |

---

## 11. 待裁决点

已裁决：**7 个领域/支撑服务 + admin BFF 的限界划分**（`services/ontology` 为推理支撑件，
不是第 8 个域服务）、
**提取顺序 content → telemetry → medicine → notifications → health → insights → assistant → identity → admin**、
**RabbitMQ**（跨服务，共享 `lucent` vhost + 每服务独立账号/权限）、**BullMQ 保留**（服务内任务）、
**TS 业务服务 + Python 推理服务**（Python 仅 `services/ontology`；LightRAG 外置）、
**Turborepo 2.11 多语言 Task Graph + uv**、**每服务独立 database**、**service JWT**、**根布局 `apps/legacy`**、
**共享层七个包**、**Kong DB 模式 + 独立 `kong` 库（不引入 Konga，配置用 decK + Git）**、
**可观测沿用 VictoriaMetrics 栈**、**部署 Nomad + rnacos（本地 Compose，状态服务外置；
不引入 Consul）**。

仍待定（括号为推荐）：

1. **admin 读路径**：`AdminResource` gRPC 扇出（推荐）vs 事件维护的只读库。
2. **会话吊销**：短 TTL access token + Redis 吊销集合（推荐）vs 全量 introspection。
3. **首片选择**：content 读面（推荐）；product-events 作为第二片，先不并行。
4. **service JWT 签发**：identity 作为内部 IdP、client credentials（推荐）vs 每服务自签。
5. **outbox relay**：轮询 + `FOR UPDATE SKIP LOCKED`（推荐）vs CDC/Debezium。
6. **事件顺序**：只保证 per-aggregate（推荐），不承诺全局有序。
7. **大表复制**：`pg_dump`/批量 copy（推荐）；写冻结超预算时该表改用 logical replication。
8. **mTLS 时点**：本次不做；P9 后随服务网格补 SPIFFE/mTLS（rnacos 本身不提供 mTLS）。

---

## 附录 A — 耦合与工具链盘点摘要

### A.1 跨服务 reader/writer 端口（拆分输入）

| 端口                         | 提供方 → 消费方（拆分后）                                                                       |
| ---------------------------- | ----------------------------------------------------------------------------------------------- |
| `DailyRecordReaderPort`      | health → insights                                                                               |
| `MedicineDoseLogReaderPort`  | health → insights                                                                               |
| `MedicineReminderReaderPort` | health → insights                                                                               |
| `IUserSettingsPort`          | identity → insights、assistant                                                                  |
| `IUserHealthContextReader`   | health → medicine(risk)、insights、assistant                                                    |
| `INotificationSender`        | notifications 提供；identity(auth)、health(reminders)、insights(today-suggestion/analysis) 消费 |
| `IReportSummaryReader`       | insights → assistant                                                                            |
| `MedicineCatalogPort`        | medicine → assistant、health(reminders/risk)                                                    |

### A.2 领域事件矩阵（`src/common/events/domain-events.ts`）

| 事件                                       | 发布方              | 订阅方                                     | 拆分后流向                     |
| ------------------------------------------ | ------------------- | ------------------------------------------ | ------------------------------ |
| `DAILY_RECORD_CHANGED`                     | daily-records       | today-analysis、reports、today-suggestion  | health → insights              |
| `DOSE_LOG_CHANGED`                         | medicine-dose-logs  | 同上                                       | health → insights              |
| `REMINDER_CHANGED`                         | medicine-reminders  | medicines(risk)、reports、today-suggestion | health → medicine、insights    |
| `HEALTH_CONTEXT_CHANGED`                   | user-health-context | medicines(risk)、reports、today-suggestion | health → medicine、insights    |
| `SETTINGS_CHANGED`                         | user-settings       | reports、today-suggestion、assistant       | identity → insights、assistant |
| `HEALTH_EVENT_CHANGED`                     | health-events       | today-analysis、reports、today-suggestion  | health → insights              |
| `TODAY_SUGGESTION_MATERIALIZATION_CHANGED` | today-suggestion    | today-analysis                             | insights → insights（服务内）  |
| `REPORT_SUMMARY_GENERATED`                 | assistant           | insights                                   | assistant → insights           |

### A.3 BullMQ 队列（按服务收口）

`lucent-cron`（保留/生命周期/周报/餐食清扫按服务拆散）、`lucent-reminder-dispatch` → health；
`lucent-mail` → notifications；`lucent-meal-analysis` → health；`data-export` → insights；
`medicine-recognition` → medicine；`today-analysis`、`suggestion-*`、`clinic-summary-pdf` → insights；
`report-summary`（AI 摘要）→ assistant。

以上全部是**服务内** BullMQ 任务/定时队列，不跨服务；跨服务事件一律走 RabbitMQ。

### A.4 现有模块间 import 依赖（71 条边的聚集）

密集/双向簇按 bounded context 重新归属：`reports`/`data-export` → insights；
`reports ↔ assistant` 改为 assistant 单向读 insights，去掉反向调用；`auth ↔ user` → identity；
`admin` → admin BFF；`notifications` → notifications；`product-events` → insights；
`user-settings` → identity；`user-health-context`/`daily-records`/`medicine-dose-logs`/
`medicine-reminders` → health。原先的“共享缝”只说明旧代码耦合，不再作为合并理由。

### A.5 构建面断裂点

按风险排序见 §6。当前最高风险是**路由所有权清单**（`/user` 前缀混合了七个 owner）、
**跨库复制的行数/校验和对账**、**写片切流后的回滚边界**与
**assistant/medicine 的依赖方向**，四者都在 P0 spike/P3/P7 前先验证。
