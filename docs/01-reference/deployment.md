# Lucent Deployment

Last updated: 2026-07-17

这份文档描述当前生产部署模型：Docker Compose 单机部署 + **单 slot 停机部署**（每次发布
15~45s 停机窗口，低峰时段发布）+ 镜像 tag 回滚。蓝绿双 slot 已于 2026-07-17 移除，决策
见 [[adr/0004-deployment-model]]。

## 目录结构

服务器上只有一个目录：

```text
/opt/lucent/
├── compose.yml                   ← CI 管理（每次覆盖上传）
├── deploy.ts                     ← CI 管理（ESM）
├── smoke.ts                      ← CI 管理（ESM）
├── package.json                  ← CI 管理（{"type":"module"}，使 deploy.ts / smoke.ts 以 ESM 运行）
├── backup.sh                     ← CI 管理（每日 pg_dump 备份 + 可选 COS 异地副本）
├── check-cert.sh                 ← CI 管理（TLS 证书过期 textfile 指标）
├── render-configs.sh             ← CI 管理（渲染 prometheus/alertmanager 配置模板）
├── nginx/
│   └── nginx.conf                ← CI 管理
├── prometheus/
│   ├── prometheus.yml            ← CI 管理（模板，含 ${METRICS_*} 占位符）
│   ├── rules/
│   │   └── lucent.yml            ← CI 管理（告警规则）
│   └── .rendered/
│       └── prometheus.yml        ← render-configs.sh 生成（含密钥，不入库）
├── alertmanager/
│   ├── alertmanager.yml          ← CI 管理（模板，含 ${WECOM_*} 占位符）
│   └── .rendered/
│       └── alertmanager.yml      ← render-configs.sh 生成（WECOM_* 配齐时才生成）
├── grafana/                      ← CI 管理（rsync --delete 同步整个目录）
│   ├── provisioning/
│   │   ├── dashboards/
│   │   │   └── dashboards.yml
│   │   └── datasources/
│   │       └── prometheus.yml
│   └── dashboards/
│       └── lucent-backend-overview.json
│
├── .env                          ← 运维管理（CI 永不触碰）
├── .env.previous                 ← deploy.ts 自动管理（修改 .env 之前快照，回滚用）
├── certs/                        ← 运维管理
│   ├── fullchain.pem
│   └── privkey.pem
├── data/                         ← 运维管理
│   ├── postgresql/
│   ├── redis/
│   ├── prometheus/
│   ├── grafana/
│   ├── alertmanager/
│   ├── backups/                  ← pre-deploy 快照（保留 10 份）+ daily 备份（保留 7 份）
│   └── node-exporter-textfile/   ← check-cert.sh 写入 lucent_cert.prom
└── logs/                         ← 运维管理
    ├── app/                      ← Winston 按天分割的日志文件
    └── nginx/
```

核心原则：

- 一个目录 `/opt/lucent/`，不区分 `app/` 和 `server/`
- CI 只覆盖上传具体文件（`scp`）和目录（`rsync`），不做 `rm -rf`
- 运维文件（`.env`、`certs/`、`data/`、`logs/`）CI 永不触碰
- `deploy.ts` 在任何修改之前把 `.env` 快照为 `.env.previous`（回滚只取其中的
  `LUCENT_IMAGE`）；对 `.env` 的写入是行级替换（保留注释与格式），写完 `chmod 600`
- `prometheus/.rendered/` 与 `alertmanager/.rendered/` 含密钥，由
  `render-configs.sh` 在服务器本地生成，已 gitignore，不离开服务器

## .env 统一

一个 `.env` 文件承载所有配置。Docker Compose v2 自动从项目目录读取 `.env` 做变量替换。app 容器通过 `env_file: .env` 读取所有变量。

