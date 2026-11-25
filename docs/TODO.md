---
status: active
owner: backend
quadrant: reference
updated: 2026-11-25
---

# Lucent TODO

本文件是唯一 TODO 台账,条目完成即删行。

Last updated: 2026-11-25

This file keeps active backend follow-up items that are intentionally deferred.
Keep durable implementation context in the owning code comments when the TODO is tightly coupled to
one branch or security check, but do not scatter project-level follow-up lists across changelogs or
random docs.

**When a follow-up item is completed:** delete it from this file, and record the completion in
today's `Lucent/docs/logs/migration-log/YYYY-MM-DD.md`(跨仓事项在各自仓库的迁移日志留痕)。

## 2026-10-19 rnacos 运行时配置中心（部署侧遗留）

- **rnacos 的访问日志明文记录控制台口令**：绑定 SDK 走
  `POST /nacos/v1/auth/login?username=…&password=…`（鉴权开关关掉也一样登录），
  rnacos 的 actix 访问日志把整条 URL 打进 stdout。本机 v0.8.7 实测：
  `RNACOS_LOG_LEVEL`（大小写都试过）无效，镜像里也没有日志配置文件可改。
  容器 stdout 一旦进日志栈，口令就随访问日志扩散。缓解方向（未裁决，属部署面）：
  在采集侧过滤 `/nacos/v1/auth/login` 行，或把控制台口令与其它系统彻底解耦并定期轮换，
  或给 rnacos 自带日志单独挂轮转与访问控制。安全组限源不消除这条。
- **启用但中心不在线时，启动被阻塞构造拖慢**：binding 的 `new NacosConfigClient(...)`
  是同步阻塞调用（实测无缓存约 19s、有缓存约 38s），`RNACOS_REQUEST_TIMEOUT_MS` 管不到
  它，而它跑在 `onApplicationBootstrap` 里。待裁决方向：把首次加载挪到监听端口之后
  （启动先走 env 基线，值到了再叠加）或放进 worker 线程隔离，二者都换来额外复杂度；
  当前实现按「一次告警 + 沿用基线/缓存」处理，未做上述隔离。

## 2026-09-19 英文侧 OAG（Semantica）剩余项

决策见 `docs/reference/adr/0021-semantica-english-side-oag.md`，代码相邻的约束与非目标见
`src/modules/assistant/README.md`（英文侧 OAG 小节）。尚未闭环的条目：

- **导出阶段的读取不受推理预算约束**：`REASONING_TIMEOUT_S` 覆盖不动点推理，不覆盖
  `load_from_graph` 的导出读取。导出侧已从 57s 降到 12.7s（50,000 边），但在更小的
  调用方预算下仍可能击穿超时预期（依据见 `semantica-oag-pilot/CORRECTIONS-r3.md`）。
  **注**：Neo4j 迁移已完成（见 `plans/README.md` 所述删除的计划与 ADR-0022），
  P4 已把三条推理规则改写为 Cypher 并删除 Oxigraph 接线；但"导出侧读取"路径
  **仍在**（`/reason` 之外仍有导出路径），故本条**依然成立**，未随迁移消失。

## 2026-09-18 LightRAG 中文散文检索（剩余为生产核对）

剩余为生产侧动作：

- **`validity_period` 的「暂定」信号已在库内丢失**：2026-09-26 的就地归一化把
  `暂定一年半` 覆盖为 `18个月`，抹平了「厂家未定稿」这层含义（实测 1,491 行）。
  需要该信号时只能回 `DrugDataBase/derived/v3-dedup/leaflets_dedup.parquet` 取。
- **workspace 隔离（已知限制，不做）**：上游 #2527 确认单实例仅支持单
  workspace，实测 `LIGHTRAG-WORKSPACE` 头不改变实际读写位置。因此同实例上
  `leaflet` 与 `qa` 共享一个命名空间，靠 doc id 前缀区分；需要物理隔离要另起
  实例。已在 assistant README / env 文档 / deployment 记录。

`VectorStoreFactory` 与 `ASSISTANT_VECTOR_*` **不删**：`search_drugbank`（英文侧）
走 Lucent 自己的 pgvector 表，与 LightRAG 无关。

## 2026-09-11 文件上传链路遗留（上传链路收敛时发现）

### 对象存储缺少删除/生命周期能力（P3）

`POST /api/v1/user/files/upload` 只签发预签名上传凭证，`/user/files` 下没有删除端点：用户上传
头像/附件后放弃保存、或替换旧头像，对象会永久留在 bucket 里。方案：增加对象删除能力（或将
`{prefix}/{userId}/…` 前缀 + 时间的生命周期回收策略交给存储后端），并在 Luminous 的
「替换/移除」路径调用。验收：替换头像后旧对象可被回收，且用户无法借删除端点触达他人对象
（沿用各资源端点「跨用户访问 → 404」的 e2e 约定）。对侧登记见 Luminous `docs/TODO.md`。

