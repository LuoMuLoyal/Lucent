---
status: active
owner: backend
quadrant: plan
updated: 2026-08-24
---

# Lucent 可观测性迁移计划：Victoria 三件套 + BullMQ OTel span 补全

> 前身：`observability-lightweight-research.md`（调研报告，2026-08-22）。
> 本文件在原调研结论基础上改写为实施计划，聚焦可观测性栈替换和 trace 覆盖补全，
> 不涉及配置格式迁移或部署架构变更。

## 目标

1. **Metrics**：Prometheus + Grafana + exporters → VictoriaMetrics 单机 + vmalert。
2. **Logs**：Winston 文件日志 + `jq` → VictoriaLogs 单机（全文索引 + LogsQL 查询）。
3. **Traces**：Jaeger all-in-one（开发专用）→ VictoriaTraces 单机（生产可用，持久化存储）。
4. **Trace 覆盖补全**：BullMQ Worker + Cron Job 补 OTel span，使异步 job 日志也有 `trace_id`。

## 当前基线

### Metrics

- `deploy/compose.yml` 默认启动 Prometheus（512 MiB）、Grafana（256 MiB）、Postgres exporter、Redis exporter、node exporter（各 128 MiB），合计约 1.15 GiB 内存上限。
- Lucent 应用已在进程内用 `prom-client` 提供 HTTP、Node.js、BullMQ、LLM 等指标，暴露 `/metrics` 端点。
- `deploy/prometheus/rules/lucent.yml` 中应用告警规则只依赖 `job="lucent"`；宿主机规则依赖 `job="node"`。

### Logs

- 生产环境 Winston 双写：stdout JSON（Docker json-file 50MB×5）+ `winston-daily-rotate-file`（500MB/文件，14 天保留）。
- 每行日志在活跃 OTel span 内携带 `trace_id`/`span_id`（`otelTraceFormat`，`trace-context.utils.ts`）。
- **缺口**：BullMQ Worker 处理 job 时不在 HTTP 请求 span 内，日志没有 `trace_id`。Cron Repeatable Job 同理。

### Traces

- `src/tracing.ts` 有 OTel Node SDK + OTLP HTTP exporter，由 `OTEL_ENABLED=true` 门控。
- 开发环境 `docker-compose.dev.yml` 有 Jaeger all-in-one（内存存储，重启丢失）。
- 生产环境无 trace 后端——all-in-one 不适合生产。
- ADR-0010 明确将 BullMQ worker span 列为"非目标"——本计划补全这一缺口。

## 决策

### 1. VictoriaMetrics 单机替代 Prometheus + Grafana

- VictoriaMetrics 单机部署在应用服务器，绑定 `127.0.0.1:8428`，localhost 抓取 `/metrics` 不走公网。
- VMUI 通过 SSH 隧道访问（`ssh -L 8428:127.0.0.1:8428`）。
- `prom-client` 和 `/metrics` 端点不变，VictoriaMetrics 兼容 Prometheus exposition format。
- 需要告警时添加 `vmalert`（同样绑定 localhost）。
- 退役 Prometheus、Grafana、Postgres exporter、Redis exporter。node-exporter 可选保留。

### 2. VictoriaLogs 单机替代文件日志 + jq

- VictoriaLogs 单机部署在应用服务器，绑定 `127.0.0.1:9428`，接收 Winston 推送的日志。
- Winston stdout JSON 通过日志采集器（Vector 或 Fluent-bit）推送到 VictoriaLogs；或直接用 HTTP push。
- 全文索引支持按 `trace_id` 检索整条链路日志——比 `jq` 管道和 Loki 标签模型更适合此场景。
- 退役 `winston-daily-rotate-file`（VictoriaLogs 自带数据保留和压缩）。

### 3. VictoriaTraces 单机替代 Jaeger all-in-one

- VictoriaTraces 单机部署在应用服务器，绑定 `127.0.0.1:9411`，接收 OTLP trace 导出。
- `src/tracing.ts` 的 `OTEL_EXPORTER_OTLP_ENDPOINT` 生产环境指向 `http://127.0.0.1:9411`。
- VictoriaTraces 兼容 Jaeger UI（可作查询前端）和 Grafana datasource。
- 退役 Jaeger all-in-one（`docker-compose.dev.yml` 的 jaeger 服务也可替换为 VictoriaTraces）。