```bash
# ─── Compose Project ──────────────────────────────────────────
COMPOSE_PROJECT_NAME=lucent-production   # staging 改为 lucent-staging

# ─── Image（每次部署由 deploy.ts 更新此行） ──────────────────
LUCENT_IMAGE=hkccr.ccs.tencentyun.com/lucent/lucent:abc123

# ─── Postgres ─────────────────────────────────────────────────
POSTGRES_USER=lucent
POSTGRES_PASSWORD=<secret>

# ─── Redis ────────────────────────────────────────────────────
REDIS_PASSWORD=<secret>

# ─── Grafana ──────────────────────────────────────────────────
GRAFANA_ADMIN_PASSWORD=<secret>

# ─── Metrics Auth ──────────────────────────────────────────────
METRICS_USER=metrics_user
METRICS_PASSWORD=<secret>

# ─── Alerting / 企业微信（可选，四项配齐才启用 alertmanager） ──
WECOM_CORP_ID=
WECOM_CORP_SECRET=
WECOM_AGENT_ID=
WECOM_TO_USER=

# ─── 发布事件通知（可选，企业微信群机器人 webhook） ───────────
WECOM_WEBHOOK_URL=

# ─── 备份异地副本（可选，backup.sh 上传 COS） ─────────────────
COS_BUCKET=
COS_REGION=ap-guangzhou
COS_SECRET_ID=
COS_SECRET_KEY=

# ─── App Config ───────────────────────────────────────────────
JWT_ACCESS_SECRET=<secret>     # 生产环境最少 32 字符
JWT_REFRESH_SECRET=<secret>    # 生产环境最少 32 字符
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=<secret>
ADMIN_COOKIE_SECRET=<secret>
CORS_ORIGIN=https://your-domain.example
# ... 其他 app 环境变量
```

`METRICS_USER` / `METRICS_PASSWORD` 用于 `/metrics` 端点的 Basic Auth 认证，Prometheus 抓取时通过 `render-configs.sh` 渲染进配置。Nginx 层同时拦截外部对 `/metrics` 的直接访问（返回 403）。

`DATABASE_URL` 和 `REDIS_URL` 在 compose.yml 的 `environment:` 块中用 `${POSTGRES_PASSWORD}` / `${REDIS_PASSWORD}` 拼接，不直接写在 `.env` 中。

`LUCENT_IMAGE` 由 `deploy.ts` 自动更新（行级替换，其余行原样保留）。

`WECOM_*` / `COS_*` 等运维密钥只存在服务器 `.env`，不进 GitHub Secrets。修改
`METRICS_*` / `WECOM_*` 后需重跑 `./render-configs.sh` 并重启对应容器（见「告警」一节）。

## 首次准备

```bash
mkdir -p /opt/lucent/{certs,data/{postgresql,redis,prometheus,grafana,alertmanager,backups,node-exporter-textfile},logs/{app,nginx},nginx,prometheus/rules,alertmanager}
```

然后把这些本地文件放好：

```text
/opt/lucent/.env
/opt/lucent/certs/fullchain.pem
/opt/lucent/certs/privkey.pem
```

PostgreSQL 18 注意事项：

- 生产 compose 使用 `pgvector/pgvector:pg18`（与本地开发和 CI 一致），内置 `vector` 扩展
- 生产 compose 把宿主机目录挂到容器内 `/var/lib/postgresql`
- 不再使用旧的 `/var/lib/postgresql/data` 挂载方式
- `pgvector/pgvector:pg18` 会在挂载目录里自行创建版本化子目录
- 不设 `PGDATA` 环境变量

## 部署方式

GitHub Actions 做四件事：

1. 构建并推送 Lucent 镜像到 TCR（只推 `<git-sha>` tag，不推 `latest`）
2. 上传 deploy assets（scp 精确文件 + rsync grafana 目录，不做 `rm -rf`）
3. SSH 执行：`cd /opt/lucent && LUCENT_IMAGE=<ref> node deploy.ts`
4. `deploy.ts` 内部完成：部署前 DB 快照 → 停机 → migrate → 启动新容器 → 健康门禁 → smoke test

### 单 slot 部署流程

