# ADR-0010: Full-Stack Tracing — OpenTelemetry + Jaeger, Retire requestId

- **Status**: accepted
- **Date**: 2026-08-01
- **Deciders**: LuoMuLoyal
- **Supersedes**: ADR-0006 中「明确推迟 OpenTelemetry / 分布式追踪」的决策

## Context

[ADR-0006](0006-observability-strategy.md) 在单进程架构下明确推迟 OpenTelemetry：当时
"唯一的跨服务调用是外部 LLM API"，traces 价值接近零，先以 prom-client + Prometheus/Grafana
满足指标支柱。

自 ADR-0006 之后项目进入 **LangGraph AI 管道编排**阶段（分类 → read/write/knowledge 子图 →
工具循环 → 校验），单请求内 LLM → RAG → 工具调用存在多段耗时，暴露出现状的两处缺口：

1. **span 级延迟分解缺失**：日志只能给出请求总耗时与 `SlowRequestInterceptor` 阈值告警，
   无法回答"LLM 调用 vs 向量检索 vs 工具执行各占多少"。
2. **跨端链路关联缺失**：Luminous App 侧报错时，无法把 App 日志/错误关联到后端同一条请求
   链路，联调期只能靠时间戳人工对齐。

ADR-0006 预设的触发条件「AI 管道延迟调试需要 span 级可见性」已满足。经与用户确认：
引入 OTel 全链路追踪（trace + Jaeger），且 `requestId` 机制**彻底退役**（不做双轨并存）。

## Decision

引入 OpenTelemetry 全链路追踪：

1. **SDK 与自动插桩**：`@opentelemetry/sdk-node` + `getNodeAutoInstrumentations()`（覆盖
   HTTP/DB/Redis），OTLP HTTP exporter 上报至 Jaeger all-in-one（`docker-compose.dev.yml`
   新增 `jaeger` 服务，UI 16686 / OTLP 4318）。
2. **门控**：`src/tracing.ts`（`main.ts` 首个 import）由 `OTEL_ENABLED=true` 门控启动，
   默认关闭——测试与既有开发流程不受影响。
3. **链路传播协议**：入站 `traceparent`（W3C 标准，App 侧注入，已有则透传延续链路）；
   出站响应头回写 `traceresponse`（`00-{traceId}-{spanId}-01`），由 Fastify `onSend` hook
   实现（`onResponse` 时响应头已发送，设置不生效）。
4. **日志统一注入**：`otelTraceFormat` 从 OTel context 的活跃 span 注入 top-level
   `trace_id` / `span_id`（`trace-context.utils.ts`）；span 之外（启动、cron、队列 worker）
   不注入，显式传入的元数据优先。
5. **彻底退役 requestId**：删除 `RequestContextService`、requestId 中间件、`REQUEST_ID_HEADER`、
   `requestIdFormat`、access log 与 Prisma 慢查询的 requestId 字段——不做双轨并存。
6. **LLM 手动 span**：`BaseLlmGeneratorService.generate` 外包
   `llm.{streamName}.generate` span，记录 `llm.model_role` / `llm.model_name`；
   `generateStream` 本期不包 span。

## Options Considered

### Option A: 引入 OTel 全链路追踪 + Jaeger（**选定方案**）

| 优势                                              | 劣势                                  |
| ------------------------------------------------- | ------------------------------------- |
| AI 管道 LLM → RAG → 工具链路 span 级瀑布          | 新增 5 个 OTel 依赖 + Jaeger 本地容器 |
| `traceparent`/`traceresponse` 打通 App ↔ 后端链路 | 需维护 `onSend` 响应头回写 hook       |
| 日志 `trace_id`/`span_id` 与 Jaeger 一键关联      | `requestId` 存量引用需全量清理        |
| 与指标（prom-client/Prometheus）并存，无冲突      | 跨进程 trace（BullMQ worker）本期不做 |
| OTel 是 CNCF 标准，未来多实例/微服务无需迁移      |                                       |

### Option B: 保留 requestId，另加 OTel（双轨）

| 优势                 | 劣势                                                 |
| -------------------- | ---------------------------------------------------- |
| 迁移风险低           | 两套关联 ID 并存，日志与错误上报需同时携带两种上下文 |
| requestId 代码零改动 | 与 OTel 功能重叠且非标准，认知负担与维护成本翻倍     |

**否决理由**：requestId 是私有协议，跨端（App 侧无法解析）与跨库（Jaeger 检索）都不通用；
用户明确要求彻底退役，不做双轨并存。

### Option C: 仅增强日志（增加结构化字段），不引入 trace

| 优势       | 劣势                                             |
| ---------- | ------------------------------------------------ |
| 零新依赖   | 无法回答 span 级延迟分解，App 报错仍无法定位链路 |
| 改动面最小 | 延迟瀑布需要手动打点，工作量大且不可复用         |

**否决理由**：日志无法提供调用树与耗时瀑布，触发条件（AI 管道 span 级调试）已满足，
投入产出比不如直接引入 OTel。

## Decision Rationale

1. **触发条件已满足**：ADR-0006 明确将「AI 管道延迟调试需要 span 级可见性」列为重新评估
   OTel 的触发条件，LangGraph 编排落地后该条件成立。
2. **链路关联跨端必需**：App 侧报错 → `traceresponse` 提取 traceId → Jaeger 按 Trace ID
   检索，一步定位后端同一链路；这是 requestId（仅后端进程内有效）无法做到的。
3. **门控保证零侵入**：`OTEL_ENABLED=true` 才启动 SDK，测试与默认开发流程完全不受影响，
   OTel 引入不改变现有行为基线。
4. **requestId 无保留价值**：退役 requestId 后日志关联字段统一为 `trace_id`/`span_id`，
   协议字段从私有 `x-request-id` 切换为标准 `traceparent`，跨端/跨库检索能力更强。
5. **指标策略不变**：指标仍走 prom-client → Prometheus → Grafana（ADR-0006 Phase 1），
   本次只补充追踪支柱，不改变既有指标管线。

## Consequences

### 变得更容易

- AI 管道联调：按 span 瀑布直接看到 LLM / RAG / 工具调用分段耗时，瓶颈一目了然
- 跨端排障：App 侧 `lastTraceId` 与 Jaeger 同一条 trace 对应，报错可精确复现链路
- 日志检索：按 `trace_id` 过滤日志即可聚合单请求全链路日志

### 变得更难 / 新增负担

- `docker-compose.dev.yml` 新增 `jaeger` 服务（all-in-one 镜像）
- OTel 相关依赖纳入 `package.json`（SDK + exporter + auto-instrumentations）
- `setup-app.ts` 需维护 `onSend` 响应头回写 hook（与 `onResponse` 的时序差异易踩坑）

### 不变

- 指标支柱：prom-client + Prometheus/Grafana 策略（ADR-0006）继续有效
- 日志框架：Winston（ADR-0007）不变，仅格式层新增 trace 字段注入
- 测试：无 `OTEL_ENABLED=true` 时 SDK 不启动，行为与之前一致
- 非目标：BullMQ worker span、`generateStream` 手动 span、App 端错误上报页展示 traceId
