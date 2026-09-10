# Staging 部署迁移:Coolify → 原生 PM2 + 自建 Traefik + 推送即部署

Created: 2026-09-10
Revised: 2026-09-10(按评审意见简化:去掉发布脚本/接入脚本与回滚、root 运行、compose 与 env 留根目录、traefik 不用环境变量插值、面板走 Traefik+BasicAuth、原地修订 ADR-0017)

## 一、背景

staging 当前走 Coolify:CI 构建镜像推 Docker Hub → `curl` Coolify webhook → Coolify 拉镜像重建
compose Service,反代/TLS 由 Coolify 自带 Traefik 接管(ADR-0017)。服务器侧已移除 Coolify,
80/443 空闲,无需要保留的数据。目标是把 staging 换成一条**推送即部署**的链路:GitHub Actions
SSH 登录 staging 机执行 `pm2 stop → git 同步 → 装依赖 → 构建 → 迁移 → pm2 启动`,反代/TLS 由仓库
里自管配置的 Traefik 承担。production 维持 ADR-0017 的 Coolify + 镜像模型不动。

### 决策基线

| 维度         | 结论                                                                                                              |
| ------------ | ----------------------------------------------------------------------------------------------------------------- |
| Coolify 归属 | staging 整机脱离 Coolify:postgres/redis/VictoriaMetrics/VictoriaLogs/traefik 由根目录 `compose.staging.yaml` 自管 |
| 应用运行     | 宿主原生 Node + PM2,**root 用户**运行;代码目录 `/opt/lucent`                                                      |
| 构建位置     | 服务器侧:`git 同步` + `pnpm install` + `pnpm build`                                                               |
| 触发方式     | **push main 即部署,不等 CI 结果**;无人工批准(`environment: staging` 只用于存放 secrets)                           |
| 停机顺序     | `pm2 stop → git 同步 → install → build → migrate → pm2 启动`(停机窗口包含构建)                                    |
| 回滚         | **不做**;需要时手动 `git checkout <旧 SHA>` 重跑同一串命令(fix-forward)                                           |
| 发布脚本     | **不新增任何脚本**:发布链路内联在 workflow 的 SSH 命令里,手动发布 = 服务器上敲同一串命令                          |
| Traefik      | Docker 容器,配置文件直接挂载;**不使用环境变量插值**,域名/邮箱/BasicAuth 哈希在服务器上 vim 改                     |
| 面板与指标   | Traefik dashboard、VictoriaMetrics、VictoriaLogs 全部走 Traefik 路由 + BasicAuth;容器端口只绑 `127.0.0.1`         |
| 配置文件位置 | compose 与 env 都留在仓库根目录(服务器就是整个 git clone)                                                         |
| ADR          | **原地修订 ADR-0017**,不新增 ADR 文件                                                                             |

## 二、目标链路

```
push main ──────────────► lucent-staging(不再依赖 lucent-ci 结果)
                              │
                              └─ ssh root@<staging-host> bash -s <<'EOF'
                                   set -euo pipefail
                                   cd /opt/lucent
                                   pm2 stop lucent || true
                                   git fetch --prune origin && git reset --hard origin/main
                                   pnpm install --frozen-lockfile
                                   pnpm prisma:generate && pnpm build
                                   NODE_ENV=production pnpm exec prisma migrate deploy
                                   pm2 startOrReload deploy/ecosystem.config.cjs --update-env
                                   pm2 save
                                   curl -fsS http://127.0.0.1:3000/api/v1/health/ready
                                 EOF

手动发布 = ssh root@<staging-host> 后逐条执行上面同一串命令(文档给出原文)
```

### 服务器拓扑

```
                    ┌─ Traefik(容器,80/443,配置文件挂载)─────────┐
公网 ── 443 ────────┤  api 域名   → host.docker.internal:3000     │
                    │  metrics    → victoriametrics:8428 (BasicAuth)│
                    │  logs       → victorialogs:9428    (BasicAuth)│
                    │  dashboard  → api@internal        (BasicAuth)│
                    └──────────────────┬──────────────────────────┘
                                       │
宿主机(root,Node 24.16 + pnpm + PM2)
  /opt/lucent ── pm2 `lucent` ── dist/main.js ── 127.0.0.1:3000
       │                                              │
       │ DATABASE_URL / REDIS_URL 走 127.0.0.1         │ /metrics(Basic Auth)
       ▼                                              ▼
容器(compose.staging.yaml,端口只绑 127.0.0.1)
  postgres(pgvector:pg18) · redis:8-alpine · victoriametrics · victorialogs · traefik
```

