# ADR-0016: Observability Stack Migration — VictoriaMetrics + VictoriaLogs + Grafana 保留 + 生产 Trace 后端可选

- **Status**: accepted
- **Date**: 2026-08-24
- **Deciders**: LuoMuLoyal
- **Supersedes in part**: [ADR-0006](0006-observability-strategy.md)（监控栈：Prometheus → VictoriaMetrics 单机；Grafana 保留）；[ADR-0010](0010-otel-tracing.md)（BullMQ worker span 从"非目标"变为"补全"；trace 后端策略修正见下方 Decision 3）

## Context

当前可观测性栈存在三个问题：

1. **监控栈过重**：Prometheus + Grafana + exporters 占约 1.15 GB，对单机资源造成压力。其中 Prometheus（512 MB）和两个 exporter（各 128 MB）是主要开销；Grafana（256 MB）承担可视化面板，不可替代。
2. **日志检索能力弱**：Winston 文件日志只能 `jq` 管道检索，无法按 `trace_id` 做全文搜索；异步 job 日志没有 `trace_id`（BullMQ Worker 不在 OTel span 内）。
3. **Trace 后端不适合生产**：Jaeger all-in-one 内存存储重启即丢，只在开发环境可用；VictoriaTraces 仍为 prerelease，不具备生产可用性。

## Decision

### 1. VictoriaMetrics 单机替代 Prometheus，Grafana 保留

- VictoriaMetrics 单机部署在应用服务器，绑定 `127.0.0.1:8428`，localhost 抓取 `/metrics` 不走公网。
- `prom-client` 和 `/metrics` 端点不变。需要告警时添加 `vmalert`。
- **Grafana 保留**：datasource URL 从 `http://prometheus:9090` 改为 `http://victoriametrics:8428`，现有 dashboard JSON 零迁移。VMUI 查询能力弱于 Grafana，14 panel 的 dashboard（含阈值着色、P50/P95/P99 分位、LLM token 用量、BullMQ 队列深度等）需要 Grafana 的多 panel 并排对比和变量模板能力。
- **退役清单**：Prometheus、Postgres exporter、Redis exporter。node-exporter 可选保留（宿主机磁盘/CPU 指标）。Alertmanager 由 vmalert 替代。
- 内存预算：VictoriaMetrics ~250 MB + Grafana 256 MB + node-exporter 128 MB ≈ 634 MB（原 Prometheus + Grafana + exporters ≈ 1.15 GB，净省 ~500 MB）。

### 2. VictoriaLogs 单机替代文件日志 + jq

- 部署在应用服务器，绑定 `127.0.0.1:9428`。
- 全文索引支持按 `trace_id` 检索整条链路日志。
- 退役 `winston-daily-rotate-file`。

### 3. 生产环境不部署 trace 后端，开发环境维持 Jaeger all-in-one

- **生产环境**：不部署任何 trace 后端容器。`OTEL_ENABLED=true` 时 OTel SDK 仍然启动，span 在内存中产生，日志通过 `getActiveTraceIds()` 注入 `trace_id`/`span_id`。OTLP exporter 发送失败静默丢弃，不影响应用。VictoriaLogs 按 `trace_id` 检索整条链路日志覆盖 90% 日常排障场景；LLM 调用耗时在 Grafana metrics panel 和日志结构化字段中均有。
- **开发环境**：维持 `docker-compose.dev.yml` 的 Jaeger all-in-one（内存存储），需要 trace 瀑布图排查 LLM 管道延迟时使用。
- **未来扩展**：若生产环境需要 trace 瀑布图，加 Jaeger all-in-one + Badger 存储即可（`--storage.type=badger`），代码零改动，只加一个容器（~100-150 MB）。VictoriaTraces 因仍为 prerelease，不作为选项。

### 4. BullMQ Worker + Cron Job 补 OTel span

- 引入 `bullmq-otel` 包，在 `BullmqQueueFactory` 中为 Queue 和 Worker 传入 telemetry。
- 由 `OTEL_ENABLED=true` 门控，默认关闭零侵入。
- 补全后异步 job 日志也有 `trace_id`/`span_id`——这是生产环境无 trace 后端时仍需 `OTEL_ENABLED=true` 的核心原因。

## Options Considered

### Metrics 可视化

| Option                                     | Pros                                | Cons                                                           |
| ------------------------------------------ | ----------------------------------- | -------------------------------------------------------------- |
| **VictoriaMetrics + Grafana 保留**（选定） | dashboard 零迁移，14 panel 完整保留 | Grafana 256 MB 不可省                                          |
| VictoriaMetrics + VMUI（砍 Grafana）       | 省 256 MB                           | VMUI 查询能力弱，多 panel 对比/阈值着色/变量模板缺失；得不偿失 |

### Trace 后端

| Option                            | Pros                                                     | Cons                                           |
| --------------------------------- | -------------------------------------------------------- | ---------------------------------------------- |
| **生产不部署 trace 后端**（选定） | 零容器开销；日志 `trace_id` + VictoriaLogs 覆盖 90% 排障 | 生产无 trace 瀑布图；需复现时用开发环境 Jaeger |
| Jaeger + Badger                   | 嵌入式持久化，Jaeger 生态成熟                            | 额外 ~100-150 MB 容器；当前非刚需              |
| VictoriaTraces                    | 与 VM/VLogs 同生态                                       | prerelease，不具备生产可用性                   |
| Jaeger + ES/Cassandra             | 生产级，可扩展                                           | ES/Cassandra 本身重，对 2C4G 不可接受          |

### Logs

| Option                   | Pros                                                                    | Cons                                                      |
| ------------------------ | ----------------------------------------------------------------------- | --------------------------------------------------------- |
| **VictoriaLogs**（选定） | 全文索引，按 `trace_id` 查日志高效；与 VictoriaMetrics 同生态，单二进制 | 2024 年发布，社区较新                                     |
| Loki                     | Grafana 生态成熟，社区大                                                | 标签索引模型，`trace_id` 高基数不能做 label；资源占用更高 |

## Consequences

### 变得更容易

- 监控栈轻量化：VictoriaMetrics + Grafana + node-exporter ≈ 634 MB，替代原 Prometheus + Grafana + exporters ≈ 1.15 GB。
- 日志可按 `trace_id` 全文检索整条链路（HTTP 请求 + BullMQ worker）。
- 异步 job 日志补全 `trace_id`，与请求日志可关联。
- Grafana dashboard 完整保留，datasource 只改一行 URL。

### 变得更难 / 新增负担

- VictoriaLogs 产品较新，社区不如 Loki 成熟。
- 需引入 `bullmq-otel` 依赖，BullMQ Worker span 有少量 CPU/内存开销。
- 日志采集需新增 Vector 或 Fluent-bit 进程。
- 生产环境无 trace 瀑布图——需要 span 级延迟分解时，用开发环境 Jaeger 复现。

### 不变

- `prom-client` 和 `/metrics` 端点不变。
- OTel SDK 和 `src/tracing.ts` 的门控机制不变。
- Winston 日志框架不变，`otelTraceFormat` 注入逻辑不变。
- 开发环境 Jaeger all-in-one 不变。

## Cross-References

- 实施计划:已完成,按计划生命周期删除;过程见迁移日志 2026-08-24 条目
- ADR-0006：可观测性策略（Prometheus 被取代，Grafana 保留）
- ADR-0010：OTel tracing（BullMQ worker span 部分被取代；trace 后端策略修正为本 ADR Decision 3）
