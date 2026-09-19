---
status: active
owner: backend
quadrant: reference
updated: 2026-09-18
---

# Lucent TODO

本文件是唯一 TODO 台账,条目完成即删行。

Last updated: 2026-09-18

This file keeps active backend follow-up items that are intentionally deferred.
Keep durable implementation context in the owning code comments when the TODO is tightly coupled to
one branch or security check, but do not scatter project-level follow-up lists across changelogs or
random docs.

**When a follow-up item is completed:** delete it from this file, and record the completion in
today's `Lucent/docs/logs/migration-log/YYYY-MM-DD.md`(跨仓事项在各自仓库的迁移日志留痕)。

## 2026-09-19 英文侧 OAG（Semantica）接线已落地，剩余为镜像 / 评测 / 本体

`reason_over_ontology` 工具、四个注册点、policy 门控、sidecar 客户端、confirm 路径审计、
**PROV-O 端到端引用**（边上 `prov` → sidecar `/provenance` 解析 → envelope `citations`
→ SSE `toolDetails` → 来源条）已落地并真机验证（详见当日迁移日志）。剩余：

- **sidecar 镜像（未做）**：三份 compose 的 `semantica` 服务定义已就位（profile 门控，
  避免 `docker compose up` 去拉不存在的镜像），但 `semantica-service` 仓还没有
  Dockerfile，容器化部署不可用；dev 目前靠本机 `uvicorn` + `.env.development` 直连。
- **旁路端点未做**：`/reason` 的 `load_from_graph` 导出桥一次只加载约 23%（双 LIMIT
  且无 `ORDER BY`，211,630 条边里非确定地取到一部分），要改成 keyset 分页或超限即报错；
  sidecar 的 `uvicorn --timeout-keep-alive` 与客户端传输层重试目前只做在评测脚本里。
- **图谱数据缺口**：`ATCClass` 节点只有 `code`、没有类名（Lucent 库里也没有 ATC 名称表），
  所以"这是什么类"只能答 code；相互作用边**单向**（只按列举方建边，19,842 行里只有
  4,218 个药出现在源列），因此"图上无此边"不等于"临床上无相互作用"——工具措辞已按此写，
  但补全双向边与导入 ATC 类名都还没做。
- **英文侧评测集（计划 S0，未做）**：S4 之后"是否继续"的唯一判据；现有六个探测是能力
  探测，不是评测集。
- **本体词表与手写 SHACL（计划 S3，未做）**：§4.1 的 YAML 词表未落 Lucent，
  `/validate` 的 SHACL 目前由调用方提供。
- **AGE 计划的现状描述过期**：`plans/2026-09-27-apache-age-introduction-plan.md`
  的状态行与 §2.1 仍写"未开工 / 待自建"，而 dev 已用自建的 `lucent-db` 镜像
  （AGE 1.7.0）并通过 P0 验收。

## 2026-09-18 LightRAG 中文散文检索（P1/P3 已落地，剩余为评测与生产核对）

中文散文检索已**整体切换到 LightRAG**：旧散文检索工具与服务已删除，契约、
脚本、双仓客户端全部同步完成（详见当日迁移日志）。剩余为评测与生产侧动作：

- **P2 全量评测（未做）**：当前只有一次 20 条语料的小样本模式验证
  （产物在仓库外的 `lightrag-eval/`），**不足以判断真实规模下图模式是否有增益**；
  社区经验阈值是 500–2000 页文档以上图模式才明显胜出，本项目远超该阈值，
  真正的结论必须来自中大规模重跑，且需补**答案质量**评分（论文证明图模式收益
  体现在端到端答案，而 Lucent 只取上下文、自己生成）。
  **未评测前 `leaflet` 与 `qa` 的 `mode` 只接受 `naive`**（服务端已强制）。
- **建图成本决策（未决）**：实测约 4 分钟/chunk、约 $0.057/doc。按 21,142 份
  说明书估算，全量建图的墙钟与费用**需要单独立项**，不是"顺手跑一下"。
- **P4 灌 `qa` workspace（脚本就位，未实跑）**：`medical_qa_chunks` 当前 0 行，
  源数据（`DrugDataBase/医疗问答数据集一共135万条`）尚未导入。步骤：
  `import-medical-qa.ts --filter` → `pnpm import:lightrag --workspace=qa`。
- **P5 生产核对（未做）**：生产库验证 sidecar 可达、`/query` 鉴权生效
  （注意 `/health` 不校验鉴权，不能用来判断 key 是否配对）与 workspace 命中。
