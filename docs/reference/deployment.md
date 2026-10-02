---
status: active
owner: backend
quadrant: reference
updated: 2026-10-02
---

# Lucent Deployment

> **三台机器,各跑一份仓库内 compose**,用 `docker compose up -d` 直接管理。
> 跨云通信走公网(无 VPC 对等),访问控制由**云安全组的来源 IP 白名单**承担。
> 当前无反向代理、无域名、无 TLS,app 以 HTTP 直接对外提供入口。
>
> 决策见 [ADR-0023](adr/0023-three-server-compose-deployment.md);操作步骤见
> [howto/deploy.md](../howto/deploy.md)。[ADR-0017](adr/0017-coolify-deployment.md)
> 的 Coolify 模型与 staging(宿主 PM2 + 自建 Traefik)已退役。
>
> 🔒 **本文只描述形态,不写真实地址。** 公网 IP、端口暴露矩阵与安全组规则属运维信息,
> 在**服务器侧的 `.env` 与私有运维笔记**中维护,不入库(仓库可能公开)。
> 下文用占位符:`<主站IP>` = Lucent 主站,`<图库IP>` = 图后端机,`<监控IP>` = 监控机。

## 拓扑

```
              客户端
                │  http://<主站IP>:3000
┌───────────────▼──────────────────────────┐
│ 主站(华为云 鲲鹏, aarch64)               │
│   /opt/lucent/compose.yaml               │
│   app                 :3000  公网入口     │
│   postgres            :5432              │
│   redis               :6379              │
│   lightrag            :9621              │
│   node-exporter       :9100              │
└───┬───────────────────────────────┬──────┘
    │ 公网(跨云唯一通路)           │
    │ app→semantica                 │ app push 日志/追踪
    │ ◀── 监控机 pull 指标 ─────────┤
┌───▼──────────────────────┐  ┌─────▼────────────────────────────┐
│ 图库机(腾讯云, amd64)     │  │ 监控机(阿里云, amd64)            │
│  /opt/lucent-neo4j/       │  │  /opt/lucent-monitoring/         │
│   neo4j        :7474/7687 │  │   victoriametrics :8428          │
│   semantica    :8099      │  │   grafana         :3001          │
│                           │  │   victorialogs    :9428          │
│                           │  │   victoriatraces  :10428         │
└───────────────────────────┘  └──────────────────────────────────┘
```

> ⚠️ **跨云走公网,不是内网 VPC。** 三家云之间没有 VPC 对等连接,私网网段互不可达。
> 所有跨机地址必须填**对方的公网地址**(如 `SEMANTICA_BASE_URL=http://<图库IP>:8099`),
> 安全组按**对方的公网出口 IP** 做白名单。三家均为 1:1 NAT,出口 IP == 公网 IP。
> 填内网地址的失败形态是**超时**,不是连接拒绝——各服务按自己的回落语义处理。

**流量方向决定安全组往哪边开**:

| 链路                             | 方向            | 安全组开在哪             |
| -------------------------------- | --------------- | ------------------------ |
| 监控机 → 主站 `3000`/`9100`      | 监控机主动 pull | 主站侧,放行监控机出口 IP |
| 主站 app → 监控机 `9428`/`10428` | 应用主动 push   | 监控机侧,放行主站出口 IP |
| 主站 app → 图库机 `8099`         | 应用主动调用    | 图库机侧,放行主站出口 IP |

## 三台机器

| 机器           | 架构    | 工作目录                 | compose                   | 起的服务                                                    |
| -------------- | ------- | ------------------------ | ------------------------- | ----------------------------------------------------------- |
| 主站(华为云)   | aarch64 | `/opt/lucent`            | `compose.yaml`            | `postgres` `redis` `app` `lightrag` `node-exporter`         |
| 图库机(腾讯云) | amd64   | `/opt/lucent-neo4j`      | `compose.yaml`            | `neo4j` `semantica`                                         |
| 监控机(阿里云) | amd64   | `/opt/lucent-monitoring` | `compose.monitoring.yaml` | `victoriametrics` `grafana` `victorialogs` `victoriatraces` |

**同一份 `compose.yaml` 在主站与图库机各部署一份**,用**显式服务名**决定起哪些
(图库机执行 `docker compose up -d neo4j semantica`)。`semantica` 服务带
`profiles: ['semantica']`,在主站上不启用。三台机器的 compose 内容均与仓库一致。

