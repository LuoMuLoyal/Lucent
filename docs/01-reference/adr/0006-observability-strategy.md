# ADR-0006: Observability Strategy — prom-client + Prometheus/Grafana, Defer OpenTelemetry

- **Status**: accepted
- **Date**: 2026-07-09
- **Deciders**: LuoMuLoyal

## Context

Lucent 即将进入 `v1.0.0` 稳定发布阶段。ROADMAP 将 "Production observability (metrics, dashboards,
alerting)" 列为 `v1.0.0` 的首要任务。当前可观测性现状如下：

### 已有的可观测性基线

| 支柱       | 现状                                                                                                                               |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **日志**   | Pino 结构化 JSON 日志（`nestjs-pino`），请求 ID 传播，路由级噪声抑制，`SlowRequestInterceptor` 慢请求告警，生命周期事件日志        |
| **指标**   | `ProcessMetricsService` 每 5 分钟将 rss/heap/uptime/activeHandles 写入 Pino 日志流；`/api/v1/health/deep` 返回带耗时的依赖探测结果 |
| **追踪**   | 无                                                                                                                                 |
| **仪表盘** | 无                                                                                                                                 |
| **告警**   | 无                                                                                                                                 |

### 项目约束

- **部署模型**：单服务器 Docker Compose（app + postgres + redis + nginx），无 Kubernetes，无多实例
- **团队规模**：单人开发者
- **项目阶段**：`v1.0.0-dev`，尚未稳定发布
- **流量规模**：个人健康管理助手，非高并发产品
- **架构特征**：单 Node.js 进程，AI 管道重度依赖外部 LLM API（SSE 流式），BullMQ 异步任务

### 需要解决的问题

1. 生产环境出问题时只能 `docker compose logs --tail=200` 翻日志，无法快速定位"什么时候开始变慢""错误率是否在上升"
2. 没有时间序列数据，无法回答"过去 24 小时的 P99 延迟是多少""AI 调用失败率趋势如何"
3. 没有主动告警，只能靠用户反馈发现问题
4. `ProcessMetricsService` 把指标写入日志流是一种 workaround，无法做时序聚合和可视化

## Decision

采用 **分阶段可观测性策略**：

### Phase 1（v1.0.0）：prom-client + Prometheus + Grafana

1. **引入 `prom-client`**（Node.js 标准 Prometheus 客户端库）在 Lucent 进程内采集指标
2. **暴露 `/metrics` 端点**供 Prometheus scrape
3. **在 `docker-compose.yml` 中新增 `prometheus` 和 `grafana` 两个容器**
4. **配置 Grafana 仪表盘**：HTTP 请求延迟/错误率、Node.js 进程指标、BullMQ 队列深度、AI 调用延迟/Token
5. **配置基础告警规则**：5xx 错误率、健康检查失败、内存泄漏趋势、队列积压

### 明确推迟 OpenTelemetry / 分布式追踪

在以下触发条件之一满足时重新评估 OpenTelemetry 引入：

- 水平扩展到多实例部署（ROADMAP `v2.0.0`）
- AI 管道延迟调试需要 span 级可见性（例如 LLM → RAG → 工具调用链路的分段耗时）
- 系统拆分为多个独立部署的服务

## Options Considered

### Option A: 全量 OpenTelemetry SDK + OTLP Collector + Prometheus + Grafana

在应用层引入 `@opentelemetry/sdk-node`，配置 OTLP exporter 发送到 Collector，由 Collector 转发到
Prometheus（指标）和 Jaeger/Tempo（追踪）。

| 优势                                | 劣势                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------- |
| 一步到位，metrics + traces 统一管线 | 单进程应用无分布式调用，traces 价值接近零                                 |
| OTel 是 CNCF 标准，生态最广         | SDK 初始化需在应用代码前加载（`--require`），与 NestJS 启动流程有摩擦     |
| 未来扩展无需迁移                    | Collector 是额外基础设施组件，单人维护成本高                              |
|                                     | 引入 6+ 个新 npm 依赖（SDK + instrumentations），增加构建体积和安全审计面 |
|                                     | 当前阶段 ROI 极低                                                         |

### Option B: prom-client + Prometheus + Grafana（**选定方案**）

使用 `prom-client` 在进程内采集指标，Prometheus 定时 scrape `/metrics`，Grafana 可视化。

| 优势                                        | 劣势                                                   |
| ------------------------------------------- | ------------------------------------------------------ |
| `prom-client` 是 Node.js 生态最成熟的指标库 | 不提供分布式追踪能力（单进程场景不需要）               |
| 仅 1 个新 npm 依赖，零启动流程侵入          | 指标格式绑定 Prometheus exposition format，非通用 OTLP |
| Prometheus + Grafana 是行业事实标准         | docker-compose 增加 2 个容器（资源开销约 200-300MB）   |
| 从 Pino 日志到 Prometheus 指标升级路径自然  | `ProcessMetricsService` 需要重构或退役                 |
| 满足 ROADMAP v1.0.0 全部 observability 目标 | Grafana 仪表盘和告警规则需要初始投入                   |
| 未来可平滑迁移到 OTel（prom-client → OTLP） |                                                        |

