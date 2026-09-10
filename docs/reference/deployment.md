---
status: active
owner: backend
quadrant: reference
updated: 2026-09-10
---

# Lucent Deployment

> 当前有两套并行模型(2026-09-10 起):
>
> - **production** — 仓库 `compose.yaml`(含 app)在 Coolify 注册为 Docker Compose Service,
>   镜像由 GitHub Actions 构建推送,反代/TLS 由 Coolify 自带 Traefik 接管;
> - **staging** — 应用以原生 Node + PM2 跑在宿主机(`/opt/lucent`),依赖的
>   postgres/redis/指标栈/自建 Traefik 由根 `compose.staging.yaml` 自管,
>   推送 main 即部署。
>
> 决策见 [ADR-0017](adr/0017-coolify-deployment.md)(2026-09-10 修订);
> 操作步骤见 [howto/deploy.md](../howto/deploy.md)。旧的 ADR-0004 模型
> (GitHub Actions + 腾讯 TCR + `deploy.ts` 单 slot 停机部署 + Nginx)已退役。

## Staging(原生 PM2 + 自建 Traefik)

### 拓扑

```
push main ──► lucent-staging(.github/workflows/lucent-staging.yml)
                │  ssh root@<staging-host>
                └─ cd /opt/lucent
                   pm2 stop → git reset --hard origin/main → pnpm install
                   → prisma:generate + build → prisma migrate deploy
                   → pm2 startOrReload → 健康门禁

                    ┌─ Traefik 容器(80/443,file provider)────────┐
公网 ── 443 ────────┤  api.<域名>      → host.docker.internal:3000  │
                    │  metrics.<域名>  → victoriametrics:8428  ┐    │
                    │  logs.<域名>     → victorialogs:9428     ├ BasicAuth
                    │  traefik.<域名>  → api@internal          ┘    │
                    └──────────────────┬───────────────────────────┘
宿主机(root,Node 24 + pnpm + PM2)
  /opt/lucent ── pm2 `lucent` ── dist/main.js ── 127.0.0.1:3000
       │ DATABASE_URL / REDIS_URL / VICTORIALOGS_URL 走 127.0.0.1
       ▼
容器(compose.staging.yaml,project `lucent-staging`)
  postgres · redis · victoriametrics · victorialogs(+ traefik,见上)
```

### 组件与端口

| 服务            | 运行方式                                | 端口                       | 说明                                                                    |
| --------------- | --------------------------------------- | -------------------------- | ----------------------------------------------------------------------- |
| app             | 宿主 PM2(`deploy/ecosystem.config.cjs`) | 宿主 `0.0.0.0:3000`        | `cwd=/opt/lucent`,日志 `logs/pm2-*.log`;健康检查 `/api/v1/health/ready` |
| postgres        | 容器 `pgvector/pgvector:pg18`           | `127.0.0.1:5432`           | 卷 `postgres-data`                                                      |
| redis           | 容器 `redis:8-alpine`                   | `127.0.0.1:6379`           | requirepass + appendonly;卷 `redis-data`                                |
| victoriametrics | 容器 `victoria-metrics:v1.128.0`        | `127.0.0.1:8428`           | 抓宿主 `host.docker.internal:3000/metrics`;保留 15d                     |
| victorialogs    | 容器 `victoria-logs:v1.51.1`            | `127.0.0.1:9428`           | 接收 Winston JSON 日志;保留 15d                                         |
| traefik         | 容器 `traefik:v3.6`                     | `80` / `443`(唯一公网入口) | 证书存卷 `letsencrypt`;配置见下                                         |

容器端口一律只绑回环:应用经回环访问数据库与日志库,公网只经 Traefik,TLS 与面板
BasicAuth 都由 Traefik 终止,不再依赖云安全组收口。

### 配置与密钥