### 4. BullMQ Worker + Cron Job 补 OTel span

- 引入 `bullmq-otel` 包（BullMQ 原生 OTel telemetry 集成）。
- 在 `BullmqQueueFactory.createQueue` 中为 Queue 和 Worker 传入 `telemetry: new BullMQOtel('lucent')`。
- **条件激活**：只在 `OTEL_ENABLED=true` 时传入 telemetry，否则传 `undefined`。
- 补全后 Worker 处理 job 时自动创建 span，日志的 `otelTraceFormat` 能注入 `trace_id`/`span_id`。

### 5. 服务器资源预算（2C4G 应用服务器）

| 组件            | 预估 RAM                         |
| --------------- | -------------------------------- |
| Lucent app      | ~300 MB                          |
| PostgreSQL      | ~300 MB                          |
| Redis           | ~50 MB                           |
| Traefik         | ~50 MB                           |
| VictoriaMetrics | ~200-300 MB                      |
| VictoriaLogs    | ~100-150 MB                      |
| VictoriaTraces  | ~100-150 MB                      |
| OS + Docker     | ~200 MB                          |
| **合计**        | **~1.3-1.5 GB**（4 GB 绰绰有余） |

## 实施步骤

### Phase 1：BullMQ OTel span 补全（代码层，不依赖新基础设施）

1. `pnpm add bullmq-otel`。
2. 修改 `src/common/queue/queue.factory.ts`：在 `new Queue(...)` 和 `new Worker(...)` 时按 `OTEL_ENABLED` 条件传入 `telemetry: new BullMQOtel('lucent')`。
3. 验证：开发环境（`OTEL_ENABLED=true` + Jaeger all-in-one）下，BullMQ Worker 处理 job 时在 Jaeger UI 中可见 span，日志中有 `trace_id`。
4. 覆盖范围验证：
   - 餐食分析 worker 日志有 `trace_id`。
   - 邮件队列 worker 日志有 `trace_id`。
   - 建议重算 worker 日志有 `trace_id`。
   - 今日分析 worker 日志有 `trace_id`。
   - Cron Repeatable Job（data-retention、lifecycle、reminder-dispatch、weekly-insight）日志有 `trace_id`。
   - Worker 错误日志（`worker.on('failed')`）有 `trace_id`。

### Phase 2：VictoriaMetrics 部署 + Prometheus/Grafana 退役

1. 在应用服务器部署 VictoriaMetrics 单机，绑定 `127.0.0.1:8428`。
2. 配置 scrape targets：`localhost:3000`（Lucent app），可选 `localhost:9100`（node-exporter）。
3. 从 `deploy/prometheus/rules/lucent.yml` 迁移告警规则到 vmalert 规则文件。
4. 停止 Prometheus、Grafana、Postgres exporter、Redis exporter 容器。
5. 验证：VMUI 可查询核心指标（应用 up、5xx、延迟、BullMQ、event loop）。vmalert 规则触发正确。
6. 删除 `deploy/prometheus/`、`deploy/grafana/`、`deploy/alertmanager/`。

### Phase 3：VictoriaLogs 部署 + 文件日志精简

1. 在应用服务器部署 VictoriaLogs 单机，绑定 `127.0.0.1:9428`。
2. 配置日志采集：Vector 或 Fluent-bit 读取 Winston stdout JSON，推送到 VictoriaLogs。
3. 配置数据保留策略（建议 30 天）。
4. 验证：VictoriaLogs Web UI 可按 `trace_id` 检索整条链路日志（HTTP 请求 + BullMQ worker）。
5. 精简 Winston 文件日志：退役 `winston-daily-rotate-file`（VictoriaLogs 承担长期存储和检索）。
6. Docker json-file 驱动保留（`docker logs` 临时查看），但可降低轮转上限（如 10MB×3）。

