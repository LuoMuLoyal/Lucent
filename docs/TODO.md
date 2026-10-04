---
status: active
owner: backend
quadrant: reference
updated: 2026-10-04
---

# Lucent TODO

本文件是唯一 TODO 台账,条目完成即删行。

Last updated: 2026-10-04

This file keeps active backend follow-up items that are intentionally deferred.
Keep durable implementation context in the owning code comments when the TODO is tightly coupled to
one branch or security check, but do not scatter project-level follow-up lists across changelogs or
random docs.

**When a follow-up item is completed:** delete it from this file, and record the completion in
today's `Lucent/docs/logs/migration-log/YYYY-MM-DD.md`(跨仓事项在各自仓库的迁移日志留痕)。

## 端口暴露面：安全组限源是访问控制，不是兜底

`compose.yaml`（主站）与 `compose.monitoring.yaml`（监控机）把服务端口发布到宿主机，
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
- **监控栈 `8428` / `3001` / `9428` / `10428`**：`10428`（VictoriaTraces）无内建鉴权，
  只放行运维 IP。比放行本机 IP 更严的做法是开 SSH 隧道（端口不必对任何 IP 放行）：
  `ssh -N -L 8428:127.0.0.1:8428 -L 9428:127.0.0.1:9428 root@<监控IP>`。

**无 TLS 是另一个已知缺口**：app 直接以 HTTP 提供入口，`METRICS_*` 与各 sidecar 的
bearer token 在跨云公网上明文过线。补齐方式是域名 + TLS 终止，属独立决策。

条目完成即删行；变更本身记入当日迁移日志。

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

## 文档治理观察期(2026-08-31,来源:doc-governance-overhaul 计划,文件已删)

### G3:CI 增加 openapi.json 一致性 diff 校验

ci.yml 现仅在 E2E 前重导出 spec 供契约测试;增加
`git diff --exit-code docs/reference/generated/openapi.json` 步骤,使"代码已改但忘记提交
重导出产物"在 CI 失败(README 的 CI 叙述已按此写,补齐实现)。

### G4:契约-代码差异清单(Phase 0 审计遗留)

逐项裁决实现或从契约/文档移除:user-settings `waterTargetCount` 契约缺失;
environment 为简化实现(静态数据,关联 B2);`GET /environment/advice` 未实现;
周报 push 通知通道未实现。

## 后续可做

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
（`medicines.controller.ts` 与 `services/medicines.service.ts` 各一处）。

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
（`src/modules/reports/dto/report-dashboard-response.dto.ts`，DTO 内仅留一行指针注释）。
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

### OpenAPI example/nullable 语义元数据补全(zod 迁移,2026-09-03)

zod `.describe` 仅产出 description;原 `@ApiProperty` 的 `example`(及个别 nullable 展示)在 zod 直出
后丢失。对需要 example 的 query/body 字段,统一经 zod-openapi(或 schema 元数据)补 example/nullable
语义,逐模块迁移时顺带核对,验收以 openapi.json diff 为准。

### ESM 遗留 CJS 依赖与互操作跟踪（2026-09-03，NestJS 12 升级第二步）

ESM 化后遗留清单与后续跟进：

- `@prisma/internals`：named `getDMMF` 无法经 cjs-module-lexer 识别（动态重导出），`prisma-module.service.ts`
  以动态 import + default/具名回退装载。上游发布 ESM 版本后改回裸 named import。
- 两处 PDF 服务用 `createRequire(import.meta.url).resolve` 解析 `@fontpkg/*` 字体资产路径（ESM 无
  `require.resolve`），属惯用法保留。
- `cos-nodejs-sdk-v5`（default import）、adminjs 系与 `@scalar/*`（动态
  default import）当前互操作正常，无需改动；若上游导出形态变化，按计划口径复核。

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

## Today 建议卡的服务端契约缺口（动作 label / route / 文案语言）

Luminous 真机反馈(2026-10-04，App 语言为英文)：