**为什么主站放鲲鹏**:4c/7.2 GiB 是唯一能同时扛住 Lucent + PG + Redis + LightRAG 的机器,
且「国产 CPU + 国产 OS(Huawei Cloud EulerOS)上跑核心业务」是大赛鼓励的国产化方向。
**为什么 Neo4j 放图库机**:它是 JVM 应用,固定内存约 852 MiB(heap 512m + pagecache 256m),
把 1.2 GB 级负载挪出主站;同时 x86 可省一次跨架构验证。
**为什么监控栈独立一台**:Grafana 查询 VM 是密集链路(一个仪表盘刷新打出几十个 range query),
VM 与 Grafana 同机会让同一份数据在公网上往返两次并穿过窄带宽;监控与被观测对象分离也保证
主站整台挂掉时历史指标还在。

## 组件与端口

| 机器   | 服务              | 镜像                                       | 端口          | 说明                                                                                                            |
| ------ | ----------------- | ------------------------------------------ | ------------- | --------------------------------------------------------------------------------------------------------------- |
| 主站   | `app`             | `<registry>/lucent:<sha>-arm64`            | `3000`        | 公网入口;健康检查 `/api/v1/health`                                                                              |
| 主站   | `postgres`        | `<registry>/lucent-db:18-arm64`            | `5432`        | 卷 `postgres-data`;镜像自带 `vector` + `zhparser`;**`lucent` 与 `lightrag` 两库各需 `CREATE EXTENSION vector`** |
| 主站   | `redis`           | `redis:8-alpine`                           | `6379`        | requirepass + appendonly;卷 `redis-data`                                                                        |
| 主站   | `lightrag`        | `ghcr.io/hkuds/lightrag:latest`            | `9621`        | 中文散文检索 sidecar;独立 `deploy/lightrag/.env`;卷 `lightrag-data`                                             |
| 主站   | `node-exporter`   | `prom/node-exporter:v1.9.1`                | `9100`        | 宿主机指标;**只放行监控机出口 IP**                                                                              |
| 图库机 | `neo4j`           | `neo4j:5.26.31-community`                  | `7474`/`7687` | 固定 heap 512m + pagecache 256m                                                                                 |
| 图库机 | `semantica`       | `<registry>/lucent-semantica:latest-amd64` | `8099`        | 英文侧 OAG;bearer 鉴权(`API_TOKEN` / `SEMANTICA_API_KEY`)                                                       |
| 监控机 | `victoriametrics` | `victoria-metrics:v1.151.0`                | `8428`        | 抓主站 `3000`/`9100`                                                                                            |
| 监控机 | `grafana`         | `grafana:12.1.0`                           | `3001`        | provisioning/dashboards 来自 `monitoring/grafana/`                                                              |
| 监控机 | `victorialogs`    | `victoria-logs:v1.51.1`                    | `9428`        | 接收 Winston JSON 日志                                                                                          |
| 监控机 | `victoriatraces`  | `victoria-traces:v0.12.0`                  | `10428`       | OTLP trace 入口                                                                                                 |

所有服务 `restart: unless-stopped`,主机重启后自动恢复。

### 暴露面:安全组是访问控制层

**端口发布到 `0.0.0.0` 不等于对全网开放。** 云安全组按来源 IP 白名单收口;把某端口限定到
指定 IP 后,其可达性等同于「只有该 IP 能连」——这与「仅绑回环 + SSH 隧道」是同一档的
访问控制,区别只在审计面与多一层云厂商依赖。**判断暴露面看安全组放行了谁,不看端口是否发布。**

原则(具体规则在私有运维笔记中维护,**不入库**):

- 对外入口只有 app 的 `3000`;
- `9100` **只放行监控机出口 IP**,绝不放行 `0.0.0.0/0`;
- 数据与 sidecar 端口(`5432`/`6379`/`9621`/`7687`/`7474`/`8099`)只放行
  运维 IP 与确实需要对端的来源 IP;
- 监控栈端口只放行运维 IP。

比放行本机 IP 更严的做法是开 SSH 隧道(端口不必对任何 IP 放行):

```bash
ssh -N -L 8428:127.0.0.1:8428 -L 9428:127.0.0.1:9428 \
    -L 3001:127.0.0.1:3001 root@<监控IP>
```

### 无 TLS

