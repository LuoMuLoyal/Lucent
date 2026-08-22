---
status: active
owner: backend
quadrant: reference
updated: 2026-08-22
---

# Lucent 轻量化可观测性调研

> 调研日期：2026-08-22（Asia/Shanghai）。
>
> 目标不是从 Prometheus、Grafana、exporter、OTel 或某个云厂商中机械地选一个，而是减少
> 单服务器 Docker Compose 上可观测性对应用资源和单人运维的占用，同时保留能够直接影响
> 故障定位和告警的信号。

## 结论摘要

当前最合理的目标不是“再部署一个全家桶”，而是把本地可观测性压缩成以下两种形态之一：

1. **成本敏感、自托管优先：VictoriaMetrics 单机 + Lucent 应用指标，Grafana 和大部分 exporter 退役。**
   VictoriaMetrics 单机版支持 Prometheus exporter 抓取、remote_write、Prometheus 查询 API 和
   自带 VMUI；现有 `prom-client` 的 `/metrics` 合同可以继续使用。只保留 `node-exporter`
   作为宿主机磁盘/证书告警的数据源，或者把这部分交给云监控。需要本地规则告警时再增加
   `vmalert`，而不是默认恢复完整 Grafana 栈。
2. **资源压力优先、可以接受服务费：本机只保留一个 Alloy 或 Prometheus Agent，指标/日志/trace
   发送到托管后端。** 例如腾讯云 APM + 托管 Prometheus/CLS、阿里云 ARMS，或 Grafana Cloud。
   这条路线能最大限度释放本机资源，但成本从机器内存转移到数据写入量、保留期、agent-hour、
   出网和厂商绑定，不能假设一定更便宜。

**我的建议：先按第 1 条作为 Lucent 的默认目标，按第 2 条作为资源极紧或不想维护存储时的替代。**
短期先做“只保留应用指标 + 可选宿主机指标”的止血改动；完成一轮有代表性的负载测量后，再在
VictoriaMetrics 单机和托管后端之间定案。仅保留 trace 不能替代 HTTP 错误率、延迟趋势、BullMQ
积压、磁盘和证书告警，因此不建议把 trace-only 当作完整替代。

## 当前 Lucent 基线

以下是仓库事实，不是外部资料推断：

- 生产 `Lucent/deploy/compose.yml` 默认启动 Prometheus、Grafana、Postgres exporter、Redis
  exporter 和 node exporter；Alertmanager 通过 `alerting` profile 启用。
- 配置的资源上限分别是 Prometheus 512 MiB / 1 CPU、Grafana 256 MiB / 0.5 CPU，三个 exporter
  各 128 MiB / 0.25 CPU。默认监控侧的上限合计约 **1.15 GiB 内存、2.25 CPU**；这只是 Compose
  资源上限，不是实测常驻占用。Alertmanager 还会额外增加 128 MiB / 0.25 CPU 的上限。
- `deploy/prometheus/prometheus.yml` 每 15 秒抓取四类 target：Lucent 应用、Postgres exporter、
  Redis exporter、node exporter。
- Lucent 应用已经在进程内用 `prom-client` 提供 HTTP、Node.js、BullMQ、LLM 等指标；应用指标
  不需要通过 Postgres/Redis exporter 才能保留。
- `deploy/prometheus/rules/lucent.yml` 中，应用可用性、5xx、BullMQ 和 event loop 规则只依赖
  `job="lucent"`；宿主机磁盘和证书规则依赖 `job="node"`。移除 exporter 前必须同步删除或
  替换对应 scrape target 和告警规则。
- `src/tracing.ts` 已有 OTel Node SDK 和 OTLP HTTP trace exporter，由 `OTEL_ENABLED=true` 门控；
  现有代码显式配置 endpoint，但没有在这里显式配置云厂商认证 header。迁移到云端时要补齐
  secret/header/重试与失败降级验证，不能只替换 URL。
- 当前开发 Compose 有 Jaeger，生产 Compose 的主观测栈仍是 Prometheus/Grafana/exporters；
  当前工作区运行中的 Docker 容器不是生产监控栈，因此本调研没有得到生产实测内存数据。

## 候选方案比较

