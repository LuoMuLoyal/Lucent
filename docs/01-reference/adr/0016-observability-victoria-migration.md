# ADR-0016: Observability Stack Migration — VictoriaMetrics + VictoriaLogs + VictoriaTraces

- **Status**: accepted
- **Date**: 2026-08-24
- **Deciders**: LuoMuLoyal
- **Supersedes in part**: [ADR-0006](0006-observability-strategy.md)（监控栈：Prometheus + Grafana → VictoriaMetrics 单机）；[ADR-0010](0010-otel-tracing.md)（trace 后端：Jaeger all-in-one → VictoriaTraces 单机；BullMQ worker span 从"非目标"变为"补全"）

## Context

当前可观测性栈存在三个问题：

1. **监控栈过重**：Prometheus + Grafana + exporters 占约 1.15 GB，对单机资源造成压力。
2. **日志检索能力弱**：Winston 文件日志只能 `jq` 管道检索，无法按 `trace_id` 做全文搜索；异步 job 日志没有 `trace_id`（BullMQ Worker 不在 OTel span 内）。
3. **Trace 后端不适合生产**：Jaeger all-in-one 内存存储重启即丢，只在开发环境可用。

## Decision

### 1. VictoriaMetrics 单机替代 Prometheus + Grafana

- 部署在应用服务器，绑定 `127.0.0.1:8428`，localhost 抓取 `/metrics` 不走公网。
- `prom-client` 和 `/metrics` 端点不变。需要告警时添加 `vmalert`。

### 2. VictoriaLogs 单机替代文件日志 + jq

- 部署在应用服务器，绑定 `127.0.0.1:9428`。
- 全文索引支持按 `trace_id` 检索整条链路日志。
- 退役 `winston-daily-rotate-file`。

### 3. VictoriaTraces 单机替代 Jaeger all-in-one

- 部署在应用服务器，绑定 `127.0.0.1:9411`，接收 OTLP trace 导出。
- 数据持久化到磁盘，生产可用。

### 4. BullMQ Worker + Cron Job 补 OTel span

- 引入 `bullmq-otel` 包，在 `BullmqQueueFactory` 中为 Queue 和 Worker 传入 telemetry。
- 由 `OTEL_ENABLED=true` 门控，默认关闭零侵入。
- 补全后异步 job 日志也有 `trace_id`/`span_id`。

## Options Considered

| Option                   | Pros                                                                    | Cons                                                      |
| ------------------------ | ----------------------------------------------------------------------- | --------------------------------------------------------- |
| **VictoriaLogs**（选定） | 全文索引，按 `trace_id` 查日志高效；与 VictoriaMetrics 同生态，单二进制 | 2024 年发布，社区较新                                     |
| Loki                     | Grafana 生态成熟，社区大                                                | 标签索引模型，`trace_id` 高基数不能做 label；资源占用更高 |

| Option                     | Pros                                     | Cons                                  |
| -------------------------- | ---------------------------------------- | ------------------------------------- |
| **VictoriaTraces**（选定） | 与 VM/VLogs 同生态，单二进制，持久化存储 | 2025 年发布，社区新                   |
| Jaeger + Badger            | 嵌入式持久化，Jaeger 生态成熟            | 仍是 all-in-one 变体，不适合长期留存  |
| Jaeger + ES/Cassandra      | 生产级，可扩展                           | ES/Cassandra 本身重，对 2C4G 不可接受 |
| 生产关闭 trace             | 零运维负担                               | 失去 span 瀑布能力                    |

## Consequences

### 变得更容易

- Metrics/Logs/Traces 三个支柱统一为 Victoria 生态，部署模式和运维心智模型一致。
- 日志可按 `trace_id` 全文检索整条链路（HTTP 请求 + BullMQ worker）。
- 异步 job 日志补全 `trace_id`，与请求日志可关联。
- 资源释放：VictoriaMetrics（~300 MB）替代 Prometheus + Grafana（~1.15 GB）。

### 变得更难 / 新增负担

- VictoriaLogs/VictoriaTraces 产品较新，社区不如 Loki/Jaeger 成熟。
- 需引入 `bullmq-otel` 依赖，BullMQ Worker span 有少量 CPU/内存开销。
- 日志采集需新增 Vector 或 Fluent-bit 进程。
- 三个服务都绑 localhost，需 SSH 隧道访问。

### 不变

- `prom-client` 和 `/metrics` 端点不变。
- OTel SDK 和 `src/tracing.ts` 的门控机制不变。
- Winston 日志框架不变，`otelTraceFormat` 注入逻辑不变。

## Cross-References

- 实施计划：`plans/2026-08-24-observability-victoria-migration-plan.md`
- ADR-0006：可观测性策略（监控栈部分被取代）
- ADR-0010：OTel tracing（trace 后端和 BullMQ span 部分被取代）