`app` 直接以 HTTP 提供入口,**没有反向代理、没有域名、没有证书**。后果:客户端到服务端的
流量未加密,`METRICS_USER`/`METRICS_PASSWORD` 与各 sidecar 的 bearer token 在跨云公网上
明文过线。引入域名 + TLS 终止是独立的后续决策。

### LightRAG sidecar(中文散文检索)

- **配置独立**:`lightrag` 服务的 `env_file` 是 `deploy/lightrag/.env`,**不共用**
  app 的 `.env`。那是独立进程,不该读到 `JWT_*` / `DATABASE_URL` / 微信密钥。
  清单见 `deploy/lightrag/.env.example`。
- **Lucent 侧只需两项**:`LIGHTRAG_ENABLED=true` 与 `LIGHTRAG_API_KEY`(须与
  sidecar env 的同名项一致,是鉴权握手)。`LIGHTRAG_BASE_URL` 走默认的
  `http://lightrag:9621`(同 compose 网络)。
- **存储**:四件套(PGKVStorage / PGVectorStorage / PGTableGraphStorage /
  PGDocStatusStorage)落在同一 postgres 服务的独立 database `lightrag`,不进
  Prisma 迁移域;卷 `lightrag-data` 存 working dir。容量与连接池需随语料增长评估
  (`MAX_PARALLEL_INSERT=2`)。
- **升级纪律**:sidecar 并发协议在 v1.5.7 起有变更且无版本标记,**升级前必须排空
  pipeline 并停掉所有 writer 再启新版本**;漏一个旧 writer 即损坏数据。
  `stop_grace_period: 60s` 就是为排空留的。改 `.env` 后必须
  `up -d --force-recreate`,**`up -d` 不重建容器**。
- **回滚**:停 `lightrag` 服务并把 app 的 `LIGHTRAG_ENABLED` 置 `false` 即可 ——
  工具会返回"未配置"信封而不是报错,assistant 其余能力不受影响。客户端会经
  `capabilities.disabledReason = 'retrieval_unavailable'` 看到"检索暂不可用"。
- **灌数据**:chunk 表是事实源,用 `pnpm import:lightrag --workspace=leaflet|qa`
  推进 sidecar(幂等,`--reset` 先按 doc id 清空)。按说明书逐份灌入的断点续传
  见 [howto/run-medicine-import.md](../howto/run-medicine-import.md)。
  灌入产出的 doc id 段序是跨进程契约(查询侧靠它反解溯源),**改段序等于切断溯源链**;
  失败的文档用 `POST /documents/reprocess_failed` 重试。
- **workspace 隔离的上游限制**:上游 #2527 确认单实例仅支持单 workspace,实测
  `LIGHTRAG-WORKSPACE` 头不改变实际读写位置。因此同实例上 `leaflet` 与 `qa`
  实际共享一个命名空间,靠 doc id 前缀区分;需要物理隔离时要另起实例。

### 英文侧 OAG(Neo4j + semantica)

图库机只跑这两个服务,由主站的 app 经公网 `8099` 调用。`neo4j` 不在主站,
app 不直连图库——所有图查询都由 semantica 承担(`/query`、`/reason`)。
`SEMANTICA_ENABLED=false` 时工具返回"未配置"信封,主流程不受影响。

## 配置与密钥

**配置是服务器上的 `.env`**,不入库。compose 的 `${VAR}` 插值与 app 的
`env_file` 读同一份文件;模板是仓库内 `.env.production.example`。

| 机器   | 配置文件                           | 关键键                                                                                                                                                                                                        |
| ------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 主站   | `/opt/lucent/.env`                 | `LUCENT_IMAGE` `LUCENT_DB_IMAGE` `POSTGRES_PASSWORD` `REDIS_PASSWORD` `METRICS_USER` `METRICS_PASSWORD` `PUBLIC_BASE_URL` `CORS_ORIGIN` `SEMANTICA_BASE_URL` `VICTORIALOGS_URL` `OTEL_EXPORTER_OTLP_ENDPOINT` |
| 主站   | `/opt/lucent/deploy/lightrag/.env` | `EMBEDDING_*` `EXTRACT_LLM_MODEL` `EMBEDDING_SEND_DIM` `ENTITY_TYPE_PROMPT_FILE`;模板 `deploy/lightrag/.env.example`                                                                                          |
| 图库机 | `/opt/lucent-neo4j/.env`           | `NEO4J_PASSWORD` `API_TOKEN` `SEMANTICA_IMAGE`                                                                                                                                                                |
| 监控机 | `/opt/lucent-monitoring/.env`      | `LUCENT_PUBLIC_HOST` `METRICS_USER` `METRICS_PASSWORD` `GRAFANA_ADMIN_PASSWORD`                                                                                                                               |