## 后续可做

### 深链域名与 App Link 校验文件的部署（2026-10-16，Luminous 深链接入时发现）

Luminous 的 App Link 走 `android:autoVerify="true"` + iOS `applinks:`，两端都要求服务端
在域名根下提供校验文件，否则系统会拒绝 App Link、只能退回自定义 scheme：

- `https://<域名>/.well-known/assetlinks.json`（Android，需 `package_name` +
  release keystore 的 SHA-256 指纹）
- `https://<域名>/.well-known/apple-app-site-association`（iOS，需 Team ID + Bundle ID）

**域名尚未确定**：Luminous 侧把 host/scheme 全部做成了配置占位
（`LUMINOUS_DEEP_LINK_HOST` / `LUMINOUS_DEEP_LINK_SCHEME`、Android manifestPlaceholders、
iOS `DeepLink.xcconfig`），未硬编码任何域名。域名定下来后需在此侧部署两个校验文件，
并把该 origin 加入 `CORS_ORIGIN`（`AuthOAuthStateService.isTrustedOrigin` 用它校验
OAuth callbackUri）。验收：`adb shell pm get-app-links <pkg>` 显示 `verified`，
且真机点开 `https://<域名>/login/oauth/qq?code=&state=` 能进 app。对侧登记见 Luminous
`docs/TODO.md`。

### OAuth callbackUri 放行移动端自定义 scheme（2026-10-16，Luminous 内嵌 WebView 接入时发现）

`AuthOAuthStateService.normalizeCallbackUri` 目前只接受两类 `callbackUri`：loopback `http`
带端口，或 `https` + CORS 白名单 origin + 固定 provider 回调路径（`/login/oauth/{wechat,qq,google}`）。
Luminous 移动端新增「应用内 WebView 授权」后，两条路都能走通：loopback 模式已在桌面端验证，
移动端也可用站点 origin 的 https 回调地址。**但两者都不是移动端最优解**——loopback 需要
在设备上起本地 HTTP server，https 站点回调则依赖 WebView 拦截到该地址后不再真正请求。

若要让移动端用自定义 scheme（如 `app-scheme://login/oauth/qq`）直接回跳，需要在
`normalizeCallbackUri` 增加一条 scheme 白名单分支，并在 `CORS_ORIGIN` 之外引入独立的
允许 scheme 配置项。验收：白名单内 scheme 通过、白名单外一律 `VALIDATION_FAILED`，
且 `/login/oauth/*` 路径约束仍然生效（防开放重定向）。对侧登记见 Luminous
`docs/TODO.md`。

### health-events ownership shim 的移除

`HealthEventsOwnershipService` 为模块外消费方（reports / dose /
record）保留 legacy `Promise<T>` 契约，内部用 `unwrapResult` 折叠模块自身的
`ResultAsync`，抛出的 `DomainFailureException` 由全局过滤器转成 Problem Details。
三个消费方各自把 Promise 折回 Result（record 的 `requireActiveHealthEvent`）
或直接 rethrow（dose 的 `fromPromise`），属过渡形态。

验收：消费方改为直接消费 events 的 `Result` 后，删除该 shim 与三处 `TODO(error)`
折叠代码（`services/ownership.service.ts`、`record/services/records.service.ts`、
`dose/services/dose-logs.service.ts`）。

### D1：dead-code 端点台账（2026-09-18，09-17 审查 S3）

`GET /api/v1/medicines/safety-tips` 接口完整但当前无任何 C 端 UI 消费方
（死代码保留：i18n、cache、安全过滤等基础设施已搭好）。若未来做随机安全贴士，
应在移动端药品详情页内以审核内容卡片形式重做。代码侧仅留单行
`// Dead-code endpoint (no C-end consumer); see docs/TODO.md.` 引用
（`adapters/http/medicines.controller.ts` 与
`application/use_cases/medicines.ts` 各一处）。

### B7：餐食分析 v1 历史记录的展示回填（P3，2026-09-15 五日审查 P3）

餐食分析 v2 重构后，迁移前已分析的餐食记录在客户端不再显示分析结果：v1→v2 新增的热列
（状态/标题/热量/revision）在旧行上全是默认值，读路径按「没有分析」处理；`version: 2` 的
schema 校验又会让 v1 的 `mealAnalysis` 被判为形状不匹配并置 null（`types/meal-analysis.types.ts`
头注释记了完整表现与「不做回填」的理由）。当前不打算回填——v1 的自由形状 `mealInput` 与人工确认
快照，和 v2 的一次多模态直出模型没有可靠映射，猜出来的结论比「没有结论」更糟。

验收：若产品要求旧记录可见，方案是**重新分析**（用户对该记录点一次「重新分析」即得 v2 数据）
而非数据迁移；需要时把这条口径写进对用户可见的说明。