- 「健康档案信息不完整」建议卡的主操作按钮显示的是原始动作 id `complete_profile`，
  而同一张卡的次级操作显示英文标签。根因已定位到读路径：`rules/medication/coverage.service.ts:63-68`
  把内部模板 key 当 label 种子（`label: 'complete_profile'`），
  `presentation.service.ts` 的 `toDto` 本地化只在 recompute 路径生效；
  持久化写入 `lifecycle/manager.service.ts:70` 与 GET 读回 `:204` 都原样透传
  `primaryAction`，`suggestion.service.ts` 的 `readCurrent`（`:44-99`）从不调 `toDto`，
  只靠 ≤3 分钟的 Redis 结果缓存命中时才拿到本地化版本。既有测试只覆盖 `toDto`
  （`presentation.service.spec.ts:370-392`、`action-label.integration.spec.ts`），
  `manager.service.spec.ts:299-304` 用的是已 humanize 的 `'Log dose'` fixture，
  所以持久化读路径无人看守。修法：读路径也本地化（或持久化本地化后的 action），
  并让契约在 label 缺省时报错。
- 该动作下发的 route 为 `/mine/profile/edit`，客户端路由表里并不存在——客户端只有
  `/profile`（`settings/presentation/routes.dart:193-201` 的 `ProfileRoute`，也是
  `mine` 归档行用的 `Routes.profile`）。点下去渲染成 go_router 的 "Page Not Found"
  （`app/router.dart` 没有 `errorBuilder`）。客户端侧已加对账兜底（Luminous
  `openRoute` 先匹配路由表，未知即提示不导航）；服务端需要改下发
  `coverage.service.ts:66`，并检查 `services/notification/escalation.service.ts:94`
  同样把该 route 透传进通知深链。
- 同卡标题与原因文案是中文（`title` / `reason`），而请求语言是英文：
  recompute worker 硬编码 `{ locale: 'zh-CN' }`（`services/recompute/worker.service.ts:81`，
  `suggestion.service.ts:113` 再兜一次），而 `readCurrent` 的 locale 参数是
  `_options`（未使用）、结果缓存 key 与 `getActiveSuggestions` 都不带 locale——
  客户端发的 `Accept-Language: en` 被控制器解析后即丢弃。`constants/copy-fallback.ts`
  本来就有 en-US 文案（`:27-32`）。修法：按请求 locale 物化/缓存，或在读路径用
  `Accept-Language` 重新本地化。

## 药品搜索结果的 name 对 DrugBank 条目是完整系统命名（需要可读展示名）

Luminous 真机反馈(2026-10-04)：搜索 `bu` 时 DrugBank 结果的标题是一整串系统命名，例如
`1,1,1-TRIFLUORO-3-ACETAMIDO-4-PHENYL-BUTAN-2-ONE(N-ACETYL-L-PHENYLALANYL-TRIFLUOROMETHYL-KETONE)`，
客户端只能截断到两行，用户读不出是哪个药。

- 契约现状：搜索项模型只有 `name`（生成客户端
  `generated/lucent_api/lib/src/model/medicine_search_response_items.dart` 的 `r'name'`），
  没有展示名/泛名/同义词字段；`synonyms` 只存在于**详情**响应
  （`medicine_detail_response*.dart`）。
- 待办：搜索响应补一个可读展示名（首选泛名/INN，或 `synonyms` 中第一个非系统命名），
  或在入库时把 `name` 生成为可读药名、系统命名另存一列。客户端不做名称猜测。

## 生产环境 S3 公共基址缺 bucket 段（上传成功也拿不到可访问 URL）

Luminous 真机反馈(2026-10-04)：头像上传后不显示。客户端侧根因已修（`/files/upload` 的
`fileName` 被传成 `avatars/{userId}/...`，被 schema `^[^\\/]+$` 拒收 400，已改为 basename）；
但即使上传成功，产出的 URL 仍会 404：

- `STORAGE_S3_PUBLIC_BASE_URL=https://s3.cn-south-1.qiniucs.com`（`Lucent/.env.production`），
  没有 bucket 段；而 `STORAGE_S3_BUCKET=lucent` 且 SDK 用 `forcePathStyle: true`
  （`src/common/storage/s3.runtime.ts`）→ 对象实际落在 `.../lucent/files/...`。
- `buildPublicUrl`（`src/common/storage/object-key.utils.ts`，被
  `src/modules/files/services/files.service.ts` 调用）产出 `{base}/{objectKey}` =
  `.../files/...`，缺少 `/lucent` 前缀。
- 待办：把该环境变量补成 `https://s3.cn-south-1.qiniucs.com/lucent`（或在服务端拼 bucket），
  并用一次真实 HEAD 验证；另外 dev/本地栈该变量为空，客户端
  `PresignedUpload.requirePublicUrl()` 会按设计抛错，是否要给更明确的提示由产品定。