- **应用运行时**:仓库根 `.env.production`(gitignored,不入库),应用按
  `NODE_ENV=production` 自动加载(`src/config/env/env-file-paths.ts`);
  `TRUST_PROXY=true` 必须开启,否则经 Traefik 后限流取不到真实客户端 IP;
  `VICTORIALOGS_URL=http://127.0.0.1:9428/insert/jsonline`(容器端口发布到回环)。
- **同一份 `.env.production` 也供 compose 插值**:`docker compose -f compose.staging.yaml
--env-file .env.production ...`,需要 `POSTGRES_PASSWORD`、`REDIS_PASSWORD`、
  `METRICS_USER`、`METRICS_PASSWORD`。**注意** `DATABASE_URL` / `REDIS_URL` 里内嵌的
  密码必须与 `POSTGRES_PASSWORD` / `REDIS_PASSWORD` 一致(改密码要改两处)。
- **Traefik 配置不走环境变量**:`deploy/traefik/*.yml` 是服务器本地的 gitignored 文件
  (由仓库里的 `.example` 模板复制而来),域名、邮箱、面板密码哈希直接改文件;
  改完 `docker compose ... restart traefik`(单文件 bind-mount 的 fsnotify 不可靠)。
- **GitHub Actions**(environment `staging`):secrets `STAGING_SSH_HOST` /
  `STAGING_SSH_USER`(root)/ `STAGING_SSH_KEY` / 可选 `STAGING_SSH_PORT`、
  `STAGING_SSH_KNOWN_HOSTS`;variable `STAGING_API_HOST`(发布后公共健康检查用)。

### 发布

1. 推送到 `main` → `lucent-staging` **立即**部署(不等 `lucent-ci` 结果、无人工批准)。
2. 远端串行执行:`pm2 stop lucent` → `git fetch --prune origin && git reset --hard origin/main`
   → `pnpm install --frozen-lockfile` → `pnpm prisma:generate && pnpm build`
   → `NODE_ENV=production pnpm exec prisma migrate deploy`
   → `pm2 startOrReload deploy/ecosystem.config.cjs --update-env` → `pm2 save`
   → 本机健康门禁(`/api/v1/health/ready`)→ 工作流再做一次公共健康检查(`/api/v1/health/deep`)。
3. 停机窗口 = 上述第 2 步全程(含构建,通常 1–3 分钟);SSE 连接会先收到终止事件再关闭。
4. 手动发布/重发:SSH 登录后敲同一串命令(原文见
   [howto/deploy.md](../howto/deploy.md))。
5. **回滚不做**:模型是 fix-forward —— 需要回旧版本时手动
   `git checkout <旧 sha>` 后重跑同一串命令;数据库迁移不回退,破坏性变更继续
   expand-contract。
6. 基础设施(容器)变更不随应用发布自动生效:改 `compose.staging.yaml` 后手动
   `docker compose -f compose.staging.yaml --env-file .env.production up -d`。

### 面板与指标

- 三个面板域名都挂 BasicAuth(`401` 未认证):`metrics.<域名>`(VictoriaMetrics VMUI)、
  `logs.<域名>`(VictoriaLogs UI,LogsQL 按 `trace_id` 检索)、`traefik.<域名>`
  (Traefik dashboard:反代自身的路由 / 服务 / 中间件 / 证书与 ACME 状态)。
- `/metrics` 仍由应用的 `METRICS_USER` / `METRICS_PASSWORD` 做 Basic Auth;
  抓取配置 `monitoring/victoriametrics/vmscraper.staging.yml` 的目标是
  `host.docker.internal:3000`。
- 面板不是公网必需时,可直接编辑那两个 traefik 配置文件删掉对应路由(不影响 api 路由)。

### 排障速查(staging)

- 应用起不来:`pm2 status` / `pm2 logs lucent --lines 100`;再不行看
  `/api/v1/health/deep` 输出。
- 域名打不开或 502:先看 `traefik.<域名>` 面板(dashboard)确认路由与证书状态;
  502 多数是 `host.docker.internal` 解析问题(容器缺 `extra_hosts: host-gateway`)
  或 PM2 进程没起来。
