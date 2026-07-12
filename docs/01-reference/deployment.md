# Lucent Deployment

Last updated: 2026-07-11

这份文档描述当前生产部署模型：Docker Compose 单机部署 + Blue-Green 零停机切换。

## 目录结构

服务器上只有一个目录：

```text
/opt/lucent/
├── compose.yml                   ← CI 管理（每次覆盖上传）
├── deploy.ts                     ← CI 管理
├── smoke.ts                      ← CI 管理
├── nginx/
│   └── nginx.conf                ← CI 管理
├── prometheus/
│   └── prometheus.yml            ← CI 管理
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
├── .env.previous                 ← deploy.ts 自动管理（回滚用）
├── certs/                        ← 运维管理
│   ├── fullchain.pem
│   └── privkey.pem
├── data/                         ← 运维管理
│   ├── postgresql/
│   ├── redis/
│   ├── prometheus/
│   └── grafana/
└── logs/                         ← 运维管理
    ├── app/                      ← Winston 按天分割的日志文件
    └── nginx/
```

核心原则：

- 一个目录 `/opt/lucent/`，不区分 `app/` 和 `server/`
- CI 只覆盖上传具体文件（`scp`）和目录（`rsync`），不做 `rm -rf`
- 运维文件（`.env`、`certs/`、`data/`、`logs/`）CI 永不触碰
- `deploy.ts` 自动管理 `.env.previous`（部署成功后快照 `.env`）

## .env 统一

一个 `.env` 文件承载所有配置。Docker Compose v2 自动从项目目录读取 `.env` 做变量替换。app 容器通过 `env_file: .env` 读取所有变量。

```bash
# ─── Compose Project ──────────────────────────────────────────
COMPOSE_PROJECT_NAME=lucent-production   # staging 改为 lucent-staging

# ─── Image（每次部署由 deploy.ts 更新此行） ──────────────────
LUCENT_IMAGE=hkccr.ccs.tencentyun.com/lucent/lucent:abc123

# ─── Blue-Green ───────────────────────────────────────────────
ACTIVE_SLOT=blue

# ─── Postgres ─────────────────────────────────────────────────
POSTGRES_USER=lucent
POSTGRES_PASSWORD=<secret>

# ─── Redis ────────────────────────────────────────────────────
REDIS_PASSWORD=<secret>

# ─── Grafana ──────────────────────────────────────────────────
GRAFANA_ADMIN_PASSWORD=<secret>

# ─── App Config ───────────────────────────────────────────────
JWT_ACCESS_SECRET=<secret>
JWT_REFRESH_SECRET=<secret>
# ... 其他 app 环境变量
```

`DATABASE_URL` 和 `REDIS_URL` 在 compose.yml 的 `environment:` 块中用 `${POSTGRES_PASSWORD}` / `${REDIS_PASSWORD}` 拼接，不直接写在 `.env` 中。

`LUCENT_IMAGE` 和 `ACTIVE_SLOT` 由 `deploy.ts` 自动更新。

## 首次准备

```bash
mkdir -p /opt/lucent/{certs,data/{postgresql,redis,prometheus,grafana},logs/{app,nginx}}
```

然后把这些本地文件放好：

```text
/opt/lucent/.env
/opt/lucent/certs/fullchain.pem
/opt/lucent/certs/privkey.pem
```

PostgreSQL 18 注意事项：

- 生产 compose 把宿主机目录挂到容器内 `/var/lib/postgresql`
- 不再使用旧的 `/var/lib/postgresql/data` 挂载方式
- `postgres:18` 会在挂载目录里自行创建版本化子目录
- 不设 `PGDATA` 环境变量

## 部署方式

GitHub Actions 做四件事：

1. 构建并推送 Lucent 镜像到 TCR（只推 `<git-sha>` tag，不推 `latest`）
2. 上传 deploy assets（scp 精确文件 + rsync grafana 目录，不做 `rm -rf`）
3. SSH 执行：`cd /opt/lucent && LUCENT_IMAGE=<ref> node deploy.ts`
4. `deploy.ts` 内部完成：migrate → Blue-Green 切换 → smoke test

### Blue-Green 切换流程

`deploy.ts` 接收 `LUCENT_IMAGE` 环境变量，读写 `.env` 中的 `ACTIVE_SLOT`：

1. 前置检查：确认 compose.yml / nginx.conf / .env 存在
2. 读取 `ACTIVE_SLOT`（blue/green），确定 inactive slot
3. 更新 `.env` 中的 `LUCENT_IMAGE`
4. 启动基础设施（postgres、redis）
5. 独立容器执行 `prisma migrate deploy`
6. 启动 inactive slot 的 app 容器
7. 等待健康检查通过（失败则停止，不影响线上）
8. 重写 `nginx.conf` 中的 upstream 块，切换 active/inactive
9. `nginx -s reload` 热加载（零停机）
10. 停止旧 active slot
11. 更新 `.env` 中 `ACTIVE_SLOT`
12. 快照 `.env` → `.env.previous`（回滚用）
13. 运行 smoke test（失败则自动回滚）

### 回滚

```bash
cd /opt/lucent && node deploy.ts --rollback
```

