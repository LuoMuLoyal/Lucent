---
status: active
owner: backend
quadrant: reference
updated: 2026-09-09
---

# Lucent Deployment

> 本文档描述当前部署模型(2026-09-08 起):仓库保留生产与 staging 两份 compose,
> 在 Coolify 中注册为 Docker Compose Service 运行;应用镜像由 GitHub Actions
> 构建并推送到 Docker Hub,Coolify 拉取;反代与 TLS 由 Coolify 自带 Traefik 接管。
> 决策见 ADR-0017;旧模型(ADR-0004:GitHub Actions + TCR + `deploy.ts` 单 slot
> 停机部署 + Nginx)已退役。

## 拓扑

```
GitHub (CI/CD)                              Coolify 控制面
┌──────────────────────┐                    ┌───────────────────────────────┐
│ lucent-ci            │  push 镜像到       │ Coolify UI                   │
│  lint/test/build     │  发布者自己的      │  Docker Compose Service 资源  │
│ lucent-staging /     │  registry          │  (粘贴 deploy/compose*.yml)   │
│ lucent-production    ├───────────────────▶│                               │
│  build Dockerfile    │                    │  Traefik(自动装)              │
│  → registry          │                    │   ├── 域名 → app:3000 + TLS   │
└──────────────────────┘                    └───────────────┬───────────────┘
                                                            │ SSH / docker
                                            目标服务器(Coolify 纳管)
                                            ┌───────────────────────────────┐
                                            │ postgres / redis / app        │
                                            │ victoriametrics / grafana     │
                                            │ victorialogs / node-exporter  │
                                            └───────────────────────────────┘
```

- **编排单一事实源**:`deploy/compose.yml`(生产,app + postgres + redis +
  victoriametrics + grafana + victorialogs + node-exporter)与
  `deploy/compose.staging.yml`(staging,去掉 grafana 和 node-exporter)。
- **反向代理 / TLS**:Coolify 在每台被管服务器自动安装 Traefik;域名、HTTPS
  证书在 Coolify 面板配置,不再有 Nginx、`certs/`、`check-cert.sh`。
- **镜像**:CI/CD 构建并推送发布者自有镜像仓库,具体仓库名由 GitHub secret
  `REGISTRY_IMAGE` 注入(**公开仓库代码不写死用户名/镜像地址**);tag 策略见下文。
- **日志**:应用只写 stdout(Coolify/Docker 收集)+ VictoriaLogs
  (`VICTORIALOGS_URL` 由 compose 注入),不再写文件系统。

## 组件与端口

下表为生产 `deploy/compose.yml` 的完整组件;staging `deploy/compose.staging.yml`
在此基础上**去掉 grafana 与 node-exporter**,其余相同。

| 服务              | 镜像                        | 端口        | 说明                                                                    |
| ----------------- | --------------------------- | ----------- | ----------------------------------------------------------------------- |
| `app`             | `${LUCENT_IMAGE}`(完整引用) | 仅内网 3000 | 公网入口 = Coolify 域名路由;健康检查 `/api/v1/health`                   |
| `postgres`        | `pgvector/pgvector:pg18`    | 无          | 卷 `postgres-data`                                                      |
| `redis`           | `redis:8-alpine`            | 无          | 卷 `redis-data`;requirepass                                             |
| `victoriametrics` | `victoria-metrics:v1.128.0` | `8428:8428` | 抓取 app `/metrics`(+ node-exporter,仅生产);卷 `victoriametrics-data`   |
| `grafana`         | `grafana:12.1.0`            | `3001:3000` | 仅生产;provisioning/dashboards 来自 `deploy/grafana/`;卷 `grafana-data` |
| `victorialogs`    | `victoria-logs:v1.15.0`     | `9428:9428` | 接收 Winston JSON 日志;卷 `victorialogs-data`                           |
| `node-exporter`   | `node-exporter:v1.9.1`      | 无          | 仅生产;宿主机 CPU/内存/磁盘指标                                         |

### Staging 精简编排

- 文件:`deploy/compose.staging.yml`,粘贴进 Coolify **Docker Compose Empty**
  (staging 环境项目)即可;结构同生产,但去掉 grafana、node-exporter。
- 抓取配置用 `deploy/victoriametrics/vmscraper.staging.yml`(只含 app job,
  无 node job);VictoriaMetrics 保留,VMUI 直接查指标;VictoriaLogs 保留,
  日志照常按 `trace_id` 检索。
- 环境变量与生产相同(含 `LUCENT_IMAGE`);无需 `GRAFANA_ADMIN_PASSWORD`。
- staging 镜像 tag 可用 `latest` 或短 sha(见「镜像 tag 策略」)。

端口映射(8428/9428/3001)直接发布宿主机,**公网访问由云厂商安全组收口**,
不再使用 SSH 隧道。`/metrics` 端点 Basic Auth 由 `METRICS_USER` /
`METRICS_PASSWORD` 控制(可选;两侧一致时抓取正常,未配置时匿名可访问)。

## 环境变量

- 变量清单与语义见 [environment-variables.md](environment-variables.md),
  模板见仓库根 `.env.production.example`。