- 数据库连不上:确认容器 healthy(`docker compose -f compose.staging.yaml ps`)、
  `.env.production` 里 `DATABASE_URL` 的密码与 `POSTGRES_PASSWORD` 一致。
- 证书没签发:确认 DNS 已指向该机、80 可达(或 CDN 放行 `/.well-known/acme-challenge/`),
  再看 traefik 容器日志的 ACME 报错。
- 指标为空:确认 victoriametrics 容器带 `-promscrape.config=/etc/vmscraper.yml`,
  且 `METRICS_*` 两侧一致。

## Production(Coolify)

### 拓扑

```
GitHub (CI/CD)                              Coolify 控制面
┌──────────────────────┐                    ┌───────────────────────────────┐
│ lucent-ci            │  push 镜像到       │ Coolify UI                   │
│  lint/test/build     │  发布者自己的      │  Docker Compose Service 资源  │
│ lucent-production    │  registry          │  (粘贴 compose.yaml)          │
│  build Dockerfile    ├───────────────────▶│                               │
│  → registry          │                    │  Traefik(自动装)              │
└──────────────────────┘                    │   ├── 域名 → app:3000 + TLS   │
                                            └───────────────┬───────────────┘
                                                            │ SSH / docker
                                            目标服务器(Coolify 纳管)
                                            ┌───────────────────────────────┐
                                            │ postgres / redis / app        │
                                            │ victoriametrics / grafana     │
                                            │ victorialogs / node-exporter  │
                                            └───────────────────────────────┘
```

- **编排单一事实源**:`compose.yaml`(production,app + postgres + redis +
  victoriametrics + grafana + victorialogs + node-exporter)。
- **反向代理 / TLS**:Coolify 在被管服务器自动安装 Traefik;域名、HTTPS 证书在
  Coolify 面板配置,不再有 Nginx、`certs/`、`check-cert.sh`。
- **镜像**:CI/CD 构建并推送发布者自有镜像仓库,仓库名由 GitHub secret
  `REGISTRY_IMAGE` 注入(**公开仓库代码不写死用户名/镜像地址**);
  镜像 tag 见下文。
- **日志**:应用只写 stdout(容器/Coolify 收集)+ VictoriaLogs
  (`VICTORIALOGS_URL` 由 compose 注入),不写文件系统。

### 组件与端口

| 服务              | 镜像                        | 端口        | 说明                                                                 |
| ----------------- | --------------------------- | ----------- | -------------------------------------------------------------------- |
| `app`             | `${LUCENT_IMAGE}`(完整引用) | 仅内网 3000 | 公网入口 = Coolify 域名路由;健康检查 `/api/v1/health`                |
| `postgres`        | `pgvector/pgvector:pg18`    | 无          | 卷 `postgres-data`                                                   |
| `redis`           | `redis:8-alpine`            | 无          | 卷 `redis-data`;requirepass                                          |
| `victoriametrics` | `victoria-metrics:v1.128.0` | `8428:8428` | 抓 app `/metrics` 与 node-exporter;卷 `victoriametrics-data`         |
| `grafana`         | `grafana:12.1.0`            | `3001:3000` | provisioning/dashboards 来自 `monitoring/grafana/`;卷 `grafana-data` |
| `victorialogs`    | `victoria-logs:v1.15.0`     | `9428:9428` | 接收 Winston JSON 日志;卷 `victorialogs-data`                        |
| `node-exporter`   | `node-exporter:v1.9.1`      | 无          | 宿主机 CPU/内存/磁盘指标                                             |

端口映射(8428/9428/3001)直接发布宿主机,**公网访问由云厂商安全组收口**。
`/metrics` 端点 Basic Auth 由 `METRICS_USER` / `METRICS_PASSWORD` 控制。

### 环境变量

- 变量清单与语义见 [environment-variables.md](environment-variables.md),
  模板见仓库根 `.env.production.example`。