### F1：ReportTrendDto.values 的 legacyValues 迁移窗口（P3，2026-08-30 审查 W-1-legacy）

考虑为 `ReportTrendDto` 增加废弃的 `legacyValues` 字段（补零、与日期窗口对齐）给前端一个迁移窗口
（`src/modules/reports/application/read_models/dashboard/report-dashboard-response.ts`，DTO 内仅留一行指针注释）。
R-4 路线图清理完成时裁决去留：若 Luminous 已全面切换 `observedMetric` 对齐则直接放弃，不再实现。

### F2：Port 接口规范集中化（P3，2026-08-30 审查 Suggestion）

4 个跨模块 port（`INotificationSender`/`IUserSettingsPort`/`IUserHealthContextReader`/
`IReportSummaryReader`）的命名与 useExisting 约定在各 port 文件 JSDoc 里各写一遍，知识散落。
`docs/explanation/` 只减不增且 architecture.md 已瘦身，不新增小节；候选去向：AST 约定检查
（`scripts/arch/check-ast-conventions.ts` 新增 C3 规则）或新 ADR，逐项评估后择一落地。

### B3：多实例限流验证（P3）

`ThrottlerConfigService` 已实现 Redis-backed 限流存储（`REDIS_URL` 存在时启用）。
v2.0.0 水平扩展时需验证多实例限流计数器在 Redis 中的正确性。

### B4：账户删除级联清理（P3）

`DataRetentionService` 已实现 `@Cron` 清理管道（过期会话/通知/反馈抑制）和软删除账户 30 天后硬删除。
仍缺：账户删除流程增加匿名化数据导出 → 数据可移植性 JSON 导出（GDPR/PIPL 合规）。

### 高级可观测性进阶项

基础可观测性（Prometheus metrics + Grafana dashboards + LLM/BullMQ 指标 + Alertmanager 告警规则 + OpenTelemetry 分布式追踪：`src/tracing.ts`、`trace-context.utils.ts`、base-llm-generator 集成）之外的进阶项：

- 添加 synthetic uptime monitoring

### 药物结构式 2D 可视化

`drugbank_structures` 已入库并随详情下发（SMILES / InChI / 分子式 / 分子量 / pKa /
类药性规则等），前端以文本 + 复制呈现。2D 结构式图形渲染未做：Flutter 生态无成熟
的 SMILES 出图包，且 `structures.sdf` 为纯 2D（z 恒为 0），没有构象数据可消费。
若将来要出图，需先引入/自研 SMILES 布局渲染，并评估移动端渲染成本。

## DDD 四层迁移收尾遗留（2026-10-25）

六条轨道合并后 `typecheck` / `lint` / `arch:check` / 单测 / e2e 全绿，以下是这轮
刻意未做的项，按需处理：

### `domain-events-outbox.service.ts` 的 `tx` 参数

`append(input, tx?: Prisma.TransactionClient)` 仍把 Prisma 事务客户端暴露在
`src/common/**` 的公开签名上。E0（2026-11-16）已通过 `transaction-scope.ts` 的
ambient scope 让调用方**不必**传它——正常路径下 `tx` 参数已无人使用，只剩下
向后兼容的位置。收掉它需要确认没有外部调用点后再删参数；不急着做，因为当前
签名不造成正确性问题。

### `product` 的 `FunnelData` 形状镜像

`application/commands/` 与 `adapters/http/dto/` 各有一份形状定义（`application → adapters`
被 arch 规则禁止）。已由 `adapters/http/dto/product-event-mirror.spec.ts` 的双向
`expectTypeOf` 钉住，任一侧加字段/改可空性都会编译失败。若将来想根除重复，
需要把 schema 移到中立位置——那要改架构规则，目前不值得。

### `assistant` 的跨层集成 spec

`adapters/acl/tools/retrieval/knowledge.service.spec.ts` 直接构造真实
`LightragClientService` 当集成替身，保留 1 条既有的 `ddd-adapters-no-infrastructure`。
它测的是「adapter 的校验/映射 + infrastructure 的响应解析」两层互相印证，
拆成两个 spec 会丢失这个验证点。策略逻辑已由 `knowledge-policy.spec.ts` 覆盖，
传输逻辑由 `lightrag-client.service.spec.ts` 覆盖，**这条留作端到端接线**。

### `SummaryWrite` 接受两种形状

`domain/summary/summaries.ts` 的 `SummaryWrite` 同时接受 `scope`（域形态）和扁平的
`kind`/`date`/`rangeKey`/`scopeKey`，因为 `reports` 与 `analysis` 两个消费方
仍在传扁平形态。版本栅栏已在领域里判，双形态不造成正确性问题；收干净要改那两个
模块的 4 处调用。

## RabbitMQ 跨服务事件通道（2026-11-16，通道已建、未接入）