- app 不在容器里:`cwd=/opt/lucent`,`kill_signal: SIGTERM` 配合 `app.enableShutdownHooks()` 排空 SSE,
  日志 `logs/pm2-*.log`。
- postgres/redis 端口绑 `127.0.0.1`,app 经回环连接;VictoriaMetrics 抓 app 走
  `host.docker.internal:3000`(容器加 `extra_hosts: host-gateway`);VictoriaLogs ingest 走
  `http://127.0.0.1:9428/insert/jsonline`。
- 公网只开 80/443(Traefik);VM/VL/dashboard 一律 TLS + BasicAuth。

## 三、服务器一次性接入(手工,写进 howto/deploy.md)

1. 装 pnpm:`corepack enable && corepack prepare pnpm@12.0.0 --activate`(或 `npm i -g pnpm@12.0.0`)。
2. `git clone <repo> /opt/lucent && cd /opt/lucent`。
3. `cp .env.production.example .env.production` 后 vim 填值(见文档「改哪些值」表)。
4. `cp deploy/traefik/traefik.static.yml.example deploy/traefik/traefik.static.yml`、
   `cp deploy/traefik/traefik.dynamic.yml.example deploy/traefik/traefik.dynamic.yml`,vim 改域名/邮箱/BasicAuth 哈希。
5. `docker compose -f compose.staging.yaml --env-file .env.production up -d`,确认 postgres/redis healthy。
6. 首次发布:逐条执行 §二 里那串发布命令。
7. `pm2 startup systemd` + `pm2 save`(root,保证机器重启后自恢复)。
8. DNS 指向该机 + 放行 80/443 → 访问 `https://<api 域名>/api/v1/health/deep` 验证证书与链路。

## 四、文件清单

### 新增

| 文件                                         | 职责                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| `deploy/traefik/traefik.static.yml.example`  | 静态配置模板(entryPoints / file provider / ACME),注释标明要改哪几行      |
| `deploy/traefik/traefik.dynamic.yml.example` | 动态配置模板(4 条路由 + BasicAuth + SSE flush + 安全头),同样标明要改的值 |

> 真实文件 `deploy/traefik/traefik.static.yml` / `traefik.dynamic.yml` 在服务器上由 `.example` 复制而来,
> 并加入 `.gitignore`(`/deploy/traefik/*.yml`):发布命令会 `git reset --hard origin/main` 硬同步工作区,
> 任何 tracked 文件上的本地编辑都留不住;gitignored 的实文件既能“服务器上 vim 改域名”,又不会被
> `git pull`/`reset --hard` 冲突或覆盖。

### 修改

