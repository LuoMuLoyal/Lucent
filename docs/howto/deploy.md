---
status: active
owner: backend
quadrant: howto
updated: 2026-09-10
---

# How-To: 部署 Lucent

部署模型与组件说明见 [reference/deployment.md](../reference/deployment.md),本文只给操作步骤。

| 环境       | 形态                                           | 编排                                        |
| ---------- | ---------------------------------------------- | ------------------------------------------- |
| staging    | 宿主原生 Node + PM2 + 自建 Traefik(推送即部署) | 根 `compose.staging.yaml`(只含基础设施容器) |
| production | Coolify Docker Compose Service + 镜像          | 根 `compose.yaml`                           |

## 一、Staging 首次接入(服务器上人工执行)

前置:DNS 已把 `api` / `metrics` / `logs` / `traefik` 四个域名指向本机,80/443 放行。

1. **安装 pnpm**(Node 24 已就位):

   ```bash
   corepack enable && corepack prepare pnpm@12.0.0 --activate
   # 若 corepack 不可用:npm i -g pnpm@12.0.0
   ```

2. **安装 PM2 并开启开机自启**(root):

   ```bash
   npm i -g pm2
   pm2 startup systemd -u root --hp /root
   ```

3. **克隆仓库到代码目录**:

   ```bash
   git clone <repo-url> /opt/lucent && cd /opt/lucent
   ```

4. **写应用运行时环境变量**(从模板复制后填值,清单见 §三):

   ```bash
   cp .env.production.example .env.production
   vim .env.production
   ```

5. **生成 Traefik 运行配置**(仓库只跟踪 `.example` 模板,真实文件不入库):

   ```bash
   cp deploy/traefik/traefik.static.yml.example deploy/traefik/traefik.static.yml
   cp deploy/traefik/traefik.dynamic.yml.example deploy/traefik/traefik.dynamic.yml
   # 面板密码哈希:
   openssl passwd -apr1
   vim deploy/traefik/traefik.static.yml    # ACME 邮箱
   vim deploy/traefik/traefik.dynamic.yml   # 4 个域名 + basicAuth.users 哈希
   ```

6. **启动基础设施容器**:

   ```bash
   docker compose -f compose.staging.yaml --env-file .env.production up -d
   docker compose -f compose.staging.yaml --env-file .env.production ps   # 等 postgres/redis healthy
   ```

7. **首次发布**——执行 §二 的手动发布命令串(此时 PM2 里还没有 `lucent` 进程,
   `pm2 stop lucent || true` 会静默跳过,`pm2 startOrReload` 首次启动)。

8. **验证**:`curl https://api.<域名>/api/v1/health/deep`(200 且证书有效);
   最后 `pm2 save` 固化进程列表,重启用 `pm2 resurrect` 自恢复。

## 二、Staging 日常发布

### 自动(push main)

推送到 `main` 即触发 `.github/workflows/lucent-staging.yml`,**不等 CI 结果、无人工批准**。
工作流 SSH 到服务器串行执行下面这串命令,再做一次公共健康检查。

### 手动(与工作流同一串命令)

```bash
ssh root@<staging-host>
cd /opt/lucent

test -f .env.production                     # 缺这个文件就别往下走
pm2 stop lucent || true                     # 首次发布时进程还不存在
git fetch --prune origin
git reset --hard origin/main                # 硬同步:服务器不保留任何 tracked 改动
pnpm install --frozen-lockfile
pnpm prisma:generate && pnpm build
NODE_ENV=production pnpm exec prisma migrate deploy
pm2 startOrReload deploy/ecosystem.config.cjs --update-env
pm2 save

# 健康门禁(30 × 2s)
for i in $(seq 1 30); do curl -fsS http://127.0.0.1:3000/api/v1/health/ready && break; sleep 2; done
```

- 停机窗口 = 上述全程(含 `pnpm install` + `pnpm build`,通常 1–3 分钟)。
- 失败就停在当前状态:`pm2 logs lucent --lines 100` 看现场;修完再推一次或手动重跑。
- **回滚不做**(fix-forward):需要回旧版本时 `git checkout <旧 sha>` 后重跑上面同一串命令;
  数据库迁移不回退,破坏性变更继续 expand-contract。

### 基础设施变更

改 `compose.staging.yaml` 或 `monitoring/victoriametrics/vmscraper.staging.yml` 后:

```bash
cd /opt/lucent
git fetch --prune origin && git reset --hard origin/main
docker compose -f compose.staging.yaml --env-file .env.production up -d
```

## 三、Staging「改哪些值」清单

