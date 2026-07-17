# Lucent 架构审查改进计划（2026-07-16）

来源：2026-07-16 全库架构审查（src/ 728 个 TS 文件、21 个 feature module、prisma/schema.prisma 40 模型、architecture.md + 8 个 ADR 交叉核对）。

总体评价：基建质量不错（统一信封/异常过滤器、Winston + requestId、Prometheus 指标、BullMQ 共享工厂、五层测试体系、assistant port 注入模式）。主要问题集中在**数据访问治理缺位**和**文档/规范与代码漂移**。

每条完成并落地到 docs 后，从本文件删除对应章节。

---

## 高优先级

### 4. 架构文档与代码漂移

**证据**：

- `docs/01-reference/architecture.md` 的 mermaid 依赖图没有 today-suggestion 节点（实为 75 文件、44 providers 的第二大域，daily-records/dose-logs 都 imports 它）
- architecture.md 全文 0 次提及 queue/BullMQ——实际存在 7+1 个队列服务（meal-analysis、data-export、medicine-recognition、report-summary、clinic-pdf、today-analysis、suggestion-explanation + mail）
- 根 `AGENTS.md` 写 `common/ai/`——实际是 `common/llm/`；`common/` 下 `metrics/`、`queue/`、`queues/`、`storage/`、`types/` 未记录
- `common/queue/`（工厂 + 模块）与 `common/queues/`（`base-async-queue.service.ts`）双子目录割裂

**行动**：

1. architecture.md 增加 today-suggestion 子系统图和队列拓扑图。
2. 修正 AGENTS.md `ai/` → `llm/`，补全 common/ 目录清单。
3. 合并 `common/queue` 与 `common/queues` 为一个目录。

**影响范围**：文档 + 一次目录移动。

---

## 中优先级

### 5. 三个向量检索工具重复实现 PGVectorStore 初始化

**证据**：`assistant/tools/leaflet/read.service.ts`、`assistant/tools/drugbank/search.service.ts`、`assistant/tools/knowledge/medical.service.ts` 各自维护 `vectorStore` + `initPromise` + `createEmbeddings()` + `new PGVectorStore(...)` + `ensureTableInDatabase()`（近乎逐行重复），各自 `new OpenAIEmbeddings`（而 `llm-runtime/services/llm-runtime.service.ts:136` 已有共享 `createEmbeddingModel()`），三份 pg 连接池放大数据库连接数。

**行动**：抽 `VectorStoreFactory`（注入 llm-runtime 的 embedding model + 统一连接池），三个工具只声明表名/列名差异。

**影响范围**：assistant/tools 的 leaflet、drugbank、knowledge + llm-runtime。

### 6. Repository 模式落地一半，绑定方式不一致

**证据**：6 个模块有 Port + Repository，14 个模块（user-settings、notifications、legal-documents、today-suggestion、today-analysis、reports、account、security-pin、user、medicines、data-export 等）service 直接注入 `PrismaService`。绑定方式混用 `useClass` / `useExisting` 双注册。`DailyRecordRepositoryPort` 在 exports 中但全库无外部消费者（违反 AGENTS.md "exported iff" 规则）。

**行动**：

1. 明确"哪些模块必须有 Port"的标准（read-model 模块可豁免），写进 ADR。
2. 统一 port 绑定写法；移除未使用的 export。

**影响范围**：模块定义文件为主，低风险。

### 7. BullMQ Worker 和 Cron 全部跑在 API 进程内

**证据**：`common/queue/queue.factory.ts` 在 API 进程内创建 `Worker`；7 个队列 worker（含 PDF 生成、LLM 调用）与 HTTP 请求争用同一事件循环。`today-suggestion/services/lifecycle/service.ts:256` 的 `@Cron` 每 5 分钟执行。

**更新（2026-07-16）**：已决定砍掉蓝绿双 slot 改单 slot 停机部署（见 `2026-07-16-deployment-hardening.md`），cron 双进程同时触发的顾虑随之消失，无需再加分布式锁。

**行动**：

1. 中期：worker 拆为独立进程/容器（同一镜像不同 command），ADR-0004 部署模型补队列拓扑章节。

**影响范围**：common/queue、today-suggestion lifecycle、deploy 配置。

### 8. 异步任务结果无持久化，失败无死信告警

**证据**：`common/queues/base-async-queue.service.ts` 把 `AsyncJobResult` 只写 cache-manager（TTL 30 分钟），客户端轮询 `getStatus`（5 个 controller）。30 分钟未轮询结果即丢；job 重试 3 次进 failed 集合仅保留 7 天，无告警；Prometheus 有 `bullmq_jobs_total` 指标但 alert rules 未做。