`deploy.ts` 接收 `LUCENT_IMAGE` 环境变量，共 12 步：

1. 前置检查：确认 compose.yml / nginx.conf / .env 存在，补齐目录，运行
   `render-configs.sh` 渲染监控配置（渲染失败仅警告，不阻塞发布）
2. 读取 `.env` 当前 `LUCENT_IMAGE` 作为回滚目标
3. 快照 `.env` → `.env.previous`（**在任何修改之前**，保证回滚总能拿到旧镜像）
4. 拉取基础设施镜像，启动 postgres + redis 并等待健康
5. 部署前 DB 快照：`pg_dump | gzip` → `data/backups/pre-deploy-<UTC 时间戳>.sql.gz`，
   保留最近 10 份。**快照失败则中止发布**——此时 app 还在运行，零影响
6. `docker compose stop app` —— **停机窗口开始**（SIGTERM，60s 优雅关闭，
   SSE 连接先收到终止事件再关闭，见「发布与 SSE」一节）
7. 用新镜像起独立容器执行 `prisma migrate deploy`（失败则重启旧版本 app，发布中止）
8. 更新 `.env` 中的 `LUCENT_IMAGE` 为新镜像
9. 启动 app 并过**健康门禁**：轮询容器健康状态（compose healthcheck 打
   `/api/v1/health`），最长约 150s；未通过则打印新容器最后 200 行日志，自动用上一
   镜像重启并判定发布失败
10. `nginx -s reload`：nginx 在配置加载时解析并缓存 upstream `app` 的容器 IP，app
    容器重建后 IP 变了必须 reload，否则全部 502（nginx 未运行则直接启动）
11. 运行 smoke test（失败同样自动恢复上一镜像）
12. 完成，输出容器状态

发布成功/失败/回滚事件会通过 `WECOM_WEBHOOK_URL`（企业微信群机器人，可选）发通知。

### 停机窗口与 Migration 纪律

- 部署顺序固定为 **stop → migrate → start**；migration 耗时计入停机窗口（总计
  15~45s），大表迁移需提前预告并选低峰时段发布
- **回滚只回滚应用版本，schema 不回退**（prisma migrate 只前进不后退）。自动恢复上一
  镜像时，旧代码必须能容忍已推进的 schema
- 破坏性变更仍建议拆两次发布（expand-contract），但从硬性要求降级为缩短停机 + 保证可
  回滚的优化项
- CI 在 PR 上用 `prisma migrate diff` 对比 base 分支 schema，检出
  `DROP TABLE` / `DROP COLUMN` / `TRUNCATE` / `SET DATA TYPE` 时打 warning 注解（不阻
  断），用于评估停机时长与回滚风险
- 每次部署前的 `pg_dump` 快照（步骤 5）是 schema 级兜底，恢复流程见
  [[how-to/restore-database-backup]]

### 回滚

```bash
cd /opt/lucent && node deploy.ts --rollback
```

或在 GitHub Actions 手动触发 `lucent-production.yml`，`action` 选 `rollback`。

回滚从 `.env.previous` 读取上一次部署的镜像 tag，执行 stop → 启动旧镜像 → 健康门禁 →
reload nginx → smoke test。**注意：数据库 schema 不回退**。

### 镜像 tag 策略

只使用 `<git-sha>` 作为镜像 tag，不使用 `latest`。TCR 需要配置镜像保留规则，至少保留最近 10 个 tag。

### 发布与 SSE（AI 流式响应）

单 slot 停机部署没有新旧实例 overlap，发布会掐断进行中的 SSE 流。缓解措施：

- 应用内 `SseConnectionRegistry`（`src/common/api/sse-connection-registry.service.ts`）
  追踪所有活跃 SSE 连接；收到 SIGTERM 后 `beforeApplicationShutdown` 先向每个连接推送
  终止 `error` 事件（`reason: 'server_shutdown'`）再关闭，客户端可据此重试或提示用户，
  而不是看到一个无声断流