| 方案                           | 本地组件                                    | 能否替代存储/查询                            | 应用改动                                       | 适合 Lucent 的判断                                |
| ------------------------------ | ------------------------------------------- | -------------------------------------------- | ---------------------------------------------- | ------------------------------------------------- |
| 现有 Prometheus 降配           | Prometheus；可选 node-exporter/Alertmanager | 可以，Prometheus 自带查询                    | 无或很少                                       | 最快止血，但不是根本替换                          |
| Prometheus Agent + 云/远端后端 | Agent 一个进程                              | 不能独立查询或告警，必须有 remote_write 后端 | scrape 合同基本不变                            | 适合托管指标；不适合离线自托管                    |
| OTel Collector agent           | Collector 一个进程                          | 不能替代后端                                 | 可接收 OTLP、Prometheus 或日志                 | 适合传输/批处理/采样，不是存储方案                |
| Grafana Alloy                  | 一个统一 agent                              | 不能替代后端                                 | 可复用 Prometheus scrape，并统一 OTLP/日志管道 | 适合云端或自建后端前的统一采集                    |
| VictoriaMetrics 单机           | 单个后端进程；按需加 vmalert                | 可以，含 Prometheus 查询 API 和 VMUI         | 现有 `/metrics` 基本可复用                     | 自托管的首选候选                                  |
| Netdata                        | 一个 agent + 自带界面/本地数据库            | 可以覆盖其支持的本机监控                     | 自定义应用指标需要重新接入                     | 可做主机监控，但不是现有 OTel/Prom 体系的直接替代 |
| OpenObserve 单节点             | 一个观测后端进程，内部有多类数据处理角色    | 可以覆盖日志、指标、trace                    | 日志/trace 接入要迁移                          | 功能很全，但不应仅凭“单节点”判定更轻              |
| 仅 trace 云存储                | 应用 SDK 或一个 agent                       | 只解决 trace                                 | 需要 trace 认证、采样和导出配置                | 是补充，不是完整监控替代                          |
| 只把日志写云端                 | 日志 agent 或应用直传                       | 取决于云日志查询/告警                        | 需要日志采集与脱敏                             | 可替代部分日志检索，不能替代指标时序              |

### 1. 先缩减现有栈

这是风险最低的止血方案：

- Grafana 暂停默认启动，使用 Prometheus 自带 UI 或命令行查询；如果确实需要复杂 dashboard，
  再单独启动 Grafana。
- 删除 Postgres/Redis exporter 的默认 target，保留 Lucent 应用指标。数据库/Redis 只有在已有
  具体告警或容量问题时才重新接入 exporter。
- `node-exporter` 只为宿主机根分区、证书 textfile 规则保留；如果云平台已经提供主机磁盘和证书
  监控，则一并移除。
- 将 scrape interval 从 15 秒放宽到 30 或 60 秒，并同时设置 retention time 和 retention size
  上限。具体值要根据告警反应时间、磁盘和 series 数量测量，不应照抄固定数字。
- 保留低基数、可行动的指标：应用 up、5xx、延迟、event loop、RSS/heap、BullMQ waiting/failed、
  LLM 调用耗时和 token 成本。不要为了“完整”保留所有 exporter 指标。

这个方案能立即减少进程数和抓取量，但仍保留 Prometheus TSDB；如果真正的瓶颈是 Prometheus
本地存储或查询，最终还需要下面的单机后端或托管后端路线。

### 2. Prometheus Agent：只有在远端后端存在时才有意义

Prometheus 官方把 Agent mode 定义为针对 remote_write 优化的模式：它关闭查询、告警和本地存储，
使用定制的 TSDB WAL；抓取、服务发现和相关配置仍然保留。它因此适合“本地只采集，远端存储和
查询”的架构，但不能单独替换当前 Prometheus + Grafana。

