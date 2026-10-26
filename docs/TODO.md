---
status: active
owner: backend
quadrant: reference
updated: 2026-10-25
---

# Lucent TODO

本文件是唯一 TODO 台账,条目完成即删行。

Last updated: 2026-10-25

This file keeps active backend follow-up items that are intentionally deferred.
Keep durable implementation context in the owning code comments when the TODO is tightly coupled to
one branch or security check, but do not scatter project-level follow-up lists across changelogs or
random docs.

**When a follow-up item is completed:** delete it from this file, and record the completion in
today's `Lucent/docs/logs/migration-log/YYYY-MM-DD.md`(跨仓事项在各自仓库的迁移日志留痕)。

## 端口暴露面：安全组限源是访问控制，不是兜底

`compose.yaml`（主站）、`compose.graph.yaml`（图库机）与 `compose.monitoring.yaml`
（监控机）把服务端口发布到宿主机，
**可达范围由云安全组按来源 IP 白名单决定**。端口发布到 `0.0.0.0` 不等于对全网开放：
把某端口限定到指定 IP 后，其可达性等同于「只有该 IP 能连」，与「仅绑回环 + SSH 隧道」
是同一档的访问控制，区别只在审计面与多一层云厂商依赖。

因此**判断暴露面看安全组放行了谁，不看端口是否发布**；真实 IP 与规则清单属运维信息，
在服务器侧与私有笔记维护，**不入库**（见 `docs/reference/deployment.md`）。

以下为**残余风险**（不是"待收回"清单），按需要收窄：

- **数据库与队列端口**（`5432` postgres / `6379` redis / `7687` neo4j）：口令是唯一
  防线，安全组限源是第二道。redis 的 `--requirepass` 一旦配错就是无口令实例，
  改动后需实测 `redis-cli -a` 能认证、且无口令时被拒。确保只放行运维 IP
  与确实需要对端的来源（如跨机读库的场景）。
- **`8099` semantica**：已补 bearer 鉴权（`API_TOKEN` / `SEMANTICA_API_KEY` 两侧一致），
  属"发布端口 + 鉴权"；`NEO4J_AUTH` 按设计要被同机 sidecar 读到，
  故其口令也落在服务器侧的运行时 env 里，注意文件权限。
- **`9100` node-exporter**：**绝不放行 `0.0.0.0/0`**——它没有内建鉴权。
  监控机与主站分处两机，只能经公网抓取，故安全组只放行监控机的出口 IP。
- **`8848` / `9848` / `10848` rnacos**：控制台（`10848`）是能改运行时行为的入口，
  开 `RNACOS_ENABLE_OPEN_API_AUTH=true` 后仍需按受信来源收口；`8848`/`9848` 只给
  app 与运维用，同样不该对全网开放（详见 `docs/reference/deployment.md`）。
- **监控栈 `8428` / `3001` / `9428` / `10428`**：`10428`（VictoriaTraces）无内建鉴权，
  只放行运维 IP。比放行本机 IP 更严的做法是开 SSH 隧道（端口不必对任何 IP 放行）：
  `ssh -N -L 8428:127.0.0.1:8428 -L 9428:127.0.0.1:9428 root@<监控IP>`。

**无 TLS 是另一个已知缺口**：app 直接以 HTTP 提供入口，`METRICS_*` 与各 sidecar 的
bearer token 在跨云公网上明文过线。补齐方式是域名 + TLS 终止，属独立决策。

条目完成即删行；变更本身记入当日迁移日志。

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
- **模型供应商配额/凭据**：本轮评测中途开始快失败（`rejected our credentials or
exhausted its quota`），词汇规则的复测因此没跑完；评测阶段前先确认配额。

## 2026-09-18 LightRAG 中文散文检索（剩余为评测与生产核对）

剩余为评测与生产侧动作：

- **P2 全量评测（未做）**：当前只有一次 20 条语料的小样本模式验证
  （产物在仓库外的 `lightrag-eval/`），**不足以判断真实规模下图模式是否有增益**；
  社区经验阈值是 500–2000 页文档以上图模式才明显胜出，本项目远超该阈值，
  真正的结论必须来自中大规模重跑，且需补**答案质量**评分（论文证明图模式收益
  体现在端到端答案，而 Lucent 只取上下文、自己生成）。
  **图模式的开关已改为配置驱动**（`LIGHTRAG_GRAPH_SOURCES`，默认 `leaflet`）：
  `leaflet` 现在放行 `local`/`global`/`hybrid`/`mix`，`qa` 仍只接受 `naive`。
  这是把"待验证前的默认"翻转了，**不是评测结论**——P2 全量评测仍未做，
  上面那条判断标准（"图模式显著优于 naive"）依然没有被真正检验。
  **放行前必须先建图**：没建图时图模式拿到的是**空结果而非报错**，
  只有 `coverage.reason` 会说明；索引状态与 `LIGHTRAG_GRAPH_SOURCES` 必须一致。