## 2026-10-04 后端硬编码文案与 locale 缺口审计（Luminous ARB 迁移后的同源排查）

背景：Luminous 已把客户端硬编码的中/英文诊断文案迁入 ARB；同一类问题（文案不经 i18n、
语言在错误的位置被固定）此前没有在后端系统排查过。本轮为**只审计不改码**：以下为已核实项，
修复另行立项。

判定口径是「该文案是否随请求语言经 `I18nService` 解析」，而不是「字符串里有没有中文」。
两条关键事实决定了下面条目的可见性：

- `ProblemCatalog.build` 的 detail 是 `options.detail ?? translate(detailKey)`
  （`src/common/api/problem-catalog.ts:278`）——**任何显式 `detail` 都会让注册表里已写好的
  双语 detail 失效**；
- `ProblemDetails.detail` 无条件出网（`src/common/api/problem-details.ts:52`），
  而 `ApiExceptionFilter` 取 detail 的顺序是 `raw.detail → raw.message → raw.error`
  （`src/common/filters/api-exception.filter.ts:151`），
  `ValidationException` 又把 schema 的 message 原样放进 `errors.issues[].message`
  （`src/common/filters/validation-exception.ts:26-31`，由
  `StandardSchemaValidationPipe` 的 `exceptionFactory` 装配，见 `src/setup-app.ts:250-264`）。

因此下列 `detail` / `message` / 校验 message 都对客户端可见。

### 类别 ①：用户可见文案硬编码在代码里（应走 i18n）

- **DTO/校验消息（最系统性的一处，约 45 处运行期字面量、16 个文件）**：
  `src/common/validators/auth.decorators.ts:24-41,57,63,76` 是共享 schema 工厂，
  密码/验证码/邮箱/昵称的中文消息在这里生成，所有继承它的 DTO 一并中文化
  （`src/modules/auth/dto/password/change-password.dto.ts:19`、
  `src/modules/auth/dto/credentials/register.dto.ts:29-30`、
  `src/modules/auth/dto/password/verify-email.dto.ts:14-15`、
  `src/modules/auth/dto/password/reset-password.dto.ts:19` 等）；
  另有逐字段写死的中文：`src/modules/account/dto/update.dto.ts:18`、
  `src/modules/account/dto/unlink-identity.dto.ts:20`、
  `src/modules/auth/dto/shared/oauth.dto.ts:24,41,56,74,78,96,109,113,118,123`、
  `src/modules/data-export/dto/export-response.dto.ts:46`、
  `src/modules/medicines/dto/risk/risk-check-request.dto.ts:12`。
  英文用户填错表单时，`errors.issues[].message` 全是中文。
  修法：schema 消息改为稳定消息码（如 `validation.password.too_short`），
  在 `StandardSchemaValidationPipe` 的 `exceptionFactory` 里注入 `I18nService` +
  `I18nContext` 统一翻译——`validation-exception.ts:7` 那句
  「already localized where the schema says so」目前没有实现支撑。

- **通知/推送文案（写入 DB，语言在写入时刻被物化，客户端只能原样展示）**：
  `src/modules/auth/services/notification.service.ts:15-16,27-28` 的
  「账户登录提醒」「您的账户通过…登录。如非本人操作…」为纯中文，而同模块已有
  `notifications.*` i18n key 可用；`src/modules/today-analysis/services/analysis.service.ts:477`
  的中文标题「AI 今日总结已生成」与同一条通知里按请求 locale 生成的
  `content: data.summary` 拼在一起，英文用户拿到中英混排；
  `src/modules/data-export/services/processor.service.ts:148-160` 的
  `kindLabels` 与「…导出成功」「您的…已生成」全中文，而 worker 里根本没有请求 locale
  （导出请求体是带 `language` 的，需要在入队时把它带进 job）。
  修法：这些写入点统一 `i18n.t(key, { lang })` 并显式传 `lang`（理由见类别②末条）。

- **助手工具/提案的展示文案（客户端卡片直接渲染这些 label/value 与 title/summary/constraints）**：
  `src/modules/assistant/tools/presenters.ts:119-175,210,218-224,240-262` 用 zh/en 三元内联，
  `src/modules/assistant/tools/proposal/daily-record-proposal.service.ts:88,123,136-148,214,233-243,307,314-322,336-346`
  同型，`src/modules/today-analysis/services/pipeline/recommendations.service.ts:15-38`
  把 `contentZh`/`contentEn` 直接写成代码常量。
  修法：迁到 `src/i18n` 下的 assistant 命名空间（`src/modules/assistant/services/conversation.service.ts:432`
  已用 `i18n.t('assistant.conversation_not_found')`，说明归属地现成，这里是漏改）；
  presenter 只按 `locale` 取 key。同类对照：`src/modules/medicines/services/medicines.service.ts:253,275`
  也已走 i18n。