- `stop_grace_period: 60s`，给 SSE 终止事件推送和 BullMQ worker 收尾留出时间
- 约定**低峰时段发布**；AI 流式生成动辄数分钟，停机窗口内的新请求由 nginx 直接拒
  （502/connection refused），前端按失败处理

## 手工排障

```bash
cd /opt/lucent
docker compose ps
docker compose logs --tail=200 app
docker compose logs --tail=200 nginx
docker compose down
docker compose up -d
```

注意：app 容器的 compose healthcheck 打的是 `/api/v1/health`（ready 语义，含 DB/Redis
探测）。运行时 DB/Redis 抖动会让容器变 unhealthy，但 Docker **不会**自动重启
unhealthy 容器，服务本身仍在跑；该状态主要影响部署时的健康门禁判断。排障时以
`docker compose logs app` 和 `/api/v1/health/deep` 为准。

## Staging 环境

两台独立服务器，各自完整的 `/opt/lucent/` 部署：

| 环境       | 服务器            | Compose Project Name | CD Workflow             |
| ---------- | ----------------- | -------------------- | ----------------------- |
| Staging    | staging 服务器    | `lucent-staging`     | `lucent-staging.yml`    |
| Production | production 服务器 | `lucent-production`  | `lucent-production.yml` |

流程：

1. PR 合并到 main → CI 成功自动触发 `lucent-staging.yml`，部署到 staging 服务器（也
   可手动 `workflow_dispatch`）
2. Staging 通过 smoke test → 人工验证
3. **人工确认后手动触发** `lucent-production.yml` 的 `workflow_dispatch`（`action` 选
   `deploy`，限 main 分支），部署到 production 服务器

生产部署**没有**自动触发器：单 slot 停机部署下，任何时间合并 main 都会制造一次停机
窗口，因此发布时间必须人工可控（低峰时段）。无需依赖 GitHub environment 的 required
reviewers 配置。

## 最低上线检查

```bash
curl http://127.0.0.1/api/v1/health
curl http://127.0.0.1/api/v1/health/live
curl http://127.0.0.1/api/v1/health/ready
curl -k https://your-domain.example/api/v1/health/ready

# /metrics 应被 Nginx 拦截
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1/metrics  # 预期 403

# /metrics 直连 app 容器需认证（app 端口不暴露到宿主机，需通过 docker exec）
docker exec lucent-app curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/metrics  # 预期 401
docker exec lucent-app curl -u ${METRICS_USER}:${METRICS_PASSWORD} http://127.0.0.1:3000/metrics  # 预期 200 + metrics
```

通过标准：

- `app`、`postgres`、`redis`、`nginx`、`prometheus`、`grafana` 容器在运行
- `/api/v1/health/ready` 返回 `200`
- Nginx 能正常反代 HTTPS 请求
- `/metrics` 通过 Nginx 返回 `403`
- `/metrics` 直连 app 容器无认证返回 `401`，有认证返回 `200`

## 部署后 Smoke Test

```bash
cd /opt/lucent
LUCENT_PUBLIC_BASE_URL=https://your-host-or-domain node smoke.ts
```

检查项：

- `postgres / redis / nginx / app` 四个 compose service 都在 `running`
- `http://127.0.0.1/api/v1/health`
- `http://127.0.0.1/api/v1/health/live`
- `http://127.0.0.1/api/v1/health/ready`
- `/metrics` 通过 Nginx 返回 `403`（被拦截）
- 如果配置了 `METRICS_USER` / `METRICS_PASSWORD`：
  - `/metrics` 通过 `docker exec` 在 app 容器内检查，无认证返回 `401`
  - `/metrics` 通过 `docker exec` 在 app 容器内检查，有认证返回 `200` 且包含 `lucent_` 前缀的指标
- 如果设置了 `LUCENT_PUBLIC_BASE_URL`，再检查一次公网 `https://.../api/v1/health/ready`

## 数据库备份

两条备份链路，互不干扰：

