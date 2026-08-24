---
status: active
owner: backend
quadrant: plan
updated: 2026-08-24
---

# Lucent 可观测性迁移计划：VictoriaMetrics + Grafana 保留 + VictoriaLogs + BullMQ OTel span 补全

> 前身：`observability-lightweight-research.md`（调研报告，2026-08-22）。
> 本文件在原调研结论基础上改写为实施计划，聚焦可观测性栈替换和 trace 覆盖补全，
> 不涉及配置格式迁移或部署架构变更。

## 目标

1. **Metrics**：Prometheus → VictoriaMetrics 单机 + vmalert。**Grafana 保留**，datasource URL 改指向 VM。
2. **Logs**：Winston 文件日志 + `jq` → VictoriaLogs 单机（全文索引 + LogsQL 查询）。
3. **Traces**：生产环境不部署 trace 后端（OTel SDK 仍启动，日志注入 `trace_id`）；开发环境维持 Jaeger all-in-one。
4. **Trace 覆盖补全**：BullMQ Worker + Cron Job 补 OTel span，使异步 job 日志也有 `trace_id`。

## 当前基线

### Metrics

- `deploy/compose.yml` 默认启动 Prometheus（512 MiB）、Grafana（256 MiB）、Postgres exporter、Redis exporter、node exporter（各 128 MiB），合计约 1.15 GiB 内存上限。
- Lucent 应用已在进程内用 `prom-client` 提供 HTTP、Node.js、BullMQ、LLM 等指标，暴露 `/metrics` 端点。
- `deploy/prometheus/rules/lucent.yml` 中应用告警规则只依赖 `job="lucent"`；宿主机规则依赖 `job="node"`。
- Grafana dashboard `lucent-backend-overview.json` 有 14 个 panel（4 stat + 10 timeseries），覆盖请求速率、5xx、延迟 P50/P95/P99、Node.js 内存、BullMQ 队列、GC、LLM 调用/token 等。VMUI 无法替代此面板能力。

### Logs

- 生产环境 Winston 双写：stdout JSON（Docker json-file 50MB×5）+ `winston-daily-rotate-file`（500MB/文件，14 天保留）。
- 每行日志在活跃 OTel span 内携带 `trace_id`/`span_id`（`otelTraceFormat`，`trace-context.utils.ts`）。
- **缺口**：BullMQ Worker 处理 job 时不在 HTTP 请求 span 内，日志没有 `trace_id`。Cron Repeatable Job 同理。

### Traces

- `src/tracing.ts` 有 OTel Node SDK + OTLP HTTP exporter，由 `OTEL_ENABLED=true` 门控。
- 开发环境 `docker-compose.dev.yml` 有 Jaeger all-in-one（内存存储，重启丢失）。
- 生产环境无 trace 后端——all-in-one 不适合生产，VictoriaTraces 仍为 prerelease 不具备生产可用性。
- ADR-0010 明确将 BullMQ worker span 列为"非目标"——本计划补全这一缺口。

## 决策

### 1. VictoriaMetrics 单机替代 Prometheus，Grafana 保留

- VictoriaMetrics 单机部署在应用服务器，绑定 `127.0.0.1:8428`，localhost 抓取 `/metrics` 不走公网。
- VMUI 通过 SSH 隧道访问（`ssh -L 8428:127.0.0.1:8428`），但日常监控使用 Grafana。
- `prom-client` 和 `/metrics` 端点不变，VictoriaMetrics 兼容 Prometheus exposition format。
- 需要告警时添加 `vmalert`（同样绑定 localhost）。
- **Grafana 保留**：datasource provisioning 中 URL 从 `http://prometheus:9090` 改为 `http://victoriametrics:8428`，dashboard JSON 零迁移。
- **退役**：Prometheus、Postgres exporter、Redis exporter。node-exporter 可选保留（宿主机磁盘/CPU/证书指标）。

### 2. VictoriaLogs 单机替代文件日志 + jq

- VictoriaLogs 单机部署在应用服务器，绑定 `127.0.0.1:9428`，接收 Winston 推送的日志。
- Winston stdout JSON 通过日志采集器（Vector 或 Fluent-bit）推送到 VictoriaLogs；或直接用 HTTP push。
- 全文索引支持按 `trace_id` 检索整条链路日志——比 `jq` 管道和 Loki 标签模型更适合此场景。
- 退役 `winston-daily-rotate-file`（VictoriaLogs 自带数据保留和压缩）。