### Option C: 仅增强 Pino 日志 + 外部日志分析

不引入新基础设施，将更多指标（请求延迟直方图、队列深度等）以结构化字段写入 Pino 日志流，配合
`jq` / grep 或未来引入的日志聚合工具（Loki）做分析。

| 优势                   | 劣势                                          |
| ---------------------- | --------------------------------------------- |
| 零新基础设施，零新依赖 | 无法做实时时序聚合和告警                      |
| 完全复用现有 Pino 投资 | 日志流不是时序数据库，范围查询和聚合效率极差  |
|                        | "仪表盘"退化为 `jq` 管道，不可持续            |
|                        | 不满足 ROADMAP v1.0.0 的 dashboard/alert 要求 |

### Option D: 推迟所有可观测性投入

在 `v1.0.0` 不引入任何可观测性基础设施，等产品用户增长后再考虑。

| 优势                   | 劣势                                            |
| ---------------------- | ----------------------------------------------- |
| 最大化产品功能开发时间 | 生产事故时完全盲飞，MTTR 极高                   |
| 零运维开销             | 技术债积累，v1.0.0 稳定发布缺乏生产可观测性保障 |
|                        | 与 ROADMAP 明确列出的 v1.0.0 目标矛盾           |

## Decision Rationale

选择 **Option B** 的核心推理：

### 1. 可观测性三支柱的适用性分析

可观测性三支柱是 **Logs、Metrics、Traces**。对 Lucent 当前架构的适用性：

| 支柱        | 当前状态          | v1.0.0 目标          | 适用性判断                                       |
| ----------- | ----------------- | -------------------- | ------------------------------------------------ |
| **Logs**    | Pino 结构化日志   | 保持现状             | 已满足。单进程 + 结构化 JSON 日志 + 请求 ID 足够 |
| **Metrics** | 日志流 workaround | Prometheus + Grafana | **缺失**。需要从"日志里的数字"升级为时序数据库   |
| **Traces**  | 无                | 推迟                 | **不适用**。单进程无跨服务调用，traces 价值 ≈ 0  |

分布式追踪的核心价值在于"一个请求穿过多个服务时的链路可视化"。Lucent 是单 Node.js 进程，
所有逻辑在同一个 event loop 内完成。唯一的"跨服务"调用是外部 LLM API，但这些调用的耗时
已经通过 Pino 日志和 `SlowRequestInterceptor` 捕获。引入 OpenTelemetry tracing 在当前阶段
是纯粹的复杂度增加，不产生 actionable insight。

### 2. prom-client 的具体优势

- **轻量**：1 个 npm 依赖，无原生模块，无启动侵入
- **内建默认指标**：`prom-client` 自带 Node.js 默认指标收集（heap、rss、event loop lag、GC
  stats、libuv handles），可以直接替代 `ProcessMetricsService` 的 workaround
- **Histogram 支持**：HTTP 请求延迟直方图是 Prometheus 的核心用例，`prom-client` 原生支持
- **exposition format 标准**：`/metrics` 端点输出标准 Prometheus text format，无需额外转换
- **社区生态**：NestJS 社区有 `nestjs-prometheus` 封装，但直接使用 `prom-client` 也简单直接

### 3. 未来迁移路径

```
v1.0.0                          v2.0.0 (if needed)
──────                          ──────────────────
prom-client                     OpenTelemetry SDK
  ↓                               ↓
/metrics ──→ Prometheus          OTLP ──→ Collector ──→ Prometheus + Tempo
  ↓                                         ↓
Grafana                                    Grafana
```

如果未来需要引入 OpenTelemetry：

1. 在应用层添加 `@opentelemetry/sdk-node` + instrumentations
2. `prom-client` 指标可以通过 OTLP exporter 替代或并行导出
3. Grafana 仪表盘和告警规则无需迁移（数据源仍为 Prometheus）
4. 新增 Tempo/Jaeger 作为追踪后端

迁移成本可控，不存在锁定风险。

### 4. 与 ROADMAP 的一致性

ROADMAP v1.0.0 明确列出：

> **Observability** — Prometheus metrics export, Grafana dashboards, alert rules, synthetic
> uptime monitoring

本决策直接对应这一目标。synthetic uptime monitoring 可在 Phase 1 后期通过 Grafana
Synthetic Monitoring 或外部服务（UptimeRobot 等）补充。

## Metrics Scope (Phase 1)

### 默认指标（prom-client 内建）