- **每日备份**：`backup.sh`（建议宿主机 cron 每日执行）→ `pg_dump | gzip` 到
  `data/backups/daily-<yyyymmdd-hhmmss>.sql.gz`，本地保留最近 7 份；配置了
  `COS_BUCKET` / `COS_REGION` / `COS_SECRET_ID` / `COS_SECRET_KEY` 且服务器装有
  `coscli`（优先）或 `coscmd` 时，自动上传到 COS 的 `backups/` 前缀。COS 侧 30 天保
  留用 bucket 生命周期规则配置，脚本不清理 COS
- **部署前快照**：`deploy.ts` 每次发布前自动执行（见部署流程步骤 5），
  `pre-deploy-<UTC 时间戳>.sql.gz` 保留最近 10 份

cron 示例：

```bash
# crontab -e
# 每天 03:17 备份（错开整点）
17 3 * * * cd /opt/lucent && ./backup.sh >> ./logs/backup.log 2>&1
```

恢复演练（每季度至少一次到 staging 验证）见
[[how-to/restore-database-backup]]。

## TLS 证书管理

证书以 `./certs` bind mount 注入 nginx，**续期仍是手工运维操作**（替换
`certs/fullchain.pem` / `privkey.pem` 后 `docker exec lucent-nginx nginx -s reload`）。

过期监控已自动化：`check-cert.sh` 解析证书 `notAfter`，通过 node-exporter textfile
collector 暴露 `lucent_cert_expiry_days` 指标，剩余 < 14 天触发 warning 告警、< 7 天
触发 critical 告警（走 Alertmanager，见「告警」一节）；同时向 stderr 打警告（cron 邮
件可见）。建议 cron 每小时执行：

```bash
# crontab -e
17 * * * * cd /opt/lucent && ./check-cert.sh
```

## 生产日志

生产环境日志双写：

1. **stdout JSON**：Winston 默认输出到 stdout，Docker json-file 驱动采集（50MB × 5 文件轮转）
2. **文件按天分割**：Winston 通过 `winston-daily-rotate-file` transport 写入 `/app/logs/` 目录（挂载到宿主机 `./logs/app/`），文件名格式 `lucent.YYYY-MM-DD.log`，单文件上限 500MB

每行日志在活跃 OTel span 内携带顶层 `trace_id`/`span_id` 字段（无 span 的启动、定时任务、队列
等上下文不注入），可直接 `jq` / `grep` 按 trace 检索单个请求的完整日志链，并关联 Jaeger 同一
链路（`OTEL_ENABLED=true` 时启用，见 ADR-0010）。成功请求由 Fastify `onResponse` hook 写一条
结构化完成日志（method/route/status/durationMs），`onSend` hook 回写 `traceresponse` 响应头。

Postgres 慢查询日志：compose 启动参数 `log_min_duration_statement=500`，超过 500ms
的语句写入容器日志（`docker logs lucent-postgres`，随 json-file 50m×5 轮转）。

日志文件清理（服务器 cron）：

```bash
# crontab -e
# 每天凌晨删除 30 天前的日志文件
0 3 * * * find /opt/lucent/logs/app -name "lucent.*.log" -mtime +30 -delete
```

## 安全加固

### 容器与网络

- 所有容器以非 root 用户运行（app 容器使用 `lucent` 用户）
- App 端口不暴露到宿主机（使用 `expose` 而非 `ports`）
- Postgres / Redis 端口不暴露到宿主机
- Redis 需要密码认证 + appendonly 持久化
- Docker 容器日志统一轮转（50MB × 5 文件）
- `.env` 由 deploy.ts 写入后 `chmod 600`

### Nginx 层

- 安全头：`X-Frame-Options`、`X-Content-Type-Options`、`Referrer-Policy`、`Strict-Transport-Security`
- gzip 压缩
- SSL OCSP stapling
- SSE 端点关闭缓冲，`proxy_read_timeout` 提高到 300s
- `/metrics` 端点在 Nginx 层直接返回 403，阻止外部访问
- 请求速率/连接数限制：`limit_req_zone`（每 IP 20r/s，burst 40）+ `limit_conn`（每
  IP 50 并发）；SSE 长连接路径只限并发连接数、不限请求速率（限速率会杀死已建立的流）