- compose 插值所需的变量(在生产 compose 服务中配置):
  `POSTGRES_PASSWORD`、`REDIS_PASSWORD`、`LUCENT_IMAGE`、`METRICS_USER`、
  `METRICS_PASSWORD`、`GRAFANA_ADMIN_PASSWORD`;
  `DATABASE_URL` / `REDIS_URL` 由 compose 的 `environment` 块拼接,不需手填。
  `LUCENT_IMAGE` 是 app 的**完整镜像引用**——把下文的 `<你的用户名>`
  换成你自己的 Docker Hub 用户名(示例 `<你的用户名>/lucent:1a2b3c4d`,
  不带 registry 前缀时默认 Docker Hub;其它 registry 写全地址)。
- app 的其余运行时变量经 `env_file: [.env]` 注入:在 Coolify 面板把完整变量表
  粘贴到 Service 环境变量(Coolify 会写入服务目录的 `.env`);脱离 Coolify
  独立运行 compose 时,把 `.env.production.example` 复制为服务目录的 `.env`
  并填值。
- GitHub Actions secrets:
  - `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` — Docker Hub 登录(旧 `TCR_*`、
    `DEPLOY_*` 已废弃);
  - `REGISTRY_IMAGE` — 发布镜像仓库引用,如 `docker.io/<你的用户名>/lucent`
    或 `<你的用户名>/lucent`(公开仓库,被管服务器拉取无需凭据;值存于
    GitHub secret,不进代码)。

## 镜像 tag 策略

- CD 对 `${{ secrets.REGISTRY_IMAGE }}` 推两个 tag:`<git sha 前 8 位>`
  (不可变,回滚锚点)与 `latest`。
- compose 的 `LUCENT_IMAGE` 填完整引用 `<你的用户名>/lucent:<短 sha>`;
  **生产发布固定短 sha**(Coolify 面板里维护),回滚 = 把 `LUCENT_IMAGE`
  改回旧短 sha 的完整引用再重启,天然可回退。
- `latest` 仅供 staging 试验/快速拉新,不用于生产语义。

## 发布与迁移

1. 合并 main → `lucent-ci` 校验;`lucent-staging` 构建并推送镜像(staging 面板
   手动 pull 生效,也可接 Coolify 部署 webhook 自动化)。
2. 生产:手动触发 `lucent-production`(`workflow_dispatch`,main)构建推送。
3. 更新环境:把服务的 `LUCENT_IMAGE` 改为含新短 sha 的完整引用 → Coolify 面板
   **Pull Latest Images & Restart**(或对 compose 资源执行重启)。
4. **数据库迁移**(schema 变更时,发布前执行一次):
   ```bash
   # 在目标服务器上,容器内执行 prisma migrate(镜像含 prisma CLI 与 schema)
   docker exec <lucent-app容器> node_modules/.bin/prisma migrate deploy
   ```
   或等容器启动后经 Coolify 终端执行同一命令。迁移失败不回退 schema,
   破坏性变更遵循 expand-contract(与旧模型一致)。
5. 验证:`curl https://<domain>/api/v1/health/ready`、`/api/v1/health/deep`。

发布窗口:单 slot 停机(容器重建期间 ~15–45s),SSE 连接会收到终止事件后关闭,
建议低峰发布。

## 监控与告警(现状)

- **保留指标**:VictoriaMetrics + Grafana(看板 `deploy/grafana/dashboards/`)。
  抓取、查询都在同一 Docker 网络内。
- **告警已退役**:vmalert / alertmanager / 告警规则(`deploy/victoriametrics/rules`)
  与 `check-cert.sh` 已删除,**当前不配置告警通知**;日后需要时再引入
  (Coolify 自身健康检查/重启已覆盖基本存活)。
- **备份未启用**:`backup.sh` 已删除,当前不做数据库自动备份;生产上线前应
  在 Coolify 的 postgres 组件开启定时备份(S3)或另行安排 `pg_dump` 运维。

## 日志

- stdout:Coolify 面板 / `docker logs` 直接查看。
- VictoriaLogs:Web UI `http://<host>:9428`(安全组收口),按 `trace_id` 检索:
  搜索框输入 `trace_id:xxx`。
- 字段约定见 [logging-conventions.md](logging-conventions.md);OpenTelemetry
  trace 注入见 ADR-0010/0016。

## 排障速查

- 容器起不来:`docker logs <容器>`;应用侧先看 `/api/v1/health/deep` 输出。
- 数据库连不上:确认 postgres 健康、`DATABASE_URL` 里的密码与
  `POSTGRES_PASSWORD` 一致。
- 域名打不开:检查 Coolify 面板的 domain 配置与 Traefik 证书状态
  (证书续期由 Coolify/Traefik 自动管理,无需手工脚本)。
- 指标为空:Grafana 数据源指向 `victoriametrics:8428`;VictoriaMetrics
  日志查看 scrape 报错(auth 不匹配时检查两侧 `METRICS_*` 是否一致);
  staging 无 Grafana,直接用 VMUI(`http://<host>:8428`)。

## 服务器前置要求

- 目标服务器加入 Coolify(Servers → Add Server,Coolify 自动装 Docker +
  Agent + Traefik)。
- 云安全组按需放行 `3001` / `8428` / `9428`(指标栈);`80` / `443` 交给
  Coolify Traefik,无需 SSH 隧道。
- 首次接入的操作步骤见 [howto/deploy.md](../howto/deploy.md)。