回滚从 `.env.previous` 读取上一次成功部署的镜像和 slot。

### 镜像 tag 策略

只使用 `<git-sha>` 作为镜像 tag，不使用 `latest`。TCR 需要配置镜像保留规则，至少保留最近 10 个 tag。

## 手工排障

```bash
cd /opt/lucent
docker compose ps
docker compose logs --tail=200 app-blue
docker compose logs --tail=200 nginx
docker compose down
docker compose up -d
```

## Staging 环境

两台独立服务器，各自完整的 `/opt/lucent/` 部署：

| 环境       | 服务器            | Compose Project Name | CD Workflow             |
| ---------- | ----------------- | -------------------- | ----------------------- |
| Staging    | staging 服务器    | `lucent-staging`     | `lucent-cd-staging.yml` |
| Production | production 服务器 | `lucent-production`  | `lucent-cd.yml`         |

流程：

1. PR 合并到 main → 自动触发 `lucent-cd-staging.yml`，部署到 staging 服务器
2. Staging 通过 smoke test → 通知
3. 人工确认后手动触发 `lucent-cd.yml` 的 `workflow_dispatch`，部署到 production 服务器

## 最低上线检查

```bash
curl http://127.0.0.1/api/v1/health
curl http://127.0.0.1/api/v1/health/live
curl http://127.0.0.1/api/v1/health/ready
curl -k https://your-domain.example/api/v1/health/ready
```

通过标准：

- `app-blue` 或 `app-green`（至少一个）、`postgres`、`redis`、`nginx`、`prometheus`、`grafana` 容器在运行
- `/api/v1/health/ready` 返回 `200`
- Nginx 能正常反代 HTTPS 请求

## 部署后 Smoke Test

```bash
cd /opt/lucent
LUCENT_PUBLIC_BASE_URL=https://your-host-or-domain node smoke.ts
```

检查项：

- `postgres / redis / nginx` 三个 compose service 都在 `running`
- `app-blue` 或 `app-green` 至少一个在 `running`
- `http://127.0.0.1/api/v1/health`
- `http://127.0.0.1/api/v1/health/live`
- `http://127.0.0.1/api/v1/health/ready`
- 如果设置了 `LUCENT_PUBLIC_BASE_URL`，再检查一次公网 `https://.../api/v1/health/ready`

## 生产日志

生产环境日志双写：

1. **stdout JSON**：Winston 默认输出到 stdout，Docker json-file 驱动采集（50MB × 5 文件轮转）
2. **文件按天分割**：Winston 通过 `winston-daily-rotate-file` transport 写入 `/app/logs/` 目录（挂载到宿主机 `./logs/app/`），文件名格式 `lucent.YYYY-MM-DD.log`，单文件上限 500MB

日志文件清理（服务器 cron）：

```bash
# crontab -e
# 每天凌晨删除 30 天前的日志文件
0 3 * * * find /opt/lucent/logs/app -name "lucent.*.log" -mtime +30 -delete
```

## 安全加固

- 所有容器以非 root 用户运行（app 容器使用 `lucent` 用户）
- App 端口不暴露到宿主机（使用 `expose` 而非 `ports`）
- Postgres / Redis 端口不暴露到宿主机
- Redis 需要密码认证 + appendonly 持久化
- Docker 容器日志统一轮转（50MB × 5 文件）
- Nginx 安全头：`X-Frame-Options`、`X-Content-Type-Options`、`Referrer-Policy`、`Strict-Transport-Security`
- Nginx gzip 压缩
- Nginx SSL OCSP stapling
- SSE 端点关闭缓冲，`proxy_read_timeout` 提高到 300s

## 网络隔离

```text
backend 网络:       nginx, app-blue, app-green, postgres, redis, prometheus
observability 网络:  app-blue, app-green, prometheus, grafana
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
```

### Staging environment

```text
STAGING_DEPLOY_HOST
STAGING_DEPLOY_PORT
STAGING_DEPLOY_USER
STAGING_DEPLOY_SSH_KEY
STAGING_DEPLOY_SSH_KNOWN_HOSTS
```

## 可观测性

生产 compose 包含 Prometheus 和 Grafana 两个容器：

| 容器                | 镜像                     | 端口 | 说明                                                                                   |
| ------------------- | ------------------------ | ---- | -------------------------------------------------------------------------------------- |
| `lucent-prometheus` | `prom/prometheus:v3.4.2` | 9090 | 从 `app-blue:3000` 和 `app-green:3000` 的 `/metrics` 以 15s 间隔 scrape，15 天数据保留 |
| `lucent-grafana`    | `grafana/grafana:12.1.0` | 3001 | 预置 Prometheus 数据源和 Lucent Backend Overview 仪表盘                                |

这两个端口不暴露到公网，Nginx 不代理。通过 SSH 隧道访问：

```bash
# Grafana
ssh -L 3001:localhost:3001 user@server
# Prometheus
ssh -L 9090:localhost:9090 user@server
```

Prometheus 会自动标记不可达的 target（inactive slot）为 down，不影响仪表盘。

## 服务器前置要求

- Docker Engine 26+（Compose v2 内置）
- Node.js 24+（运行 `deploy.ts`）
- `rsync`（同步 grafana 目录）