| 文件                                                         | 改动                                                                                                                                                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.github/workflows/lucent-staging.yml`                       | 重写:`push`(main)直接触发,SSH 内联执行 §二 命令链;删除镜像构建推送与 Coolify webhook 步骤;保留 concurrency 锁;`environment: staging` 只取 secrets                        |
| `compose.staging.yaml`(根)                                   | 原地重写为 staging infra 栈:去掉 `app` 服务、新增 `traefik`,postgres/redis/VM/VL 端口改 `127.0.0.1` 绑定,VM 加 `extra_hosts: host-gateway`,project name `lucent-staging` |
| `monitoring/victoriametrics/vmscraper.staging.yml`           | 抓取目标 `app:3000` → `host.docker.internal:3000`,注释同步                                                                                                               |
| `deploy/ecosystem.config.js` → `deploy/ecosystem.config.cjs` | 扩展名修正(`"type": "module"` 下用 `module.exports` 的 `.js` 会报 `module is not defined`);补 `kill_signal: SIGTERM`、`cwd: '/opt/lucent'`、日志路径                     |
| `.gitignore`                                                 | 新增 `/deploy/traefik/*.yml`(真实配置不入库)                                                                                                                             |
| `.env.production.example`                                    | 补 staging 段说明:哪些键给 app、哪些键给 compose 插值、哪些值必须两处一致;`LUCENT_IMAGE` 标注为 production 专用                                                          |
| `scripts/docs/links.ts`                                      | `PATH_TOKEN_RE` 与 usage 文案把 `deploy` 前缀加回(文档将引用 `deploy/traefik/**`、`deploy/ecosystem.config.cjs`)                                                         |
| `docs/reference/adr/0017-coolify-deployment.md`              | **原地修订**:标题/Status 扩为覆盖 production(Coolify 容器)+ staging(原生 PM2 + Traefik)两种模型,记 amended 日期                                                          |
| `docs/reference/adr/README.md`                               | 0017 索引描述同步                                                                                                                                                        |
| `docs/reference/deployment.md`                               | staging 段整体重写(原生 PM2 + Traefik + 推送即部署),production 段保留;拓扑、secrets、发布、排障同步                                                                      |
| `docs/howto/deploy.md`                                       | 拆成:staging 一次性接入命令清单、「改哪些值」表、日常发布(自动)与手动发布命令原文、面板访问;production 段保留                                                            |
| `docs/reference/environment-variables.md`                    | 根目录 `.env.production` 的消费方(app + compose)、`TRUST_PROXY=true`、`VICTORIALOGS_URL` 回环语义                                                                        |
| `README.md`(根)                                              | 部署叙述同步 staging 新链路                                                                                                                                              |
| `plans/README.md`                                            | 索引本计划                                                                                                                                                               |
| `docs/logs/migration-log/2026-09-10.md`                      | 追加当日条目(变更范围 + 验证结论)                                                                                                                                        |

### 删除

| 项                                                                        | 理由                                                            |
| ------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 现有未提交草稿 `deploy/traefik/traefik.static.yml`、`traefik.dynamic.yml` | 内容演化为 `.example` 模板;实文件改为服务器本地生成(gitignored) |
| `deploy/ecosystem.config.js`                                              | 由 `deploy/ecosystem.config.cjs` 取代                           |

> 不新增 `release.sh`(发布链路内联在 workflow)、不新增 `bootstrap.sh`(接入步骤写进 howto)、
> 不做回滚能力;`compose.staging.yaml` 保留在根目录原地重写,不移动。

### CI/CD 密钥与变量(environment `staging`)

| 类型     | 名称                                                              | 说明                                   |
| -------- | ----------------------------------------------------------------- | -------------------------------------- |
| secret   | `STAGING_SSH_HOST` / `STAGING_SSH_USER`(root) / `STAGING_SSH_KEY` | 目标机与私钥                           |
| secret   | `STAGING_SSH_PORT`(可选) / `STAGING_SSH_KNOWN_HOSTS`              | 非 22 端口与主机指纹校验               |
| variable | `STAGING_API_HOST`                                                | staging API 域名(发布后公共健康检查用) |
| 退役     | `COOLIFY_STAGING_WEBHOOK`                                         | Coolify 部署入口彻底移除               |

## 五、关键实现要点

### 1. workflow(`lucent-staging`)

```yaml
on:
  push:
    branches: [main]
  workflow_dispatch:
concurrency:
  group: lucent-staging-deploy
  cancel-in-progress: false
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - 写 SSH key / known_hosts(仅用 secrets,不 checkout 仓库)
      - ssh root@$HOST bash -s <<'EOF' … (§二 命令链) … EOF
      - curl -fsS https://$STAGING_API_HOST/api/v1/health/deep # 公共侧收尾校验
```

- 不再有 `workflow_run` / CI 成功条件,也不再有 registry 登录与镜像构建步骤。
- 不引入第三方 SSH action,直接 `ssh` + heredoc,少一层封装。

### 2. `compose.staging.yaml`(根,原地重写)

- `postgres`:`pgvector/pgvector:pg18`,`127.0.0.1:5432:5432`,`log_min_duration_statement=500`,healthcheck,卷 `postgres-data`。
- `redis`:`redis:8-alpine`,`127.0.0.1:6379:6379`,`--requirepass` + `--appendonly yes`。
- `victoriametrics`:`victoria-metrics:v1.128.0`,`127.0.0.1:8428:8428`,挂
  `monitoring/victoriametrics/vmscraper.staging.yml`,`extra_hosts: host-gateway`,保留 15d。
- `victorialogs`:`victoria-logs:v1.51.1`,`127.0.0.1:9428:9428`,保留 15d。
- `traefik`:`traefik:v3.6`,`80:80`、`443:443`,`extra_hosts: host-gateway`,挂
  `./deploy/traefik/traefik.static.yml → /etc/traefik/traefik.yml`(ro)、
  `./deploy/traefik/traefik.dynamic.yml → /etc/traefik/dynamic/routes.yml`(ro)、卷 `letsencrypt`。
- 全部 `restart: unless-stopped` + 日志轮转上限;插值变量经 `--env-file .env.production` 提供。
- 容器端口都绑回环 → 公网只经 Traefik 进出,不依赖云安全组收口。

### 3. Traefik 配置(改哪些值)

| 文件                  | 要改的值                     | 说明                                                               |
| --------------------- | ---------------------------- | ------------------------------------------------------------------ |
| `traefik.static.yml`  | `<你的邮箱>`                 | ACME 注册邮箱(证书到期提醒)                                        |
|                       | `providers.file.filename`    | `/etc/traefik/dynamic/routes.yml`                                  |
|                       | `api.dashboard` / `insecure` | `true` / `false`(面板经路由 + BasicAuth 访问)                      |
| `traefik.dynamic.yml` | 4 条 `rule` 的域名           | `api.<域名>` / `metrics.<域名>` / `logs.<域名>` / `traefik.<域名>` |
|                       | `lucent-api` service url     | `http://host.docker.internal:3000`                                 |
|                       | 3 处 `basicAuth.users`       | `openssl passwd -apr1`(或 `htpasswd -nbB`)生成 `用户:哈希`         |

- `lucent-api` 的 service 设 `responseForwarding.flushInterval: 100ms`,且该路由**不挂** `compress`/`buffering`
  中间件——assistant 的 SSE 流不能被子代理缓冲。安全头中间件只加在需要的路由上。
- 三条辅助面板路由挂 `basicAuth`;因容器端口只绑回环,未认证的直连也无从入口:
  - `metrics.<域名>` → `victoriametrics:8428`(VMUI,时序指标查询);
  - `logs.<域名>` → `victorialogs:9428`(LogsQL 按 `trace_id` 检索);
  - `traefik.<域名>` → `api@internal`,即 Traefik 自带 dashboard:展示**反代自身**的路由/服务/中间件/
    TLS 证书与 ACME 状态(排「域名没路由、后端 502、证书没签下来」这类问题用),不含业务指标与日志。
- 改完配置执行 `docker compose -f compose.staging.yaml --env-file .env.production restart traefik`:
  单文件 bind-mount 的 fsnotify 通知在 Docker 下不可靠,热加载不保证生效。
- ACME 前置:DNS 已指向该机、80 公网可达(或 CDN 侧放行 `/.well-known/acme-challenge/`)。

### 4. PM2(`deploy/ecosystem.config.cjs`)

- `name: lucent`、`script: dist/main.js`、`cwd: /opt/lucent`、`instances: 1`、`exec_mode: fork`。
- `env`: `NODE_ENV=production`、`HOST=0.0.0.0`、`PORT=3000`;其余运行时变量由 app 从
  `/opt/lucent/.env.production` 自行加载(`getEnvFilePaths()` 约定),不在 PM2 里重复。
- `kill_signal: SIGTERM` + `kill_timeout: 60000`(SSE 排空)、`max_memory_restart: 1G`、
  日志 `logs/pm2-out.log` / `logs/pm2-error.log`、root 用户直接启动(无需 sudo/授权)。

### 5. `.env.production`(根目录,单文件双消费者)

- app 侧(Nest + Prisma 按 `NODE_ENV=production` 自动加载):`DATABASE_URL`、`REDIS_URL`、
  `VICTORIALOGS_URL`、`TRUST_PROXY=true`(经 Traefik 后限流才能取到真实客户端 IP)、`PUBLIC_BASE_URL`、各密钥。
- compose 侧(经 `--env-file`):`POSTGRES_PASSWORD`、`REDIS_PASSWORD`、`METRICS_USER`、`METRICS_PASSWORD`。
- 注意:`DATABASE_URL`/`REDIS_URL` 内嵌的密码必须与 `POSTGRES_PASSWORD`/`REDIS_PASSWORD` 一致
  (同一文件里出现两处,「改哪些值」表里明确标注);密钥值避免 `$`/`#`/空格。

## 六、实施阶段

1. **Phase 0 仓库侧文件**:两份 traefik `.example` 模板;根 `compose.staging.yaml` 重写;
   `deploy/ecosystem.config.cjs`、`vmscraper.staging.yml`、`.gitignore`。
2. **Phase 1 文档与门禁**:修订 ADR-0017 + adr 索引、`deployment.md`、`howto/deploy.md`、
   `environment-variables.md`、`.env.production.example`、根 `README.md`、`links.ts` 加回 `deploy` 前缀、
   `plans/README.md`、迁移日志条目。
3. **Phase 2 CI 切换**:重写 `lucent-staging.yml`;GitHub environment `staging` 增补 SSH secrets/vars、
   退役 `COOLIFY_STAGING_WEBHOOK`。
4. **Phase 3 服务器接入(人工,按 §三 命令)**:装 pnpm → clone → 写 `.env.production` → 复制并 vim
   traefik 配置 → `docker compose up -d` → 首次发布 → `pm2 startup` + `pm2 save` → DNS/放行。
5. **Phase 4 验证**:见下节;完成后删除本计划文件,持久结论留在 ADR-0017 与 `docs/reference/deployment.md`。

## 七、验证清单

- 仓库侧:`pnpm docs:verify`、`pnpm docs:links`、`pnpm format:check`;
  `docker compose -f compose.staging.yaml --env-file <临时 env> config` 通过。
- staging 首次:infra 容器 healthy → 首次发布成功 → `curl 127.0.0.1:3000/api/v1/health/ready`
  与 `/health/deep` 200 → `https://<api 域名>/api/v1/health` 200(证书已签发)。
- 自动化:向 main 推送一个提交,`lucent-staging` 不等 CI 即完成部署,公共健康检查通过。
- 面板:`metrics` / `logs` / `traefik` 三个域名未认证返回 401;`8428`/`9428` 公网不可达(只绑回环)。
- 运维:重启机器后 app 自动恢复(`pm2 startup` + `pm2 save` 生效);手动敲同一串命令可重发同一版本。
- 回归:staging 上读写一条业务数据、`/metrics` 受 `METRICS_*` 保护、VictoriaLogs 能按 `trace_id` 查到新日志、
  assistant SSE 流不积压。

## 八、风险与取舍

| 风险         | 说明与处置                                                                                                       |
| ------------ | ---------------------------------------------------------------------------------------------------------------- |
| 无 CI 门禁   | 按你的选择 push 即部署:未通过 CI 的提交会直接上线 staging,靠下一条提交修复                                       |
| 无回滚       | fix-forward;必要时手动 `git checkout <旧 SHA>` 重跑同一串命令,schema 不回退(继续 expand-contract)                |
| 停机时间     | 停机窗口含 `pnpm install` + `build`(1–3 分钟),期间 SSE 客户端会先收到终止事件                                    |
| 工作区硬同步 | 发布用 `git fetch + reset --hard origin/main`:服务器上任何 tracked 改动都会被覆盖(环境相关文件已全部 gitignored) |
| 证书首次签发 | 依赖 DNS 解析与 80 可达;失败看 traefik 容器日志的 ACME 报错                                                      |
| 配置热加载   | 单文件挂载的 fsnotify 不可靠,改 traefik 配置须 `restart traefik` 才生效(文档已写明)                              |
| 密钥重复     | `.env.production` 里 postgres/redis 密码各出现两处(`*_URL` 与 `*_PASSWORD`),改密码必须同步                       |
| 模型分叉     | staging(原生 PM2)与 production(Coolify 容器)不同构;production 后续要迁可复用本套配置                             |
| 无备份       | 沿用现状(未启用自动备份);staging 无历史数据,风险低                                                               |