### 应用层（Helmet + 认证）

- **Helmet 中间件**：自动设置 HTTP 安全响应头（CSP、X-Content-Type-Options、X-Frame-Options、Strict-Transport-Security 等），与 Nginx 层安全头形成纵深防御
- **限流存储**：ThrottlerModule 使用进程内存存储（单实例部署下足够，计数器随进程重
  启清零）；Redis 用于 BullMQ 队列，不用于限流
- **`/metrics` Basic Auth**：当 `METRICS_USER` 和 `METRICS_PASSWORD` 同时配置时，`/metrics` 端点要求 Basic Auth 认证。Prometheus 通过 `basic_auth` 配置传递凭据
- **测试端点守卫**：`/api/v1/testing/*` 端点同时要求 JWT 认证和 `TESTING_SHARED_SECRET` 共享密钥守卫，仅在 `NODE_ENV=test` 时注册
- **Admin 面板认证**：AdminJS 凭据比较使用 `crypto.timingSafeEqual` 常量时间比较，防止计时攻击
- **验证码安全存储**：短信/邮件验证码以 SHA-256 哈希存入 Redis，验证时使用 `timingSafeEqual` 常量时间比较
- **报告分享链接安全**：分享 token 使用 `crypto.randomBytes(32)` 生成，缓存时仅存储 SHA-256 哈希
- **JWT 密钥强度**：生产环境强制要求 `JWT_ACCESS_SECRET` 和 `JWT_REFRESH_SECRET` 最少 32 字符
- **CORS**：生产环境 `CORS_ORIGIN` 显式指定允许的前端来源
- **`TRUST_PROXY`**：生产环境设置 `TRUST_PROXY=true`，确保 Fastify 正确解析 `X-Forwarded-*` 头

## 网络隔离

```text
backend 网络:       nginx, app, postgres, redis, prometheus, postgres-exporter, redis-exporter
observability 网络:  app, prometheus, grafana, node-exporter, alertmanager（profile 启用时）
```

Postgres 和 Redis 只在 `backend` 网络内，不暴露端口到宿主机。

## GitHub Secrets

### Production environment

```text
TCR_USERNAME
TCR_PASSWORD
DEPLOY_HOST
DEPLOY_PORT
DEPLOY_USER
DEPLOY_SSH_KEY
DEPLOY_SSH_KNOWN_HOSTS
GRAFANA_ADMIN_PASSWORD
METRICS_USER
METRICS_PASSWORD
```

### Staging environment

```text
STAGING_DEPLOY_HOST
STAGING_DEPLOY_PORT
STAGING_DEPLOY_USER
STAGING_DEPLOY_SSH_KEY
STAGING_DEPLOY_SSH_KNOWN_HOSTS
```

运维密钥（`WECOM_*`、`COS_*` 等）不进 GitHub Secrets，只配置在服务器 `.env`。

## 可观测性

生产 compose 的监控组件：

| 容器                       | 镜像                                            | 端口/地址        | 说明                                                               |
| -------------------------- | ----------------------------------------------- | ---------------- | ------------------------------------------------------------------ |
| `lucent-prometheus`        | `prom/prometheus:v3.4.2`                        | `127.0.0.1:9090` | 15s 间隔 scrape app/postgres/redis/node 四类 target，15 天数据保留 |
| `lucent-grafana`           | `grafana/grafana:12.1.0`                        | `127.0.0.1:3001` | 预置 Prometheus 数据源和 Lucent Backend Overview 仪表盘            |
| `lucent-alertmanager`      | `prom/alertmanager:v0.28.1`                     | 仅容器网络       | 企业微信应用消息告警，profile=alerting，默认不启动                 |
| `lucent-postgres-exporter` | `prometheuscommunity/postgres-exporter:v0.18.1` | 仅容器网络       | DB 连接数/锁/缓存命中等指标                                        |
| `lucent-redis-exporter`    | `oliver006/redis_exporter:v1.75.0`              | 仅容器网络       | Redis 内存/命中率等指标                                            |
| `lucent-node-exporter`     | `prom/node-exporter:v1.9.1`                     | 仅容器网络       | 宿主机 CPU/内存/磁盘水位 + textfile collector（证书过期指标）      |