- **PDF/导出物成品文案（用户下载的文件，全套内联三元）**：
  `src/modules/data-export/utils/report-pdf.theme.ts:9-13,65-69,78-84`、
  `src/modules/data-export/services/report-pdf/pdf.service.ts:46-249`、
  `src/modules/data-export/services/report-pdf/draw.service.ts:364,400`；
  `src/modules/reports/services/clinic-summary/pdf.service.ts:78-189`、
  `src/modules/reports/services/clinic-summary/clinical-drawers.ts:32,48,71-109,176-191,258-272`、
  `src/modules/reports/services/clinic-summary/record-drawers.ts:19-123`。
  修法：抽到 i18n（`reports-clinic-summary` 命名空间 + 新增 data-export 命名空间），
  把 `isZh` 参数换成 `locale` 交给 `i18n.t` 解析，并补 key 覆盖断言。

- **邮件模板**：`src/mail/templates.ts:15,47,106-143` 把中英双语文案内联在 TS 里，
  而 locale 已经从请求传到了 `src/mail/mail.service.ts:31`——机制就位、文案没进字典。
  修法：在 `src/i18n` 下新增 mail 命名空间，模板文件只留 HTML 骨架与 key 组装。

- **中文业务失败 detail（直接出网）**：
  `src/modules/reports/services/clinic-summary/summary.service.ts:345,358,366,372,378` 与
  `src/modules/reports/services/clinic-summary/share.service.ts:254,259,279,283,287,297`
  经 `validationFailed(...)` 把中文句子塞进 `detail`；
  同型透传见 `src/modules/reports/dashboard/context.service.ts:330-337`。
  修法：改成稳定 code（必要时用 `args` 插值），不要拼句子。

- **AI prompt 侧的固定中文（会经提示词影响模型输出）**：
  `src/modules/today-analysis/services/pipeline/context.service.ts:405,408,424,428,442`
  把「饮食分析」「饮食分析缺失」「识别菜品：」「热量区间：」固定中文写进 facts JSON，
  并与 `src/modules/today-analysis/prompts/analysis.prompt.ts:16` 的英文系统提示词
  硬编码引用这两个中文字面量形成耦合——改文案必须同时改提示词。
  修法：facts 用稳定 code/结构化字段，提示词里的占位说明按 `languageLabel` 生成。

### 类别 ②：locale 处理缺口

- **邮件 locale 归一比其他路径更严**：`src/mail/templates.ts:29-34` 只认 `'zh-CN'`/`'zh'`，
  `zh-Hans`、`zh-TW`、`zh_CN` 一律回落英文；而
  `src/common/helpers/format/localized-copy.ts:12-19` 与
  `src/modules/medicine-reminders/services/scheduler.service.ts:255-258` 都按
  `startsWith('zh')` → `zh-CN`。同一个请求可能在邮件里英文、站内中文。
  修法：统一走共享的 `resolveLocale`。

- **默认语言有两个方向相反的兜底**：`src/modules/medicine-reminders/services/scheduler.service.ts:255-258`
  对 `locale` 为 null/空串显式兜 `'zh-CN'`（注释说明是「保持现状中文文案」），
  而 `resolveLocale(null)` 的结果是 `'en'`；`prisma/schema.prisma` 里没有 locale 字段的默认值
  （已 grep 确认），所以「默认中文」这个产品口径目前只存在于这一行。
  不是缺陷，但属易绊倒的双重默认；建议把默认语言收敛成单一共享常量或与
  `i18n.module.ts` 的 `fallbackLanguage` 对齐后再决定。