- **建图成本决策（未决）**：实测约 **10.5 s/chunk**、约 $0.057/doc（抽取侧换
  `deepseek-v4-flash-0731` + 关 thinking + 开 `MAX_ASYNC_LLM` 之后的数字；
  同一口径下改配置前是 61.4 s/chunk，旧文档记的"4 分钟/chunk"已证伪）。
  按 21,142 份说明书估算，全量建图的墙钟与费用**需要单独立项**，不是"顺手跑一下"。
  依据见 `lightrag-eval/PROCESS.md` 与 `lightrag-eval/results/mode-comparison.md` §一、§九。
  **注**：上述 10.5 s/chunk 未计入抽缓存复用。已核实 LightRAG 的抽取缓存键是
  **chunk 内容级**（`utils.py:5244` 的 hash 输入不含 `file_path`，实盘验证同文本必然同键），
  故同一段文本在不同说明书下只抽一次 —— 实测语料 chunk 级重复率 **70.2%**
  （205,454 → 61,207）。方向应是**命中缓存复用抽取结果、但仍按 leaflet 归属完整写入**，
  **不可按 chunk 跳过写入**：跳过会丢掉约 **69,264 条跨药品断言**
  （仅 `validity_period` 一句"24个月"就横跨 7,368 种药品）。详见迁移日志 2026-09-26。
- **`validity_period` 的「暂定」信号已在库内丢失**：2026-09-26 的就地归一化把
  `暂定一年半` 覆盖为 `18个月`，抹平了「厂家未定稿」这层含义（实测 1,491 行）。
  需要该信号时只能回 `DrugDataBase/derived/v3-dedup/leaflets_dedup.parquet` 取。
- **P4 灌 `qa` workspace（脚本就位，未实跑）**：`medical_qa_chunks` 当前 0 行，
  源数据（`DrugDataBase/qa/`）尚未导入。步骤：
  `import-medical-qa.ts --filter` → `pnpm import:lightrag --workspace=qa`。
- **P5 生产核对（未做）**：生产库验证 sidecar 可达、`/query` 鉴权生效
  （注意 `/health` 不校验鉴权，不能用来判断 key 是否配对）与 workspace 命中。
- **workspace 隔离（已知限制，不做）**：上游 #2527 确认单实例仅支持单
  workspace，实测 `LIGHTRAG-WORKSPACE` 头不改变实际读写位置。因此同实例上
  `leaflet` 与 `qa` 共享一个命名空间，靠 doc id 前缀区分；需要物理隔离要另起
  实例。已在 assistant README / env 文档 / deployment 记录。
- **待定**：工具名 `search_cn_medicine_knowledge` 如需改名，在评测前定。

`VectorStoreFactory` 与 `ASSISTANT_VECTOR_*` **不删**：`search_drugbank_passages`（英文侧）
走 Lucent 自己的 pgvector 表，与 LightRAG 无关。

## 2026-09-11 文件上传链路遗留（上传链路收敛时发现）

### 对象存储缺少删除/生命周期能力（P3）

`POST /api/v1/user/files/upload` 只签发预签名上传凭证，`/user/files` 下没有删除端点：用户上传
头像/附件后放弃保存、或替换旧头像，对象会永久留在 bucket 里。方案：增加对象删除能力（或将
`{prefix}/{userId}/…` 前缀 + 时间的生命周期回收策略交给存储后端），并在 Luminous 的
「替换/移除」路径调用。验收：替换头像后旧对象可被回收，且用户无法借删除端点触达他人对象
（沿用各资源端点「跨用户访问 → 404」的 e2e 约定）。对侧登记见 Luminous `docs/TODO.md`。

## 后续可做

### 按管理面契约重生成 Luminous 客户端（2026-10-19，管理面扩展收尾）

管理面扩展新增/调整了 `/api/v1/admin/*`（QA 语料、漏斗指标、依赖状态、数据/用户/管理员 API），
`docs/reference/generated/openapi.json` 已随代码更新，但 Luminous 侧尚未按新契约重跑其 Flutter 契约引导脚本（在 Luminous 仓库内执行）。这些端点是控制台专用，C 端目前无消费方，
故按计划决策顺延；下次 Luminous 契约同步时一并重生成，验收:重生成后 Luminous 侧 `flutter analyze` 通过,
且生成物与 Lucent 的 openapi 快照无差异。

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

