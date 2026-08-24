# ADR-0006: Observability Strategy — prom-client + Prometheus/Grafana, Defer OpenTelemetry

- **Status**: accepted
- **Date**: 2026-07-09
- **Deciders**: LuoMuLoyal
- **Superseded in part**: 「明确推迟 OpenTelemetry / 分布式追踪」章节已被
  [ADR-0010](0010-otel-tracing.md) 取代（AI 管道 span 级调试触发条件已满足）；
  Phase 1 监控栈（Prometheus + Grafana）已被
  [ADR-0016](0016-observability-victoria-migration.md) 取代（VictoriaMetrics 单机）；
  prom-client 指标策略继续有效。

## Context

Lucent 即将进入 `v1.0.0` 稳定发布阶段，ROADMAP 将 "Production observability (metrics, dashboards,
alerting)" 列为首要任务。当前可观测性现状：Pino 结构化 JSON 日志，`ProcessMetricsService` 每 5 分钟将
rss/heap/uptime 写入日志流（workaround），无时间序列数据、无仪表盘、无告警。

项目约束：单服务器 Docker Compose（无 Kubernetes），单人开发者，个人健康管理助手（非高并发），单 Node.js
进程，AI 管道重度依赖外部 LLM API（SSE 流式），BullMQ 异步任务。

## Decision

采用 **分阶段可观测性策略**：

### Phase 1（v1.0.0）：prom-client + Prometheus + Grafana

1. 引入 `prom-client`（Node.js 标准 Prometheus 客户端库）在 Lucent 进程内采集指标
2. 暴露 `/metrics` 端点供 Prometheus scrape
3. 在 `docker-compose.yml` 中新增 `prometheus` 和 `grafana` 两个容器
4. 配置 Grafana 仪表盘：HTTP 请求延迟/错误率、Node.js 进程指标、BullMQ 队列深度、AI 调用延迟/Token
5. 配置基础告警规则：5xx 错误率、健康检查失败、内存泄漏趋势、队列积压

### 明确推迟 OpenTelemetry / 分布式追踪

在以下触发条件之一满足时重新评估 OpenTelemetry 引入：

- 水平扩展到多实例部署（ROADMAP `v2.0.0`）
- AI 管道延迟调试需要 span 级可见性（例如 LLM → RAG → 工具调用链路的分段耗时）
- 系统拆分为多个独立部署的服务

## Options Considered

| Option                                                         | Pros                                                                                               | Cons                                                                                                     |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 全量 OpenTelemetry SDK + OTLP Collector + Prometheus + Grafana | 一步到位，metrics + traces 统一管线                                                                | 单进程应用无分布式调用，traces 价值接近零；Collector 是额外基础设施；6+ 个新 npm 依赖；当前阶段 ROI 极低 |
| **prom-client + Prometheus + Grafana（选定方案）**             | prom-client 是 Node.js 生态最成熟的指标库；仅 1 个新 npm 依赖；行业事实标准；未来可平滑迁移到 OTel | 不提供分布式追踪能力（单进程场景不需要）；docker-compose 增加 2 个容器（约 200-300MB）                   |
| 仅增强 Pino 日志 + 外部日志分析                                | 零新基础设施，零新依赖                                                                             | 无法做实时时序聚合和告警；日志流不是时序数据库，范围查询效率极差                                         |
| 推迟所有可观测性投入                                           | 最大化产品功能开发时间                                                                             | 生产事故时完全盲飞，MTTR 极高；与 ROADMAP v1.0.0 目标矛盾                                                |

## Consequences

- 生产事故定位：通过 Grafana 仪表盘快速查看错误率、延迟分布、资源使用趋势
- 容量规划：基于历史指标数据做数据增长和资源规划决策
- 主动告警：配置 Prometheus alerting rules 在问题影响用户前收到通知
- docker-compose 从 4 容器变为 6 容器，服务器内存需求增加约 200-300MB
- `ProcessMetricsService` 被 `prom-client` 默认指标替代，退役并删除
- 未来迁移路径：prom-client → OTLP exporter → Prometheus + Tempo，Grafana 仪表盘无需迁移