连接、durable topic exchange 与 confirm 发布器已落地并通过真实 broker 验证
（`src/common/events/rabbitmq-*.service.ts`），但**目前没有任何消息经过它**：
`RabbitMqModule` 已声明，无模块 import。以下是接通前的必要项。

### Step 2：outbox 扇出增加 AMQP 通道

`DomainEventFanOutService` 现在只把 outbox 行转成 BullMQ job 或进程内调用。
需要让 `subscriptions.ts` 的订阅可以声明 `transport: 'queue' | 'amqp'`，逐消费者
切换，并保留双投递期以便回滚。切换前必须先明确「哪些事件属于跨服务」——
消费方仍在同一进程时走 AMQP 只是多一跳。

### 消费侧幂等尚未实现

投递是至少一次（confirm 超时可重投），每个 job 带 `eventId`，但**还没有任何消费者
持久化已处理的 `eventId`**。第一个跨服务消费者落地时必须同时实现去重存储，
否则重复投递会产生重复副作用。各消费者对「已处理」的定义与保留期不同，
不做公共去重表。

### quorum queue / DLQ / 重放工具未做

当前只声明了 exchange，未声明任何队列。接入消费者时需要：quorum queue、
每队列 DLX/DLQ 隔离毒消息、以及查看/重放/丢弃积压的工具。发布侧已开 confirms，
消费侧的失败语义还是空白。

## deepagents 灰度收尾（2026-11-18 登记，2026-11-22 收缩）

`ASSISTANT_AGENT_RUNTIME`（默认 `graph`）已接通：`runtime.ts` 按轮分流，deepagents
路径失败自动回落 graph。checkpointer、提案 interrupt、用户级开关已于 2026-11-22 补齐
（见当日迁移日志），剩余项：

- 真实模型端到端（子智能体实际被委派并返回）未验证：需要模型凭据。
- 灰度放量后观察 tool 轮数与 token 变化，再考虑把默认值切到 `deepagents`。

背景事实（接线时已按此落地）：

- **流式形状不同**：`graph.ts` 通过 `onText` 逐块推送；deepagents 拥有自己的 run
  loop 与 `messages`/`files` 状态。SSE 契约（`chunk`→`result`→`done`）必须保持不变。
- **两套 thread 命名空间**：graph 用裸 `conversationId`，deepagents 用
  `deep-{conversationId}`。共用一个 id 会让两份不同形状的状态互相覆盖。

## assistant 沙箱缺失（2026-11-22，原计划 §6.3 的明确取舍）

`LocalShellBackend` 是**无 confinement 的宿主 shell**，它的原文把「web servers, APIs,
multi-tenant」列为不适用场景，而 assistant 正是这一类。三大模式的沙箱
（`read-only` / `workspace-write` / `danger-full-access`）**没有实现**。

已做的两件事（零成本、消除不需要攻击者就会发生的失败）：每会话独立 cwd
（否则 `pwd` 是仓库根，`.env.development` 与源码都在那儿）、环境变量清洗
（`/KEY|PASSWORD|SECRET|TOKEN|CREDENTIAL|URL|DSN|CONN/i` 与 `DSH_*`）。
注意 `virtualMode: true` **只约束文件工具，不约束 shell 命令**——两道理应分开。

**真正隔离需要每会话一个容器**（独立命名空间、无网络、只挂临时卷），那是独立的基础设施
改动，不是本模块能长出来的一层围栏。验收：shell 默认只能读；写只能落 workspace；
越界被拒绝且以结果事实呈现，升级需要一句话理由；无 runner 时报错而不是静默直跑。

## OnSIDES 不良反应遗留（2026-11-25，原计划两阶段均已落地）

数据导入与查询端点都已上线（`onsides_*` 两张表、三个读端点、`import:onsides*`）。
下面两项**未做**，不是漏掉：

- **全量导入。** 当前 dev 库只有 200 行源数据的样量（142 个配对）。全量是 693 万行源行、
  聚合后落库行数远小于此。跑之前确认 `DrugDataBase/raw/onsides/v3.1.1/csv/` 就位，
  顺序必须是 `onsides-reactions` → `onsides-effects`（事实表对字典有外键）。
- **客户端接线与 CI 契约同步。** 三个端点已进 `openapi.json`，但 Luminous 尚未
  `bootstrap.dart` 重生成（Flutter 客户端本来就还没接这个源），Lumine 也未 `pnpm contract`。
  **注意**：11-24 的模块短名改名让接口路径发生破坏性变更，客户端重生成应与那批一起做，
  不要只为本功能单独跑一次。

另有一条**口径**必须延续：`labelCount` 是「多少份说明书这样声称」，不是发病率/频次；
`confidenceMax` 取 `pred1` 而非 `pred0`（后者 44.5% 为零、36% 大于 1）。