`HealthEventsOwnershipService` 为模块外消费方（reports / medicine-dose-logs /
daily-records）保留 legacy `Promise<T>` 契约，内部用 `unwrapResult` 折叠模块自身的
`ResultAsync`，抛出的 `DomainFailureException` 由全局过滤器转成 Problem Details。
三个消费方各自把 Promise 折回 Result（daily-records 的 `requireActiveHealthEvent`）
或直接 rethrow（medicine-dose-logs 的 `fromPromise`），属过渡形态。

验收：消费方改为直接消费 events 的 `Result` 后，删除该 shim 与三处 `TODO(error)`
折叠代码（`services/ownership.service.ts`、`daily-records/services/records.service.ts`、
`medicine-dose-logs/services/dose-logs.service.ts`）。

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

### F3：CI lint 作业并行化（P3，2026-08-30 审查 Suggestion）

oxlint 落地稳定后，将 `ci.yml` lint-typecheck 作业中的 `lint:oxlint` 与
`typecheck`/`typecheck:tools` 并行（独立 step 或 matrix），缩短 CI 时长；当前串行稳妥但低效。

### B2：环境数据接入真实天气 API（P3）

静态环境数据已标注 `dataSource: 'static'`（`src/modules/environment/config/reference.ts`）。
v1.1.0 接入真实天气/空气质量 API（和风天气/彩云天气等），替换 6 个区域静态配置文件。

### B3：多实例限流验证（P3）

`ThrottlerConfigService` 已实现 Redis-backed 限流存储（`REDIS_URL` 存在时启用）。
v2.0.0 水平扩展时需验证多实例限流计数器在 Redis 中的正确性。

### B4：账户删除级联清理（P3）

`DataRetentionService` 已实现 `@Cron` 清理管道（过期会话/通知/反馈抑制）和软删除账户 30 天后硬删除。
仍缺：账户删除流程增加匿名化数据导出 → 数据可移植性 JSON 导出（GDPR/PIPL 合规）。

### ESM 遗留 CJS 依赖与互操作跟踪（2026-09-03，NestJS 12 升级第二步）

ESM 化后遗留清单与后续跟进：

- `@prisma/internals`：named `getDMMF` 无法经 cjs-module-lexer 识别（动态重导出），`prisma-module.service.ts`
  以动态 import + default/具名回退装载。上游发布 ESM 版本后改回裸 named import。
- 两处 PDF 服务用 `createRequire(import.meta.url).resolve` 解析 `@fontpkg/*` 字体资产路径（ESM 无
  `require.resolve`），属惯用法保留。
- `cos-nodejs-sdk-v5`（default import）当前互操作正常，无需改动；若上游导出形态变化，
  按计划口径复核。

### @nestjs/throttler 与 nest-winston 的 ^12 peer 跟进（2026-09-02，NestJS 12 升级第一步）

`@nestjs/throttler@6.5.0`（npm latest）与 `nest-winston@1.10.2` 的 peerDependencies 尚未纳入
`@nestjs/* ^12`（上限 ^11）。pnpm 安装产生 peer 告警但不阻断；框架升级后 e2e 全量运行时行为已验证正常
（rate-limiting 套件与日志链路通过）。上游扩 peer 或发新 major 后升级以消除告警；若长期不更新，
评估替代方案或 fork peer 声明。

### 高级可观测性进阶项

基础可观测性（Prometheus metrics + Grafana dashboards + LLM/BullMQ 指标 + Alertmanager 告警规则 + OpenTelemetry 分布式追踪：`src/tracing.ts`、`trace-context.utils.ts`、base-llm-generator 集成）之外的进阶项：

- 添加 synthetic uptime monitoring

### 药物结构式 2D 可视化

`drugbank_structures` 已入库并随详情下发（SMILES / InChI / 分子式 / 分子量 / pKa /
类药性规则等），前端以文本 + 复制呈现。2D 结构式图形渲染未做：Flutter 生态无成熟
的 SMILES 出图包，且 `structures.sdf` 为纯 2D（z 恒为 0），没有构象数据可消费。
若将来要出图，需先引入/自研 SMILES 布局渲染，并评估移动端渲染成本。

### 响应侧 Standard Schema 序列化的未竟事项（2026-09-03，NestJS 12 计划收尾）

响应侧 zod + `StandardSchemaSerializerInterceptor` 已全量落地并闸门绿，以下边角留待后续：