- `DATABASE_URL` / `REDIS_URL` 由 `compose.yaml` 的 `environment` 块用
  `POSTGRES_PASSWORD` / `REDIS_PASSWORD` 拼接,不需手填;两者必须与 `.env` 里的
  口令一致。
- 变量完整语义见 [environment-variables.md](environment-variables.md)。
- `LUCENT_PUBLIC_HOST`(监控机)与主站的 `PUBLIC_BASE_URL` 是同一事实的两处表达,
  **改 IP 时必须同步**。
- **多机 `.env` 是漂移源**:新增变量要逐台补,没有集中式配置源。

## 镜像与发布

- **镜像仓库**:发布者自有 registry,Docker Hub 仓库名由 GitHub secret
  `REGISTRY_IMAGE` 注入(**公开仓库代码不写死用户名**)。
- **tag**:`<git sha 前 8 位>-<架构>`,如 `<registry>/lucent:1a2b3c4d-arm64`。
  主站需要 `linux/arm64`,图库机/监控机用 amd64。
- **换版本**:改服务器 `.env` 里的 `LUCENT_IMAGE`,然后
  `docker compose pull <service> && docker compose up -d --force-recreate <service>`。
- **回滚 = 把镜像引用改回旧短 sha 再 `up -d`**,天然可回退。schema 不回退,
  破坏性迁移继续遵守 expand-contract。
- **跨架构构建**:给主站的镜像必须 `docker buildx build --platform linux/arm64`,
  否则 `exec format error`。跨架构构建走 QEMU 模拟,耗时明显长于原生。
  离线场景(无外网)的完整搬运流程(镜像 `docker save` + 跨机传输)属运维手册内容,不入库。
- **镜像来源两条路径**:CI(`lucent-production`,`workflow_dispatch`)构建推送后拉取;
  或服务器就地 `docker compose build app`。常规走 CI,就地构建是镜像仓库不可用时的替代。

## 数据库迁移

`entrypoint.sh` 在容器启动时自动执行 `prisma migrate deploy`,**失败则容器不启动**,
不会带坏 schema 上线。验证:`curl http://<主站IP>:3000/api/v1/health/deep`。

发布窗口:单 slot 停机(容器重建期间约 15–45s;就地构建含构建耗时会更长),
SSE 连接会收到终止事件后关闭,建议低峰发布。

## 监控与日志

- **指标**:主站 `node-exporter`(`9100`)与 app `/metrics`(`3000`)由监控机的
  VictoriaMetrics 经公网抓取;`LUCENT_PUBLIC_HOST` 在监控机侧指定主站地址。
- **面板**:Grafana `http://<监控IP>:3001`、VMUI `http://<监控IP>:8428`、
  VictoriaLogs UI `http://<监控IP>:9428`。
- **日志**:app 只写 stdout(容器收集)+ VictoriaLogs(`VICTORIALOGS_URL`),
  不写文件系统、不挂日志卷。字段约定见 [logging-conventions.md](logging-conventions.md)。
- **链路追踪**:OTLP 推到监控机 `10428`,采样率由 `OTEL_TRACES_SAMPLER` /
  `OTEL_TRACES_SAMPLER_ARG` 控制(改环境变量即可,不必重建镜像)。
  见 ADR-0010 / ADR-0016。
- **告警当前未配置**。

## 服务器前置要求

- **三台共同**:Docker 20.10+ 与 `docker compose` 插件;云安全组按上文原则放行;
  无需 Node/pnpm/PM2(应用在容器里跑,不需要宿主运行时)。
- **主站**:`linux/arm64` 镜像;工作目录下有 `compose.yaml`、`.env`、
  `deploy/lightrag/.env`。
- **图库机**:工作目录下有 `compose.yaml` 与 `.env`;Neo4j 固定内存约 852 MiB,
  注意主机余量。
- **监控机**:工作目录下有 `compose.monitoring.yaml`、`.env` 与 `monitoring/`
  (provisioning 与 dashboards)。首次接入步骤见 [howto/deploy.md](../howto/deploy.md)。