**行动**：

1. failed 任务落 UserNotification 或至少结构化 error 日志 + Grafana alert。
2. 长结果（如 AI 摘要）考虑写回业务表而非只放缓存。

**影响范围**：common/queues、5 个队列消费模块、notifications。

### 9. 认证 guard 逐 controller 手动挂载（默认不安全）

**证据**：`app.module.ts` 只全局注册 `ThrottlerGuard`；`JwtAuthGuard` 靠 16 个 controller 各自手写 `@UseGuards`。新增 controller 忘挂即裸奔。`auth/decorators/public.decorator.ts` 已存在，全局 guard + 白名单模式设计过却没落地。

**行动**：`JwtAuthGuard` 注册为 `APP_GUARD` + `@Public()` 白名单，公开端点收敛为显式标注。用 `test/security/authorization.e2e-spec.ts` 做回归网。

**影响范围**：全部 controller + auth 模块。

### 10. SSE 与轮询端点消耗全局 Throttler 预算

**证据**：全局 `ThrottlerModule` 100 req/60s/IP；SSE 流端点（`assistant.controller.ts:126`、reports、today-analysis）和 5 个队列 `getStatus` 轮询端点均无 `@SkipThrottle` 或自定义 limit（全库仅 today-suggestion.controller 有端点级 `@Throttle`）。前端轮询易触发 429。

**行动**：SSE 握手和 getStatus 轮询加 `@SkipThrottle`（或更高 limit 的 named throttler），保留 AI 生成类端点的严格限流。

**影响范围**：assistant、reports、today-analysis、today-suggestion、data-export controller。

### 11. auth 巨型模块职责过载（78 文件、17 providers）

**证据**：`auth/auth.module.ts` 承载本地凭证、4 个 OAuth provider、session 管理、验证码、登录限流、OAuth state、通知编排。`auth.service.spec.ts` 孤置模块根目录而被测源码在 `services/auth.service.ts`（违反规范第 8 条）。

**行动**：按边界拆 `identity/`（凭证 + 验证码 + 限流）与 `oauth/` 子模块；移动孤儿 spec。不急，但每加一个 OAuth 渠道都在加重。

**影响范围**：auth 模块内部。

---

## 低优先级

### 12. Barrel 规则无工具强制，深路径引用普遍

**证据**：`llm-runtime/services/` 无 `index.ts`，全项目深引用（`daily-records/services/meal-analysis/vision.service.ts:7` 等 4+ 处）；`assistant/services/core.service.ts:12`、`tools/read.service.ts:6` 深引用 user-settings 内部文件；`daily-records/services/records.service.ts:25` 深引用 today-suggestion `cache/` 内部文件。

**行动**：补 `llm-runtime/services/index.ts`；用 ESLint `no-restricted-imports` 禁止跨模块深路径。

### 13. `LlmSafetyPolicyService` 在 4 个模块重复注册

**证据**：daily-records、reports、today-analysis、today-suggestion 各自 providers 注册（4 份实例，无状态所以无害）。

**行动**：收进共享 `LlmCommonModule`（连 `common/llm/` 的 base generator 一起管理）。

### 14. data-export 名不副实

**证据**：`data-export/services/processor.service.ts:46` 只调 `reportsService.getDashboard` 生成 PDF——不导出任何原始用户数据。模块命名和 `DataExportRequest` 表语义误导。

**行动**：文档明确边界（报告下载）或重新命名；若定位是合规数据导出则范围需补齐。

### 15. 读模型查询无条数上限

**证据**：`today-suggestion/services/collectors/record.service.ts:48-65`（lookback N 天 findMany）、`reports/dashboard/context.service.ts:42-70`、`today-analysis/services/context.service.ts` 均无 `take` 上限。用户数据增长后 context 构建拖慢整个 AI 管道（notifications 2026-07-11 已修复过同类问题并加 `take: 50`）。

**行动**：给三处 context/collector 查询加 `take` 上限。

---

## 附：做得好的（不建议改动）

- assistant 模块 port 注入 + LangGraph tool-loop + 工具按域分目录是全库最好的模块边界示范
- 队列基建统一（`BullmqQueueFactory` 集中连接与生命周期，Redis 缺失时降级同步执行）
- 测试体系完整（单测/e2e/contract/security/perf 五层）
- metrics、requestId、慢请求拦截、健康三探针齐全
- Security Elevation（PIN + 短期 elevation token）设计严谨有专项安全测试

**观察项**：vitest.config.ts 配了 coverage 输出但无 thresholds 门槛，测试覆盖率无 CI 强制（未深入 CI workflow 确认）。