- 201/202 主成功响应在 export 期已回写 `$ref`；若新端点引入其他非 200 成功码语义，需在导出
  脚本的成功码回写列表同步扩展（现 200→201→202）。
- `@SerializeOptions` 未被 Swagger 自省,响应组件靠 export 期注册表注入;注册路径必须与导出
  operation 逐字一致(含 RouterModule 前缀与 `{…}` 参数),不一致导出会显式报错——新增模块照此约定。
- SSE/text 流端点不注册响应组件(非 JSON 200),如需结构化 `event: error` 语义遵循 ADR-0012/0017。

### 半衰期感知的漏服提示接入（2026-10-24，领域逻辑已就绪，链路未接）

`domain/services/half-life.ts` 与 `half-life-gap.ts` 已落地并测试（解析在真实数据上覆盖
76/78 条），但**尚未接进提示链路**：`today-suggestion` 的 `missed_dose_pending` 规则
仍按「到点没吃就提醒」的固定时长逻辑运行。

**为什么值得接**：同一条固定时长规则在两类药上说反话——半衰期 3 小时的药漏 6 小时
（两个半衰期，浓度掉到 25%）该提醒；半衰期 102 小时的依那西普（Etanercept）漏 6 小时
浓度几乎没动，提醒只制造焦虑。判定依据应是「缺口占半衰期的比例」。

**接入需要三件事**：

1. `missed_dose_pending` 规则读药品的 `half_life` 并经 `evaluateHalfLifeGap` 判定
   （返回 `noData` 时保持原有逻辑，不要变激进或变保守）；
2. 新增「每药每日已提示」的持久化（迁移 + 表），用于 `half-life-gap.ts` 的每日上限——
   当前领域函数接受 `lastNotifiedAt` 参数，但没有任何地方存它；
3. 药品与 `half_life` 的关联：`UserCurrentMedicine` → DrugBank 详情。
   ⚠️ 前提：本机 dev 的 `drugbank_drugs` 只有 78 条有 `half_life`（全表 100 条药），
   见下方「Prisma 药品知识库回填」——不先补数据，接入后绝大多数药会落到 `noData`。

**验收**：半衰期 3 小时的药漏 2 个半衰期会提示、同一药一天只提示一次；半衰期 102 小时的
药同样缺口不提示；`half_life` 缺失的药行为与接入前完全一致。

### Prisma 药品知识库回填（2026-10-24，独立工作，不阻塞图查询）

本机 dev 库（`127.0.0.1:15432/lucent`）实测与应有规模差距很大：
`drugbank_drugs` 100/19,842、`drugbank_targets` 0、`drugbank_drug_targets` 0、
`drugbank_structures` 0、`cn_medicine_products` 0、`medical_qa_chunks` 0。

**这不影响图查询**：关系数据在 Neo4j（3,278 节点 / 211,630 边，`lucent-neo4j` 容器 +
`lucent-neo4j-data` 卷），语义上覆盖了靶点/酶/转运体关系。受影响的只有 **Lucent 自己的
药品详情接口**（`GET /api/v1/medicines/:id` 的 `targets`/`structure` 等字段）与上面那条
半衰期接入。

**待查**：是尚未导入，还是导入过但这份 dev 库被重建过。两种情况处置不同——后者要先
定位数据丢在哪一环，否则导入完还会再丢。源数据在
`DrugDataBase/derived/drugbank/drugbank_drugs.parquet`（124.8 MB），导入脚本
`scripts/import/medicine/import-medicine-knowledge.ts` 在。

**顺带修正**：`Luminary/apps/lumine/PRODUCT.md` §二 称 `enzymes`（1,871 条）「已导入」，
但 `prisma/models/medicine-knowledge.prisma` 里**没有 enzymes 列**——这类关系只存在于
Neo4j。该文档需更正，避免下一个人按它去找字段。

### 剂量日志槽位唯一性缺失：`mark` 的幂等只是「通常成立」（2026-10-25，四层迁移补测试时发现）

`POST /medicine-dose-logs/mark` 的契约是「同一槽位幂等」，实现是 **find-then-create**
（`findBySlot` → 命中则 `update`，否则 `create`），**但表上没有任何覆盖槽位的唯一约束兜底**，
并发下同一槽位会写入两行。

已核对（非推测）：

- `prisma/models/medicine-user.prisma` 的 `UserMedicineDoseLog` 只有 5 个 `@@index`，
  无 `@@unique`；4 个涉及该表的 migration 里 `UNIQUE` 命中为 0；