### 3. 生产环境不部署 trace 后端

- **生产环境**：不部署任何 trace 后端容器。`OTEL_ENABLED=true` 时 OTel SDK 仍然启动，span 在内存中产生，日志通过 `getActiveTraceIds()` 注入 `trace_id`/`span_id`。OTLP exporter 发送失败静默丢弃，不影响应用。
- VictoriaLogs 按 `trace_id` 检索整条链路日志覆盖 90% 日常排障场景。LLM 调用耗时在 Grafana metrics panel（"LLM Call Duration P95 by Model"）和日志结构化字段中均有。
- **开发环境**：维持 `docker-compose.dev.yml` 的 Jaeger all-in-one（内存存储），需要 trace 瀑布图排查 LLM 管道延迟时使用。
- **未来扩展**：若生产环境需要 trace 瀑布图，加 Jaeger all-in-one + Badger 存储即可（`--storage.type=badger` + 磁盘 volume），代码零改动，只加一个容器（~100-150 MB）。

### 4. BullMQ Worker + Cron Job 补 OTel span

- 引入 `bullmq-otel` 包（BullMQ 原生 OTel telemetry 集成）。
- 在 `BullmqQueueFactory.createQueue` 中为 Queue 和 Worker 传入 `telemetry: new BullMQOtel('lucent')`。
- **条件激活**：只在 `OTEL_ENABLED=true` 时传入 telemetry，否则传 `undefined`。
- 补全后 Worker 处理 job 时自动创建 span，日志的 `otelTraceFormat` 能注入 `trace_id`/`span_id`。
- 这是生产环境无 trace 后端时仍需 `OTEL_ENABLED=true` 的核心原因——span 本身在内存中存在即可注入日志，不需要导出到后端。

### 5. 服务器资源预算（2C4G 应用服务器）

| 组件            | 预估 RAM                     |
| --------------- | ---------------------------- |
| Lucent app      | ~300 MB                      |
| PostgreSQL      | ~300 MB                      |
| Redis           | ~50 MB                       |
| Traefik         | ~50 MB                       |
| VictoriaMetrics | ~200-300 MB                  |
| Grafana         | ~256 MB                      |
| VictoriaLogs    | ~100-150 MB                  |
| node-exporter   | ~128 MB（可选）              |
| OS + Docker     | ~200 MB                      |
| **合计**        | **~1.6-1.8 GB**（4 GB 充裕） |

> 对比原方案（Prometheus + Grafana + exporters ≈ 1.15 GB + app/PG/Redis ≈ 650 MB ≈ 1.8 GB），
> 新方案在增加 VictoriaLogs 的同时总量基本持平，且 Grafana dashboard 能力完整保留。

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

### Phase 2：VictoriaMetrics 部署 + Prometheus/exporter 退役（Grafana 保留）

1. 在应用服务器部署 VictoriaMetrics 单机，绑定 `127.0.0.1:8428`。
2. 配置 scrape targets：`localhost:3000`（Lucent app），可选 `localhost:9100`（node-exporter）。
3. 从 `deploy/prometheus/rules/lucent.yml` 迁移告警规则到 vmalert 规则文件（语法兼容，只需调整 `job` label）。
4. 修改 `deploy/grafana/provisioning/datasources/prometheus.yml`：URL 从 `http://prometheus:9090` 改为 `http://victoriametrics:8428`。
5. 停止 Prometheus、Postgres exporter、Redis exporter 容器。Grafana 保留不动。
6. 验证：Grafana dashboard 所有 panel 正常显示数据（datasource 已切到 VM）。vmalert 规则触发正确。
7. 删除 `deploy/prometheus/`、`deploy/alertmanager/`。**保留 `deploy/grafana/`**。

### Phase 3：VictoriaLogs 部署 + 文件日志精简