- **缓存键与 locale**：已核实**带 locale** 的有
  `src/modules/legal-documents/services/documents.service.ts:51,107`、
  `src/modules/assistant/tools/tool.service.ts:219`、
  `src/modules/reports/dashboard/dashboard.service.ts:31`、
  `src/modules/today-suggestion/services/copy/writer.service.ts:79,211`；
  已核实**不带 locale 但无风险**的是
  `src/modules/medicines/cache/store.service.ts:49-52`（缓存的是同时含 zh/en 两列的整行，
  语言选择发生在缓存之后，见 `src/modules/medicines/services/medicines.service.ts:213-240`）。
  **风险位**：`src/modules/today-analysis/services/pipeline/context.service.ts:90,122`
  的 context 缓存键只有 `userId:date`；当前内容恒定中文故不串语言，
  但一旦按类别①末条本地化 facts，就会跨语言复用陈旧 locale 的结果——
  与下面这条已登记项同型。
  `today-suggestion` 读路径/缓存缺口**已在台账**（本文件「Today 建议卡的服务端契约缺口」节），
  本轮复核**仍未修复**：`src/modules/today-suggestion/services/recompute/worker.service.ts:81`
  与 `src/modules/today-suggestion/services/suggestion.service.ts:113` 依旧硬编码 `'zh-CN'`，
  故不重复登记。

- **`i18n.t(key)` 不传 `lang` 依赖 AsyncLocalStorage**：`nestjs-i18n@10.8.4` 的
  `translate()` 取 `I18nContext.current()?.lang || fallbackLanguage`（其 `i18n.service.js:94`），
  context 由 `AsyncLocalStorage` 提供。HTTP 请求路径正确；**队列 / `@Cron` / 事件监听路径没有
  ALS**，会静默落到 `fallbackLanguage: 'en'`。本轮没找到确定违例
  （`src/modules/medicine-reminders/services/scheduler.service.ts:259,264` 与
  `src/modules/notification-preferences/services/weekly-insight-scheduler.service.ts:71`
  这两个 cron 写入点都显式传了 `lang`；
  `src/modules/medicines/services/risk/risk-check.service.ts:336` 只在前台候选预检路径可达）。
  登记为约束：新增 worker/cron 文案必须显式传 `lang`，不要依赖环境 context。

### 类别 ③：人话句子 vs 稳定 code（ADR-0012）

- **`DomainFailure.detail` 覆盖注册表双语 detail（约 23 处，13 个文件）**。
  由于 `problem-catalog.ts:278` 的 `??` 语义，这些显式句子让 `common.json` 里已有的
  双语 fallback 永远用不上，客户端拿到英文句子（或中文句子）而不是可映射的稳定 code：
  `src/modules/assistant/services/provider-failure.ts:52,62,69,82,93`（模型限流/超时/不可用/凭据，5 条英文句子）、
  `src/modules/assistant/agent/runtime.service.ts:265,440,452,474,502,515,529`、
  `src/modules/assistant/services/proposal-confirm.service.ts:283`、
  `src/modules/assistant/services/stream-orchestrator.service.ts:469`（`Conversation not found.` 三处重复）、
  `src/common/redis/redis.service.ts:106`、`src/modules/data-export/services/queue.service.ts:45`、
  `src/modules/medicines/services/risk/risk-check.service.ts:158`、
  `src/modules/reports/services/clinic-summary/summary.service.ts:320`（依赖未配置类句子）、
  `src/modules/reports/services/event-review/review.service.ts:405`、
  `src/modules/today-suggestion/services/feedback/recorder.service.ts:126`（带内部 id）、
  `src/modules/daily-records/services/meal-analysis/vision.service.ts:232`、
  `src/modules/notification-preferences/services/notification-preferences.service.ts:152`
  （`${field} must be between 0 and 1439.`），
  以及 `src/common/storage/s3.runtime.ts:122-124`——它把
  「STORAGE_S3_EXTERNAL_ENDPOINT is not configured; …」连同环境变量名直接发给客户端。
  修法：`detail` 只留给日志/诊断（配合 traceId），出网 detail 一律交给注册表按 code 翻译；
  确需上下文的用 `args` 插值。这正是 ADR-0012 注册表存在的意义。