### Phase 4：VictoriaTraces 部署 + Jaeger 退役

1. 在应用服务器部署 VictoriaTraces 单机，绑定 `127.0.0.1:9411`。
2. 生产环境 `OTEL_EXPORTER_OTLP_ENDPOINT` 指向 `http://127.0.0.1:9411`。
3. 验证：VictoriaTraces Web UI（或 Jaeger UI 前端）可查询 trace 瀑布，包括 BullMQ worker span。
4. 开发环境 `docker-compose.dev.yml` 的 Jaeger all-in-one 可替换为 VictoriaTraces 单机（统一开发/生产环境）。
5. 验证 SSH 隧道访问：`ssh -L 9411:127.0.0.1:9411 user@app-server`。

### Phase 5：文档更新

- `docs/01-reference/environment-variables.md`：更新 `OTEL_EXPORTER_OTLP_ENDPOINT` 默认值说明。
- ADR-0006：标注监控栈部分被取代（Prometheus + Grafana → VictoriaMetrics）。
- ADR-0010：标注 Jaeger all-in-one 被 VictoriaTraces 替代，BullMQ worker span 补全。
- 当日迁移日志。

## 验证矩阵

### BullMQ span 补全

- [ ] `OTEL_ENABLED=true` 时 Queue 入队产生 producer span。
- [ ] `OTEL_ENABLED=true` 时 Worker 处理 job 产生 consumer span。
- [ ] 入队和消费在同进程时 span 有 parent-child 关系。
- [ ] Cron Repeatable Job 产生独立 root span。
- [ ] Worker 处理 job 期间的日志有 `trace_id`/`span_id`。
- [ ] Worker 失败时的错误日志有 `trace_id`。
- [ ] `OTEL_ENABLED=false` 时不传 telemetry，行为不变。

### VictoriaMetrics

- [ ] VictoriaMetrics 单机成功在 localhost 抓取应用 `/metrics`。
- [ ] VMUI 可查询核心指标（应用 up、5xx、延迟、BullMQ、event loop）。
- [ ] `vmalert` 规则触发正确（如启用）。
- [ ] VictoriaMetrics 只绑定 `127.0.0.1:8428`，不暴露到公网。
- [ ] VMUI 通过 SSH 隧道访问成功。
- [ ] 旧 Prometheus / Grafana / exporter 容器已停止且不影响应用。

### VictoriaLogs

- [ ] VictoriaLogs 成功接收 Winston 日志。
- [ ] Web UI 可按 `trace_id` 检索单个请求的完整日志链（HTTP + worker）。
- [ ] 可按 level、context、queue name 等维度过滤。
- [ ] 数据保留策略生效。
- [ ] VictoriaLogs 只绑定 `127.0.0.1:9428`，不暴露到公网。

### VictoriaTraces

- [ ] VictoriaTraces 成功接收 OTLP trace 导出。
- [ ] Web UI 可查询 trace 瀑布，包括 HTTP span + BullMQ worker span。
- [ ] 数据持久化到磁盘（重启不丢）。
- [ ] VictoriaTraces 只绑定 `127.0.0.1:9411`，不暴露到公网。
- [ ] 旧 Jaeger all-in-one 容器已停止。

## 风险与回退

- **VictoriaLogs/VictoriaTraces 产品较新**：社区不如 Loki/Jaeger 成熟。回退方式：VictoriaLogs → 恢复 Winston 文件日志；VictoriaTraces → 恢复 Jaeger（生产用 Badger 存储模式）。
- **BullMQ OTel span 增加开销**：span 创建和导出有少量 CPU/内存开销。`OTEL_ENABLED=false` 可完全关闭。
- **Vector/Fluent-bit 日志采集链路**：新增一个日志采集进程。回退方式：直接用 Winston HTTP transport 推送到 VictoriaLogs。
- **三件套统一访问**：三个服务都绑 localhost，需三个 SSH 隧道分别访问。可写一个 `ssh -L 8428:127.0.0.1:8428 -L 9428:127.0.0.1:9428 -L 9411:127.0.0.1:9411 user@server` 一键转发。