| 文件                                   | 键 / 值                                | 说明                                                                                                                  |
| -------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `.env.production`(根,gitignored)       | `DATABASE_URL`                         | `postgresql://lucent:<POSTGRES_PASSWORD>@127.0.0.1:5432/lucent?schema=public`                                         |
|                                        | `REDIS_URL`                            | `redis://:<REDIS_PASSWORD>@127.0.0.1:6379`                                                                            |
|                                        | `VICTORIALOGS_URL`                     | `http://127.0.0.1:9428/insert/jsonline`                                                                               |
|                                        | `TRUST_PROXY`                          | `true`(经 Traefik 后限流取真实 IP)                                                                                    |
|                                        | `PUBLIC_BASE_URL`                      | `https://api.<域名>`                                                                                                  |
|                                        | `POSTGRES_PASSWORD` / `REDIS_PASSWORD` | compose 插值用;**必须与上面两个 URL 内嵌的密码一致**                                                                  |
|                                        | `METRICS_USER` / `METRICS_PASSWORD`    | 应用的 `/metrics` Basic Auth + VictoriaMetrics 抓取凭据                                                               |
|                                        | 其余密钥                               | JWT / Better Auth / ADMIN / 邮件 / AI / 对象存储,见 [environment-variables.md](../reference/environment-variables.md) |
| `deploy/traefik/*.yml`(服务器本地)     | `acme.email`                           | ACME 注册邮箱,必填                                                                                                    |
|                                        | 4 条 `rule` 的域名                     | `api.` / `metrics.` / `logs.` / `traefik.`                                                                            |
|                                        | `basicAuth.users`                      | 三个面板共用;`openssl passwd -apr1` 或 `htpasswd -nbB` 生成 `用户:哈希`                                               |
| `deploy/ecosystem.config.cjs`          | `cwd`                                  | 默认 `/opt/lucent`,换目录时改这里与工作流里的 `APP_DIR`                                                               |
| `.github/workflows/lucent-staging.yml` | `APP_DIR`                              | 服务器代码目录,须与 `ecosystem.config.cjs` 的 `cwd` 一致                                                              |

改完 traefik 配置要重启才生效(单文件 bind-mount 的 fsnotify 不可靠):

```bash
docker compose -f compose.staging.yaml --env-file .env.production restart traefik
```

## 四、Staging 面板与指标

| 面板                 | 域名             | 看什么                                                                             |
| -------------------- | ---------------- | ---------------------------------------------------------------------------------- |
| Traefik dashboard    | `traefik.<域名>` | 反代自身的路由 / 服务 / 中间件 / 证书与 ACME 状态(排「域名没路由、502、证书没签」) |
| VictoriaMetrics VMUI | `metrics.<域名>` | 时序指标查询(QPS、延迟、错误率、内存、队列深度)                                    |
| VictoriaLogs UI      | `logs.<域名>`    | LogsQL 检索;按 `trace_id:xxx` 串一次请求                                           |

三个面板都要 BasicAuth(`panel-auth`,`401` 未认证)。容器端口只绑 `127.0.0.1`,
如需在本机直连可开隧道:`ssh -L 8428:127.0.0.1:8428 root@<staging-host>`。

## 五、Production(Coolify)

前置:Coolify 已添加目标服务器(自动装好 Traefik)。

### 首次接入

1. **Projects → 新建项目**,新建 **Service → Docker Compose Empty**,把根
   `compose.yaml` 的内容粘贴为 Source Compose。
2. **环境变量**:Service 级填 `POSTGRES_PASSWORD`、`REDIS_PASSWORD`、
   `LUCENT_IMAGE`(app 完整镜像引用,如 `<你的 Docker Hub 用户名>/lucent:1a2b3c4d`)、
   `METRICS_USER`、`METRICS_PASSWORD`、`GRAFANA_ADMIN_PASSWORD`;app 组件的完整运行时
   变量(见 [environment-variables.md](../reference/environment-variables.md))填为服务
   目录的 `.env`(compose `env_file` 的来源)。
3. **域名与 TLS**(app 组件):设置域名,Coolify/Traefik 自动申请证书并强制 HTTPS;
   健康检查 `GET /api/v1/health/ready`,端口 `3000`。
4. 点击 **Deploy**,确认 postgres/redis 先健康、app 再启动。

### 日常发布

1. 手动触发 `lucent-production`(`workflow_dispatch`,main)构建并推送镜像(仅短 sha)。
2. Coolify 面板把服务的 `LUCENT_IMAGE` 更新为含新短 sha 的完整引用。
3. **Pull Latest Images & Restart**;容器启动时 `entrypoint.sh` 自动执行
   `prisma migrate deploy`,失败则容器不启动。
4. 验证:`curl https://<domain>/api/v1/health/deep`。

### 回滚

把 `LUCENT_IMAGE` 改回上一可用完整引用(旧短 sha),再次 **Pull Latest Images & Restart**。

### 指标栈

Grafana `http://<host>:3001`、VMUI `http://<host>:8428`、VictoriaLogs `http://<host>:9428`;
公网可达性由云厂商安全组控制,不要配到 Coolify 域名下。

## 六、注意

- **备份未启用**:当前无自动备份,勿在未验证恢复路径的情况下做破坏性操作。
- **告警未配置**:存活依赖 Coolify 健康检查(staging 依赖 PM2 自动重启与发布健康门禁)。
- **未经 CI 校验即上线 staging**:推送即部署的必然结果,失败靠下一条提交修复。
- production 现场构建(Dockerfile 在服务器构建)是反模式,已弃用;一律 CI 构建推镜像。