- 连 **dev（15432）与 test（5432）两个库**查 `pg_indexes`：该表唯一索引只有主键
  `user_medicine_dose_logs_pkey`，槽位相关索引全是普通索引；
- `git log --all -S` 查无任何分支曾加过该约束——**这是既有缺陷，不是四层迁移引入的**。

**连带问题**：controller 上 `POST /medicine-dose-logs` 与 `/mark` 的
`@ApiResponse({ status: 409, description: 'Duplicate dose log for the same slot
(RESOURCE_CONFLICT, race)' })` 是**假声明**——没有唯一约束，P2002 永远不会由槽位重复触发
（`create` 的 P2002→`RESOURCE_CONFLICT` 映射本身正确，但只可能来自别的约束）。

**修法（三件事要一起做，缺一不可）**：

1. 加**部分**唯一索引，只约束未软删的行，让「软删后重标记」仍然可行：

   ```sql
   CREATE UNIQUE INDEX user_medicine_dose_logs_slot_uniq
     ON user_medicine_dose_logs (user_id, reminder_id, scheduled_for, scheduled_time)
     WHERE deleted_at IS NULL;
   ```

   注意 `scheduled_time` 可为 NULL、`reminder_id` 可为 NULL（临时日志）——需确认 Postgres
   对 NULL 的处理符合预期，必要时拆成两条索引或改用 `COALESCE` 表达式索引。

2. `mark` 的 find-then-create 改成 `upsert`（或 `create` + 捕获 P2002 后重试成 `update`）。
   **只加约束不改写路径的话，并发只是把「两行」变成「500」**，并没有修好幂等。
3. 删除或更正上述两条 409 文档声明。

**前置**：加约束前要查存量重复数据（同一 user+槽位多行未删），否则 migration 会失败；
`prisma/models/**` 变更需同步 `pnpm export:openapi`（409 文案若改动）。

## 管理控制台遗留（2026-10-07，控制台校验与首次上线时发现）

- **favicon 仍是上游模板图片**：`admin/index.html` 的标题与 OG/Twitter 卡片已改为 Lucent
  自己的元数据，但四个 favicon 引用仍是模板自带的 `admin/public/images/favicon*.{svg,png}`
  （上游 shadcn-admin 图形）。替换需要一套 Lucent 图标资产（多尺寸 + 亮/暗两版），
  留待有正式视觉资产时统一处理。

## DDD 四层迁移收尾遗留（2026-10-25）

六条轨道合并后 `typecheck` / `lint` / `arch:check` / 单测 / e2e 全绿，以下是这轮
刻意未做的项，按需处理：

### 小体量 supporting 模块不迁四层（口径决定，非遗漏）

`audit-log`(174 行) / `data-retention`(174) / `app-info`(99) / `environment`(415) /
`legal-documents`(476) 保持现状。理由：为 99 行的模块造 `domain/` + `application/` +
`adapters/` 骨架，骨架比代码长；ADR-0024 自己写了「不为 CRUD 硬造富领域模型」。
等它们长大（出现真实领域规则或跨上下文契约）再拆。

### reports / today-analysis 未迁四层，user 处于半拆状态（2026-10-26 核查发现）

上一节的收尾口径只记了「小模块不迁」，**遗漏了剩余最大的两块**：`reports`
(6,875 行) 与 `today-analysis`(3,099 行) 仍是 `controller → services → Prisma`。
另有 `user`(293 行) 有 `application/` + `infrastructure/` 却缺 `domain/` 与
`adapters/` 的**半拆状态**——比完全没迁更容易误导后来人。

执行源：`plans/2026-10-26-ddd-migration-completion.md`（§二 / §三 / §四.3）。
该计划执行完毕时，连同本条一起删除。

### `domain-events-outbox.service.ts` 的 `tx` 参数

`append(input, tx?: Prisma.TransactionClient)` 把 Prisma 事务客户端暴露在
`src/common/**` 的公开签名上。改成端口等于重新定义 ADR-0025 的事务边界，且所有
`append(event, tx)` 调用点都要跟着改——**必须先定 6 个生产模块的事务边界**，
否则只是把中间层改得更难懂。ADR-0025 已把「append 不在生产者写事务内」记为
未达成项，两者要一起解决。

### `product-events` 的 `FunnelData` 形状镜像

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
`kind`/`date`/`rangeKey`/`scopeKey`，因为 `reports` 与 `today-analysis` 两个消费方
仍在传扁平形态。版本栅栏已在领域里判，双形态不造成正确性问题；收干净要改那两个
模块的 4 处调用。