- **`HttpException` 的 `message` 同样会成为出网 `detail`（约 20 处，10 个文件）**：
  `src/common/llm/generators/base-llm-generator.service.ts:98,160,241,274,283,305`
  把 `LLM generate failed: ${err.message}` / `… stream ended without any message chunks.`
  等上游异常文本透给客户端；
  `src/llm-runtime/llm-runtime.service.ts:126` 是含「Set the corresponding environment
  variables to enable this feature.」的运维指引句；
  `src/modules/auth/providers/wechat/wechat-web-oauth.provider.ts:52,138`、
  `src/modules/auth/providers/qq-oauth.provider.ts:80,313`、
  `src/modules/auth/providers/google-oauth.provider.ts:96,396`
  发的是 `… OAuth is not configured.`，而注册表里本就有 `AUTH_METHOD_DISABLED` 可承载；
  `src/modules/notifications/services/jpush.provider.ts:87` 把
  `JPush push failed: status=…, body=…`（上游响应体前 500 字符）写进客户端可见 detail，
  除 i18n 外还多一层信息泄露面；
  `src/modules/health-events/repositories/prisma-event.repository.ts:259`
  发 `Created health event could not be read back.`；
  `src/modules/assistant/agent/runtime.service.ts:373,606`——其中 `:606`
  已经带了 `code: 'ASSISTANT_REGENERATION_NO_CONTENT'`，只需删掉 message 即可回落；
  `src/modules/daily-records/services/image-upload.service.ts:72` 的
  `Object storage is not configured` 在同一文件 `:33,:40` 已用 `i18n.t('files.…')`，
  属最明确的漏改；
  后台端点 `src/modules/product-events/guards/admin.guard.ts:33,45` 属非 C 端，列为低优先。
  修法：message 只留稳定 code 或直接省略，让 filter 回落注册表文案。

### 未纳入本轮登记的内容（明确排除）

- **纯注释 / 日志 / 输入匹配表**：`src/common/llm/safety/llm-safety-policy.service.ts:6-17`
  的中文医疗词正则（安全策略输入匹配，不是文案）、`src/tracing.ts` 等文件注释、
  各处 `logger.*`、`src/modules/assistant/agent/runtime/router.ts` 与
  `src/modules/assistant/agent/runtime/tool-keyword-rules.ts` 的关键词路由表、
  `src/modules/today-analysis/services/pipeline/trigger-evaluator.service.ts:171-187` 与
  `src/modules/today-suggestion/services/collectors/record.service.ts:446-463` 的情绪词匹配、
  `src/modules/medicines/utils/ingredient-canonicalization.ts:9-30`、
  `src/modules/medicines/utils/allergy-severity.ts:4-7`、
  `src/modules/medicines/services/risk/risk-detection.service.ts:210,224-225`
  的中文词典——它们参与匹配/判定，不面向用户展示。
- **zod `.describe('中文')`**：`src/modules/auth/dto/shared/auth-response-common.dto.ts:14-53`、
  `src/modules/reports/dto/clinic-summary-response.dto.ts:80,96,108` 等只进 OpenAPI 文档
  （开发面），不是运行期返回给用户的文案；若要求 openapi.json 也双语，应单独立项，
  不与「用户可见文案」混在一张表里。
- **`Intl.DateTimeFormat('en-US')`**：`src/modules/medicine-reminders/services/delivery-moment.ts:70`
  与 `src/modules/medicine-reminders/services/scheduler.service.ts:426` 只用于
  `formatToParts` 取数字，不产出用户文案。
- **语言自称**：`src/common/helpers/format/localized-copy.ts:35` 与
  `src/modules/assistant/tools/presenters.ts` 里的 `'中文'`/`'English'` 是 endonym，
  按惯例不翻译。
- **AdminJS 面板**：`src/admin/constants/admin.constants.ts:244-283` 的标签取自 Prisma 字段名
  与 enum 值自身，运维面、无中文硬编码，不在 C 端 i18n 范围。
- **testing-support DTO**：`src/modules/testing-support/dto/prepare-fullstack-record-lane.dto.ts:22-35`
  的中文校验消息属共享密钥门控的测试支撑端点，非 C 端；若其报错会被自动化脚本读取，
  可与类别①第一条一并处理。
- **已在台账的 `today-suggestion` 项**：见类别②第三条，本轮只复核未修复，不重复登记。

### 本轮静态审计无法验证的部分

- 上述 `detail`/`message` 一定进入 problem+json body（有代码依据），但**具体某个端点是否被
  客户端真的展示**没有端到端验证：例如 `src/modules/assistant/tools/read/read.service.ts:73,286,291`
  等 `coverage.reason`/`confidence.reason` 英文诊断句是否渲染，取决于客户端实现。
- `src/modules/notifications/services/jpush.provider.ts:87` 的异常究竟只在后台调度路径抛出
  （客户端看不到）还是能经 HTTP 端点返回，本次未追调用链。
- 邮件 `resolveLocale` 的严格匹配是否真的被 `zh-Hans` 客户端命中，取决于客户端实际发送的
  `Accept-Language`（本地与生产均未取样）。