- **workspace 隔离（已知限制，不做）**：上游 #2527 确认单实例仅支持单
  workspace，实测 `LIGHTRAG-WORKSPACE` 头不改变实际读写位置。因此同实例上
  `leaflet` 与 `qa` 共享一个命名空间，靠 doc id 前缀区分；需要物理隔离要另起
  实例。已在 assistant README / env 文档 / deployment 记录。
- **待定**：工具名 `search_cn_medicine_knowledge` 如需改名，在评测前定。

**已确认保留**：`VectorStoreFactory` 与 `ASSISTANT_VECTOR_*` **不删**——
`search_drugbank_passages`（英文侧）仍走 Lucent 自己的 pgvector 表，与 LightRAG
无关（计划 §6 曾标"实施时确认"，现确认保留）。

## 2026-09-11 文件上传链路遗留（上传链路收敛时发现）

### 对象存储缺少删除/生命周期能力（P3）

`POST /api/v1/user/files/upload` 只签发预签名上传凭证，`/user/files` 下没有删除端点：用户上传
头像/附件后放弃保存、或替换旧头像，对象会永久留在 bucket 里。方案：增加对象删除能力（或将
`{prefix}/{userId}/…` 前缀 + 时间的生命周期回收策略交给存储后端），并在 Luminous 的
「替换/移除」路径调用。验收：替换头像后旧对象可被回收，且用户无法借删除端点触达他人对象
（沿用各资源端点「跨用户访问 → 404」的 e2e 约定）。对侧登记见 Luminous `docs/TODO.md`。

### `/medicines/recognize` 响应 schema 缺失（P3）

`files/upload` 的响应 schema 已在同日补齐（见当日迁移日志），但
`POST /api/v1/user/medicines/recognize` 同样只有 description、没有 `content`，生成客户端的响应体
被丢掉——Luminous 的 scan 只能手写 Dio + `coerceToStringMap` 解析 `name` / `approvalNumber`，
协议违规退化为 `Left(unknown)`。方案：按 daily-records / files 的既有写法补
`registerResponseSchema` + `@SerializeOptions`，重新导出 OpenAPI。验收：Luminous 该调用点可改用
类型化客户端并删掉手写解析（对侧登记见 Luminous `docs/TODO.md`）。

## 2026-09-06 OAuth 登入门槛调整（微博全链路移除待办）

前端已把微博登录 UI 入口隐藏（`Luminous`），后端微博 OAuth 全链路移除作为待办：
删除 `src/modules/auth/providers/weibo-oauth.provider.ts`（及其 spec）、
`oauth.controller.ts` 中 `/api/v1/auth/oauth/weibo/*` 端点与
`registerResponseSchema` 条目、`oauth.dto.ts` 的 `weiboOAuthAuthorizeSchema` /
`weiboOAuthCallbackSchema` 及相关类型、`oauth.config.ts` 的 `weibo` 项、
`EnvKey.WEIBO_*` 环境变量（同步 `docs/reference/environment-variables.md`）、
`state.service.ts` 的 weibo 回跳路径、`oauth.types.ts` 的 `OAUTH_PROVIDER_WEIBO`、
`auth.service.ts` / `facade.service.ts` 的 weibo 方法与相关测试；移除后重新导出 OpenAPI。

### B5：风险检查候选预检的错误可观测性（P3，2026-08-16 F-9 审查 P2）

`MedicineRiskCheckService.evaluateStaticCheck` 候选详情解析失败时，非 NotFound 异常被 `badRequest('候选药品资料不可用…')` 包装为 400 且原始错误不记录日志（`services/risk/risk-check.service.ts`）。建议：抛错前 `logger.warn` 记录原始 error，或将上游知识库服务类异常转 502/503；验收：候选资料不可用时仍显式失败，且日志可定位原始异常。

### B6：候选预检与药品详情知识缓存的交互口径（P3，2026-08-16 F-9 审查 P2）

候选预检通过 `getDetailWithCache(candidate.id, {source}, false)` 取详情，miss 时会写入药品详情知识缓存（`services/medicines.service.ts`）；「预检不落库」口径仅指 risk-check records 与 records 缓存（已确认不触碰）。验收：确认该口径并在必要时文档化；无行为改动。

## 文档治理观察期(2026-08-31,来源:doc-governance-overhaul 计划,文件已删)