1. 在应用服务器部署 VictoriaLogs 单机，绑定 `127.0.0.1:9428`。
2. 配置日志采集：Vector 或 Fluent-bit 读取 Winston stdout JSON，推送到 VictoriaLogs。
3. 配置数据保留策略（建议 30 天）。
4. 验证：VictoriaLogs Web UI 可按 `trace_id` 检索整条链路日志（HTTP 请求 + BullMQ worker）。
5. 精简 Winston 文件日志：退役 `winston-daily-rotate-file`（VictoriaLogs 承担长期存储和检索）。
6. Docker json-file 驱动保留（`docker logs` 临时查看），但可降低轮转上限（如 10MB×3）。

### Phase 4：生产环境 trace 策略确认（不部署 trace 后端）

1. 确认生产环境 `OTEL_ENABLED=true`（保证 OTel SDK 启动，日志注入 `trace_id`）。
2. 确认生产环境 `OTEL_EXPORTER_OTLP_ENDPOINT` 指向的地址无 trace 后端监听——exporter 发送失败静默丢弃，不影响应用。
3. 验证：VictoriaLogs 按 `trace_id` 检索生产日志，能看到 HTTP 请求 + BullMQ worker 的完整链路日志。
4. 验证：开发环境 Jaeger all-in-one 仍可用于 trace 瀑布图排查（`docker-compose.dev.yml` 不变）。
5. **未来扩展路径**（本期不实施）：若需生产 trace 瀑布图，加 Jaeger all-in-one + Badger 存储（`--storage.type=badger` + `--badger.directory-value=/data` + volume 挂载），绑 `127.0.0.1:4318`（OTLP）+ `127.0.0.1:16686`（UI），代码零改动。

### Phase 5：文档更新

- `docs/01-reference/environment-variables.md`：更新 `OTEL_EXPORTER_OTLP_ENDPOINT` 说明（生产无后端，开发指向 Jaeger 4318）。
- ADR-0006：标注 Prometheus 被 VictoriaMetrics 取代，Grafana 保留。
- ADR-0010：标注 BullMQ worker span 补全；trace 后端策略修正为"生产不部署，开发维持 Jaeger"。
- ADR-0016：已更新（本计划同步）。
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

### VictoriaMetrics + Grafana

- [ ] VictoriaMetrics 单机成功在 localhost 抓取应用 `/metrics`。
- [ ] Grafana dashboard 所有 14 个 panel 正常显示数据（datasource 已切到 VM）。
- [ ] `vmalert` 规则触发正确（如启用）。
- [ ] VictoriaMetrics 只绑定 `127.0.0.1:8428`，不暴露到公网。
- [ ] 旧 Prometheus / Postgres exporter / Redis exporter 容器已停止且不影响应用。
- [ ] Grafana 容器不受影响，dashboard provisioning 正常。

### VictoriaLogs

- [ ] VictoriaLogs 成功接收 Winston 日志。
- [ ] Web UI 可按 `trace_id` 检索单个请求的完整日志链（HTTP + worker）。
- [ ] 可按 level、context、queue name 等维度过滤。
- [ ] 数据保留策略生效。
- [ ] VictoriaLogs 只绑定 `127.0.0.1:9428`，不暴露到公网。

### Trace 策略

- [ ] 生产环境 `OTEL_ENABLED=true`，日志中有 `trace_id`/`span_id`。
- [ ] 生产环境无 trace 后端容器运行。
- [ ] VictoriaLogs 可按 `trace_id` 检索生产链路日志。
- [ ] 开发环境 Jaeger all-in-one 不变，trace 瀑布图正常可用。

## 风险与回退

- **VictoriaLogs 产品较新**：社区不如 Loki/Jaeger 成熟。回退方式：恢复 Winston 文件日志。
- **BullMQ OTel span 增加开销**：span 创建和导出有少量 CPU/内存开销。`OTEL_ENABLED=false` 可完全关闭。
- **Vector/Fluent-bit 日志采集链路**：新增一个日志采集进程。回退方式：直接用 Winston HTTP transport 推送到 VictoriaLogs。
- **生产无 trace 瀑布图**：需要 span 级延迟分解时，用开发环境 Jaeger 复现；或加 Jaeger + Badger 容器（~100-150 MB，代码零改动）。
- **Grafana + VM 双容器**：两个服务都绑 localhost，需 SSH 隧道访问。可写一个 `ssh -L 8428:127.0.0.1:8428 -L 3001:127.0.0.1:3001 -L 9428:127.0.0.1:9428 user@server` 一键转发。