- `nodejs_heap_size_used_bytes` / `nodejs_heap_size_total_bytes`
- `nodejs_external_memory_bytes` / `nodejs_resident_memory_bytes`
- `nodejs_event_loop_lag_seconds`
- `nodejs_gc_duration_seconds`
- `nodejs_active_handles` / `nodejs_active_requests`
- `process_cpu_seconds_total` / `process_start_time_seconds`

### 自定义指标

| 指标名称                        | 类型      | 标签                                  | 说明                    |
| ------------------------------- | --------- | ------------------------------------- | ----------------------- |
| `http_request_duration_seconds` | histogram | method, route, status                 | HTTP 请求延迟分布       |
| `http_requests_total`           | counter   | method, route, status                 | HTTP 请求总数           |
| `llm_call_duration_seconds`     | histogram | role, model, status                   | LLM 调用延迟            |
| `llm_tokens_used_total`         | counter   | role, model, type (prompt/completion) | LLM Token 用量          |
| `bullmq_jobs_total`             | counter   | queue, status (completed/failed)      | BullMQ 任务计数         |
| `bullmq_active_jobs`            | gauge     | queue                                 | BullMQ 活跃任务数       |
| `bullmq_waiting_jobs`           | gauge     | queue                                 | BullMQ 等待任务数       |
| `db_query_duration_seconds`     | histogram | operation                             | Prisma 查询延迟（可选） |

### 退役计划

- `ProcessMetricsService` → 被 `prom-client` 默认指标替代，退役并删除
- `SlowRequestInterceptor` → 保留，作为请求级日志补充；Prometheus histogram 覆盖时序聚合需求

## Infrastructure Changes (Phase 1)

### docker-compose.yml 新增

```yaml
prometheus:
  image: prom/prometheus:v3.x-alpine
  container_name: lucent-prometheus
  restart: unless-stopped
  volumes:
    - ./deploy/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro
    - ${LUCENT_SERVER_DIR}/data/prometheus:/prometheus
  ports:
    - '9090:9090' # 仅内网访问，Nginx 不代理

grafana:
  image: grafana/grafana:latest
  container_name: lucent-grafana
  restart: unless-stopped
  env_file:
    - ${LUCENT_SERVER_DIR}/.env.production
  environment:
    GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_ADMIN_PASSWORD}
  volumes:
    - ${LUCENT_SERVER_DIR}/data/grafana:/var/lib/grafana
  ports:
    - '3001:3000' # 仅内网访问
  depends_on:
    - prometheus
```

### 网络隔离

- Prometheus 和 Grafana 端口不暴露到公网
- Nginx 不代理 `/metrics`、`:9090`、`:3001`
- 通过 SSH 隧道访问 Grafana：`ssh -L 3001:localhost:3001 user@server`
- 或配置 Nginx + Basic Auth 保护 Grafana 访问

### 数据持久化

- `${LUCENT_SERVER_DIR}/data/prometheus` — Prometheus 时序数据
- `${LUCENT_SERVER_DIR}/data/grafana` — Grafana 仪表盘和配置

## Consequences

### 变得更容易

- 生产事故定位：通过 Grafana 仪表盘快速查看错误率、延迟分布、资源使用趋势
- 容量规划：基于历史指标数据做数据增长和资源规划决策
- 主动告警：配置 Prometheus alerting rules 在问题影响用户前收到通知
- AI 成本监控：`llm_tokens_used_total` 指标提供 Token 消耗的时序可见性
- 队列健康：BullMQ 队列深度可视化，避免任务静默积压

### 变得更难 / 新增负担

- docker-compose 从 4 容器变为 6 容器，服务器内存需求增加约 200-300MB
- Prometheus 数据目录需要磁盘空间管理（建议设置 `--storage.tsdb.retention.time=15d`）
- Grafana 需要初始仪表盘配置投入（约 1-2 个工作日）
- 单人开发者需要学习 Prometheus PromQL 基础查询语法
- 需要新增环境变量：`GRAFANA_ADMIN_PASSWORD`
- `ProcessMetricsService` 需要重构退役

### 不变

- ~~Pino 结构化日志仍是日志支柱，不做迁移~~ — 已被 [ADR-0007](0007-logging-pino-to-winston.md) 取代，日志框架已迁移至 Winston
- 健康检查端点（live/ready/deep）保持不变
- `SlowRequestInterceptor` 保留作为请求级日志补充
- Docker Compose 部署模型不变（仍为单服务器）
- CI/CD 流程不变

### 未来触发条件

当以下任一条件满足时，应创建新 ADR 重新评估 OpenTelemetry 引入：

1. Lucent 扩展到多实例部署（ROADMAP `v2.0.0` 水平扩展）
2. AI 管道需要 span 级延迟分解（例如 LangGraph 多步 agent 调用链路优化）
3. 系统拆分为多个独立部署的微服务
4. 需要跨服务的请求关联追踪（request correlation across services）