### G2:arch:check 观察期规则转级(warn → error,一周评估)

基线(2026-08-31):依赖图 R1=7(product-events spec 深引 today-suggestion)、R2=0、
R3=12(common/queue → 4 模块)、R4=1(medicines cache spec 直引 keyv)、R5=0、循环依赖 5 环;
eslint.arch W1=0、W2=12(service 裸 throw)、W3=1033(magic numbers)、W4=54(测试 `: any`);
AST C1=849(DTO 缺 `@Is*`)、C2=111(端点缺显式鉴权)。逐条清理后分批转 error,
全部清零后启用 `check-ast-conventions.ts --strict`。

### G3:CI 增加 openapi.json 一致性 diff 校验

lucent-ci.yml 现仅在 E2E 前重导出 spec 供契约测试;增加
`git diff --exit-code docs/reference/generated/openapi.json` 步骤,使"代码已改但忘记提交
重导出产物"在 CI 失败(README 的 CI 叙述已按此写,补齐实现)。

### G4:契约-代码差异清单(Phase 0 审计遗留)

逐项裁决实现或从契约/文档移除:user-settings `waterTargetCount` 契约缺失;
environment 为简化实现(静态数据,关联 B2);`GET /environment/advice` 未实现;
周报 push 通知通道未实现。

## 后续可做

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

oxlint 落地稳定后，将 `lucent-ci.yml` ci-lint-typecheck 作业中的 `lint:oxlint` 与
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
- `cos-nodejs-sdk-v5`（default import）、`better-auth`（ESM 出口）、adminjs 系与 `@scalar/*`（动态
  default import）当前互操作正常，无需改动；若上游导出形态变化，按计划口径复核。

### @nestjs/throttler 与 nest-winston 的 ^12 peer 跟进（2026-09-02，NestJS 12 升级第一步）

`@nestjs/throttler@6.5.0`（npm latest）与 `nest-winston@1.10.2` 的 peerDependencies 尚未纳入
`@nestjs/* ^12`（上限 ^11）。pnpm 安装产生 peer 告警但不阻断；框架升级后 e2e 全量运行时行为已验证正常
（rate-limiting 套件与日志链路通过）。上游扩 peer 或发新 major 后升级以消除告警；若长期不更新，
评估替代方案或 fork peer 声明。

### 高级可观测性（基础已完成）

基础可观测性已就位（Prometheus metrics + Grafana dashboards + LLM/BullMQ 指标 + Alertmanager 告警规则 + OpenTelemetry 分布式追踪：`src/tracing.ts`、`trace-context.utils.ts`、base-llm-generator 集成）。以下为进阶项：

- 添加 synthetic uptime monitoring

### 药物结构式 2D 可视化（2026-09-16，DrugBank 结构描述符落地后）

`drugbank_structures` 已入库并随详情下发（SMILES / InChI / 分子式 / 分子量 / pKa /
类药性规则等），前端以文本 + 复制呈现。**2D 结构式图形渲染刻意未做**：Flutter 生态无成熟
的 SMILES 出图包，且 `structures.sdf` 实测为纯 2D（z 恒为 0），没有构象数据可消费。
若将来要出图，需先引入/自研 SMILES 布局渲染，并评估移动端渲染成本。

### 响应侧 Standard Schema 序列化的未竟事项（2026-09-03，NestJS 12 计划收尾）

响应侧 zod + `StandardSchemaSerializerInterceptor` 已全量落地并闸门绿，以下边角留待后续：

- 201/202 主成功响应在 export 期已回写 `$ref`；若新端点引入其他非 200 成功码语义，需在导出
  脚本的成功码回写列表同步扩展（现 200→201→202）。
- `@SerializeOptions` 未被 Swagger 自省,响应组件靠 export 期注册表注入;注册路径必须与导出
  operation 逐字一致(含 RouterModule 前缀与 `{…}` 参数),不一致导出会显式报错——新增模块照此约定。
- SSE/text 流端点不注册响应组件(非 JSON 200),如需结构化 `event: error` 语义遵循 ADR-0012/0017。

### `@nestjs/observe` 复议条件（2026-09-03，NestJS 12 计划收尾）

v12 升级与自研 observability 栈(metrics/logger/tracing)完成,未采用 `@nestjs/observe`;
当官方模块覆盖自研 OTel 注入点(BullMQ worker span、HTTP/LLM span、queue 深度 gauges)或
staging 基线对照暴露缺口时复议。