来源：[Prometheus Agent mode](https://prometheus.io/docs/prometheus/latest/prometheus_agent/)

对 Lucent 的含义：应用的 `/metrics` 和低基数指标可以继续使用，生产本地只运行 Agent；但必须
同时选择托管 Prometheus、VictoriaMetrics Cloud、Grafana Cloud 或其他兼容 remote_write 的后端。
如果远端不可达，必须评估 WAL 磁盘缓冲、数据丢失窗口和本地磁盘上限。

### 3. OTel Collector 与 Grafana Alloy：解决管道问题，不直接解决存储问题

OpenTelemetry 官方的 agent deployment pattern 是“应用 SDK 发给 Collector，Collector 再发给
后端”的一对一关系；官方同时列出的 trade-off 是一对一映射容易上手，但对团队和基础设施资源
的扩展能力有限。官方 scaling 文档还建议用 `memory_limiter` 约束 Collector 的内存，并在
需要时通过批处理、采样和多实例扩展。

来源：

- [OpenTelemetry Agent deployment pattern](https://opentelemetry.io/docs/collector/deploy/agent/)
- [OpenTelemetry Collector scaling](https://opentelemetry.io/docs/collector/scaling/)
- [OpenTelemetry Collector configuration](https://opentelemetry.io/docs/collector/configuration/)

Grafana Alloy 官方定位为一个开源 telemetry collector，是带 Prometheus pipeline 的 OTel Collector
distribution，可以在一个工具里收集 metrics、logs、traces 和 profiles，并发送到 Grafana Cloud、
自建 Grafana 栈或兼容后端。

来源：[Introduction to Grafana Alloy](https://grafana.com/docs/alloy/latest/introduction/)

对 Lucent 的判断：

- 如果目标是“本地自建全套存储”，单独增加 Collector 或 Alloy 会增加一个进程，不能解决问题。
- 如果目标是“本地只留一个 agent”，Alloy 比分别运行 exporter、OTel Collector 和日志 agent 更
  有价值；但它仍然需要云端或自建后端。
- 需要配置 `memory_limiter`、batch、采样和发送队列，并验证后端不可用时不会把应用请求链路
  拖死。Collector/Alloy 的精确内存不能从官方架构页推导，应在 Lucent 的指标量和 trace 采样率
  下实测。

### 4. VictoriaMetrics 单机：自托管候选中的首选

VictoriaMetrics 官方文档说明单机版支持从 Prometheus exporter 抓取、Prometheus remote_write、
Prometheus exposition format、OpenTelemetry metrics 等输入，并提供 Prometheus querying API。
单机版还配套 VMUI，因此不要求 Grafana 才能查询基础指标。

来源：[VictoriaMetrics single-node](https://docs.victoriametrics.com/victoriametrics/single-server-victoriametrics/)

官方还把 `vmagent` 定位为低 CPU/RAM 的轻量采集与转发组件，并说明它的 RAM、CPU、磁盘 I/O 和
网络带宽通常低于 Prometheus；这是厂商能力说明，不是 Lucent 当前负载的容量保证。

来源：[vmagent](https://docs.victoriametrics.com/victoriametrics/vmagent/)

对 Lucent 的目标拓扑：

```text
Lucent /metrics ───────┐
                        ├─ VictoriaMetrics 单机 ── VMUI / PromQL-compatible query
node-exporter（可选） ─┘

OTel traces ── 采样后发送到云端 APM（可选）
```

应用侧的 `prom-client` 和 `/metrics` 可以先不改。第一阶段可只抓 Lucent 应用和 node-exporter；
Postgres/Redis exporter 不作为默认依赖。需要本地规则告警时，VictoriaMetrics 生态中的 `vmalert`
是额外服务，不能把它误认为单机版自带的完整告警管理面。

VictoriaMetrics 官方页面展示了相对 Prometheus 的 RAM/存储基准，但这些数字针对其说明的高基数
或特定测试条件。当前项目的低流量、低基数场景不应直接套用“几倍更省”的宣传数字，必须用同一份
scrape 配置、同一 retention 和代表性流量做 A/B 测量。

### 5. Netdata：值得知道，但不作为默认迁移目标

Netdata 官方的资源页给出的 measured footprint 是：空系统约 100--200 MB RAM，典型生产约
250--350 MB RAM，默认磁盘约 4 GiB，具体还会受数据库 tier 和机器学习配置影响。

来源：[Netdata Agent resource utilization](https://learn.netdata.cloud/docs/netdata-agent/resource-utilization)

它的优点是一个 agent 自带本机监控、界面和告警，适合“我只想看单机和容器健康”。但对 Lucent：

- 250--350 MB 是一个有意义的占用，不能仅凭“一个 agent”断言比精简后的 Prometheus 或
  VictoriaMetrics 更省；
- 现有 BullMQ、LLM token、业务 HTTP histogram 和 OTel trace 相关能力不会自动等价迁移；
- 它更像主机监控产品，不是现有 Prometheus/OTel 合同的无缝后端。

如果最终目标变成“主机运维优先、应用指标很少”，可以把 Netdata 放进独立 benchmark；当前不建议
为了替换 Grafana 而直接迁移。

### 6. OpenObserve：功能统一，但不等于轻量

OpenObserve 官方文档说明它支持日志、指标和 trace；其架构页把系统拆成 Router、Ingester、
Compactor、Querier、Scheduler 五类角色，并提供 single-node 和 HA 部署模式。single-node 可以
使用本地磁盘或对象存储。

来源：[OpenObserve architecture](https://openobserve.ai/docs/architecture/)

它适合“日志检索是第一优先级，且希望 SQL/PromQL/trace 在一个产品里”的场景。但 Lucent 当前
已经有结构化 Winston 日志、Prometheus 指标和 OTel trace；为获得统一界面引入一个新的全栈后端，
会带来数据模型、权限、保留、备份和迁移成本。没有对 Lucent 的真实日志量和指标量做压测前，不能
把 OpenObserve 作为轻量化结论。

### 7. 云托管：本地资源最小，但要把成本和退出路径算清楚

阿里云 ARMS 产品页明确列出对 OpenTelemetry、Prometheus 的兼容，并提供应用监控、可观测链路等
能力；产品页同时提示按数据写入量计费/存在试用和促销，实际价格应按地域、数据类型、写入量和保留
期在控制台确认。

来源：[阿里云 ARMS](https://www.aliyun.com/product/arms)

当前 Lucent 已使用腾讯云 TCR、COS。腾讯云 APM 产品页列出 Node.js 支持、调用链追踪和按探针/上报
规格计费；腾讯云 CLS 提供日志采集、存储、检索、图表分析和告警。腾讯云产品页还列出托管 Prometheus
和 Grafana 服务。

来源：

- [腾讯云 APM](https://cloud.tencent.com/product/apm)
- [腾讯云 CLS](https://cloud.tencent.com/product/cls)

因此，如果选择云托管，腾讯云在网络、账号、现有部署和数据合规上是 Lucent 的自然优先候选；
阿里云 ARMS 和 Grafana Cloud 仍应以实际报价、区域可用性、OTLP 接入方式和数据保留策略比较，
不能仅凭品牌或“免费额度”作决定。

## 推荐排序

### 推荐 1：VictoriaMetrics 单机 + 精简指标

适用：希望继续自托管、预算敏感、单服务器和单人维护、又不想放弃时序查询。

- 本地组件：VictoriaMetrics 单机；node-exporter 可选；vmalert 仅在需要本地规则告警时添加。
- 退役目标：Prometheus、Grafana、Postgres exporter、Redis exporter 默认不启动。
- 应用改动：先不改 `prom-client` 和 `/metrics`；只改部署 scrape 配置和规则。
- 保留：应用可用性、5xx、延迟、event loop、BullMQ、LLM 成本；宿主机磁盘/证书按 node-exporter
  或云监控二选一。
- 风险：VMUI 不等价于成熟的 Grafana dashboard；alerting 需要额外设计；VictoriaMetrics 的
  资源优势不能用官方基准直接承诺。

### 推荐 2：Alloy 或 Prometheus Agent + 托管指标/trace/日志

适用：本机资源比云服务费更重要，或者不想维护本地时序库、备份、升级和可视化。

- 本地组件：一个 Alloy 或 Prometheus Agent；trace 可以由现有 OTel SDK 直传，也可以统一经过 Alloy。
- 云端：腾讯云 APM/托管 Prometheus/CLS、阿里云 ARMS，或 Grafana Cloud。
- 应用改动：指标保留 Prometheus scrape 或迁移到 OTLP；trace 增加认证 header、采样和失败降级；
  日志增加脱敏、批处理和丢弃策略。
- 风险：持续数据费用、云端不可用时的缓冲、跨区域出网、厂商 API/查询语法绑定、离开云厂商的
  数据迁移成本。

### 推荐 3：现有 Prometheus 的短期瘦身

适用：现在就要减少进程数，但暂时不想迁移存储。

- Grafana 改为按需启动。
- 只抓 Lucent 和必要的 node-exporter。
- scrape 30--60 秒，设置 retention time + size；把 Postgres/Redis exporter 移到按需 profile。
- 保留少量规则，告警通道用 Alertmanager profile 或外部 uptime/告警服务。

它是很好的止血方案，但不应被描述为最终替代，因为 Prometheus 本地 TSDB 仍然存在。

### 不推荐作为当前默认方案

- **只部署 OTel Collector/Alloy，不部署后端**：解决了管道统一，没有解决存储、查询和告警。
- **只保留 trace**：能定位单次请求链路，却不能回答长期错误率、P99、队列积压、磁盘和证书问题。
- **直接迁移 Netdata**：适合主机监控，但没有证明能以更低资源等价承接当前业务指标和 OTel trace。
- **直接迁移 OpenObserve**：产品能力完整，但尚未证明在本项目规模下比精简后的单机时序后端轻。
- **为了移除 exporter 而在应用里直接连接数据库/Redis采集内部指标**：这会把运维耦合和故障面
  重新塞回业务进程，通常与减轻应用资源和降低故障影响的目标相冲突。

## 建议迁移顺序

### 第 0 步：先测量，不先承诺节省多少

在 staging 或生产低风险窗口分别记录 24 小时基线：

1. 每个容器的 CPU、RSS、网络、磁盘写入和 OOM/重启次数；同时记录应用在同一时段的请求量、
   LLM 调用量、队列量。
2. Prometheus 的 active series、scrape duration、scrape samples、TSDB 磁盘增长；验证
   dashboard/rules 实际使用哪些 metric。
3. 做四组 A/B：当前全栈、去 Grafana、去 Postgres/Redis exporter、VictoriaMetrics 单机。
   使用相同 scrape interval、retention、指标集合和负载。
4. 以“应用 P95/P99、event loop lag、OOM、磁盘增长、告警延迟”为门槛，而不是只看监控进程
   自己的 RSS。观测系统变轻但丢掉关键告警，不算成功。

### 第 1 步：无代码止血

- 给 Grafana、Postgres exporter、Redis exporter 增加按需 profile，不默认启动。
- 精简 `prometheus.yml` 和 `lucent.yml`，确认不存在对已删除 target 的隐式依赖。
- 将 retention 和 scrape interval 设为可配置；仅保留应用与必要宿主机指标。
- 记录降级后的手工查询和告警入口，避免“少了组件但没人知道怎么排障”。

### 第 2 步：选择一个最终后端

- 自托管：用 VictoriaMetrics 单机导入 Prometheus 配置和规则，验证 VMUI、查询兼容性、磁盘备份、
  升级回滚和认证。
- 托管：先用一个环境把应用 trace、核心指标和结构化日志接入，确认认证、数据脱敏、采样、
  断网缓存、账单和数据删除/保留，再停本地存储。

### 第 3 步：再决定是否迁移指标 SDK

不要因为后端替换就同时把 `prom-client` 全量迁移到 OTel Metrics。现有应用指标合同已经稳定，
先通过 Prometheus exposition 或 remote_write 保持业务连续性；只有确定多信号统一、跨后端迁移或
厂商接入要求时，再单独评估 OTel Metrics 的 schema、histogram 语义、导出失败行为和测试成本。

## 最终判断

**如果只选一个自托管方案：选 VictoriaMetrics 单机，但先做可回滚的 A/B benchmark。** 它最接近
“保留当前应用指标合同、去掉 Grafana 和大部分 exporter、减少本地服务数”的目标。

**如果只选一个最低本地资源方案：选托管后端 + 一个 agent，优先比较腾讯云 APM/托管 Prometheus/CLS
与阿里云 ARMS，再看 Grafana Cloud。** 本项目现有腾讯云部署使腾讯云路线的集成摩擦较小，但价格、
区域和保留策略必须用实际账单模型确认。

**不建议把“换掉 Prometheus/Grafana”理解成“换成另一个大而全平台”。** 先砍掉不产生行动的
signals，再让一个轻量后端承接剩下的 signals，才能同时降低资源占用和运维复杂度。

## 本次未做的事情

- 未修改 Lucent 代码、Compose、Prometheus 规则、依赖或生产环境。
- 未把任何厂商的宣传 benchmark 当作 Lucent 的容量结论。
- 未获得生产监控栈的实际 `docker stats` 数据；当前工作区运行的是开发数据库、Redis 和 Jaeger，
  不能代表生产 Prometheus/Grafana/exporter 占用。