Prometheus 和 Grafana 的端口只绑定 `127.0.0.1`，不暴露公网，Nginx 不代理。通过 SSH
隧道访问：

```bash
# Grafana
ssh -L 3001:localhost:3001 user@server
# Prometheus
ssh -L 9090:localhost:9090 user@server
```

node-exporter 走容器 bridge 网络（不把 9100 暴露到宿主机网卡），network 指标只反映
容器 netns（已知取舍）；CPU/内存/磁盘/textfile 指标均来自挂载的宿主机
`/proc`、`/sys`、`/`，不受影响。

### 配置模板渲染

`prometheus/prometheus.yml` 和 `alertmanager/alertmanager.yml` 是**模板**（含
`${METRICS_*}` / `${WECOM_*}` 占位符），Prometheus/Alertmanager 均不支持配置内环境变
量插值。由宿主机 `render-configs.sh` 渲染到 `.rendered/` 子目录后挂载使用：

- `deploy.ts` 每次发布在 pre-flight 自动调用（失败仅警告，不阻塞发布）
- 手动修改 `.env` 的 `METRICS_*` / `WECOM_*` 后需重跑并重启对应容器：

```bash
cd /opt/lucent
./render-configs.sh
docker compose up -d prometheus
docker compose --profile alerting up -d alertmanager
```

### 告警

告警规则在 `deploy/prometheus/rules/lucent.yml`（CI 管理，直接挂载），severity 约定：
critical = 立即处理，warning = 关注趋势。当前规则：

- **可用性**：`LucentDown`（app 不可达 1m）、`LucentHigh5xxRate`（5xx 占比 > 5% 持续 5m）
- **队列**：`BullMQJobFailures`（15m 失败任务 > 5）、`BullMQWaitingBacklog`（等待任务
  > 100 持续 10m）
- **运行时**：`NodeEventLoopLagHigh`（event loop lag p99 > 0.5s 持续 10m）
- **宿主机**：`HostDiskSpaceLow`（根分区可用 < 15%）、`HostDiskSpaceCritical`（< 10%）
- **证书**：`LucentCertExpiryWarning`（< 14 天）、`LucentCertExpiryCritical`（< 7 天），
  指标来自 `check-cert.sh` 的 textfile collector

通知通道：Alertmanager 原生 `wechat_configs`（企业微信应用消息，无第三方 webhook
adapter）。启用步骤：

1. `.env` 配齐 `WECOM_CORP_ID` / `WECOM_CORP_SECRET` / `WECOM_AGENT_ID` / `WECOM_TO_USER`
2. `./render-configs.sh`（WECOM\_\* 配齐时才会生成 `.rendered/alertmanager.yml`）
3. `docker compose --profile alerting up -d`

未启用 alertmanager 时 Prometheus 只会报 DNS 解析失败日志，规则照常评估，不影响指
标采集。发布成功/失败/回滚事件走另一条独立通道：`WECOM_WEBHOOK_URL` 群机器人
（deploy.ts 内置 curl，只需一个 webhook URL）。

## 服务器前置要求

- Docker Engine 26+（Compose v2 内置）
- Node.js 24+（运行 `deploy.ts`，支持原生 TypeScript 类型擦除和 ESM）
- `curl`（smoke test 健康检查、发布通知 webhook）
- `rsync`（同步 grafana 目录）
- `openssl` + GNU `date`（`check-cert.sh` 证书过期检查）
- 可选：`coscli` 或 `coscmd`（`backup.sh` 上传 COS 异地副本）