- compose 插值所需变量(在 Coolify 服务环境变量中配置):
  `POSTGRES_PASSWORD`、`REDIS_PASSWORD`、`LUCENT_IMAGE`、`METRICS_USER`、
  `METRICS_PASSWORD`、`GRAFANA_ADMIN_PASSWORD`;
  `DATABASE_URL` / `REDIS_URL` 由 compose 的 `environment` 块拼接,不需手填。
  `LUCENT_IMAGE` 是 app 的**完整镜像引用**(把 `<你的用户名>` 换成自己的
  Docker Hub 用户名,示例 `<你的用户名>/lucent:1a2b3c4d`)。
- app 的其余运行时变量经 `env_file: [.env]` 注入:在 Coolify 面板粘贴完整变量表
  (Coolify 会写入服务目录的 `.env`)。
- GitHub Actions secrets:`DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN`(登录镜像仓库)、
  `REGISTRY_IMAGE`(发布镜像仓库引用)。

### 镜像 tag 策略

- **production** 只推 `<git sha 前 8 位>`,**不推 `latest`**;`latest` 不再有消费者
  (staging 已改为原生部署,不再使用镜像)。
- `compose.yaml` 的 `LUCENT_IMAGE` 填完整引用 `<你的用户名>/lucent:<短 sha>`;
  **生产发布固定短 sha**(在 Coolify 面板维护),回滚 = 把 `LUCENT_IMAGE` 改回旧短 sha
  的完整引用再重启,天然可回退。

### 发布与迁移

1. 手动触发 `lucent-production`(`workflow_dispatch`,main)构建推送镜像。
2. 在 Coolify 面板把服务的 `LUCENT_IMAGE` 更新为含新短 sha 的完整引用。
3. **Pull Latest Images & Restart**;容器启动时 `entrypoint.sh` 自动执行
   `prisma migrate deploy`,失败则容器不启动(不会带坏 schema 上线)。
4. 验证:`curl https://<domain>/api/v1/health/deep`。

发布窗口:单 slot 停机(容器重建期间 ~15–45s),SSE 连接会收到终止事件后关闭,
建议低峰发布。

## 监控与告警(现状)

- **保留指标**:VictoriaMetrics + Grafana(production;看板 `monitoring/grafana/dashboards/`)。
- **staging** 无 Grafana,直接用 VMUI(经 `metrics.<域名>` 面板路由)。
- **告警已退役**:vmalert / alertmanager / 告警规则已删除,**当前不配置告警通知**。
- **备份未启用**:当前不做数据库自动备份;生产上线前应在 Coolify 的 postgres 组件
  开启定时备份(S3)或另行安排 `pg_dump` 运维。

## 日志

- **staging**:PM2 日志 `logs/pm2-*.log`(服务器本地)+ VictoriaLogs
  (`logs.<域名>` 面板);容器日志 `docker compose -f compose.staging.yaml logs`。
- **production**:stdout(Coolify 面板 / `docker logs`)+ VictoriaLogs
  (`http://<host>:9428`,安全组收口)。
- 字段约定见 [logging-conventions.md](logging-conventions.md);OpenTelemetry
  trace 注入见 ADR-0010/0016。按 `trace_id` 检索时在搜索框输入 `trace_id:xxx`。

## 服务器前置要求

- **staging**:Node 24(`.node-version` / `package.json#engines`)+ pnpm 12(corepack
  或全局安装)+ PM2(全局安装并以 root `pm2 startup` 注册开机自启)+ Docker 20.10+
  (需要 `host-gateway`);DNS 已指向该机、80/443 放行;无需云安全组额外收口
  (容器端口只绑回环)。首次接入步骤见 [howto/deploy.md](../howto/deploy.md)。
- **production**:目标服务器加入 Coolify(Servers → Add Server,Coolify 自动装
  Docker + Agent + Traefik);云安全组按需放行 `3001` / `8428` / `9428`(指标栈),
  `80` / `443` 交给 Coolify Traefik。
