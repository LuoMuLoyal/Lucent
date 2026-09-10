---
status: active
owner: backend
quadrant: howto
updated: 2026-09-09
---

# How-To: Coolify 部署快速路径

部署模型与组件说明见 [reference/deployment.md](../reference/deployment.md)。
本文只给操作步骤。前置:Coolify 已添加目标服务器(自动装好 Traefik)。

## 〇、环境与编排对应关系

| 环境       | 粘贴哪个 compose          | 说明                               |
| ---------- | ------------------------- | ---------------------------------- |
| staging    | `compose.staging.yaml`    | 精简栈:无 grafana / node-exporter  |
| production | `compose.yaml`            | 完整栈(含 grafana / node-exporter) |

## 一、首次接入(Coolify 面板)

1. **Projects → 新建项目**,按环境分目录(如 `staging` / `production`)。
2. 新建 **Service → Docker Compose Empty**,按上表把对应 compose
   的内容粘贴为 Source Compose;组件会被解析出来(staging:`lucent-app`、
   postgres、redis、victoriametrics、victorialogs;production 另有 grafana、
   node-exporter)。
3. **环境变量**:
   - Service 级填写 compose 插值所需:`POSTGRES_PASSWORD`、`REDIS_PASSWORD`、
     `LUCENT_IMAGE`(app 完整镜像引用,如 `<你的 Docker Hub 用户名>/lucent:1a2b3c4d`
     ——把 `<你的 Docker Hub 用户名>` 换成自己的)、`METRICS_USER`、
     `METRICS_PASSWORD`;生产另有 `GRAFANA_ADMIN_PASSWORD`。
   - app 组件的完整运行时变量(见
     [environment-variables.md](../reference/environment-variables.md),模板
     `.env.production.example`)也填入(→ 生成服务目录 `.env`,即 compose
     `env_file` 的来源)。
4. **域名与 TLS**(app 组件):设置域名(如 `staging-api.你的域名.com`),Coolify/Traefik
   自动申请证书并强制 HTTPS。健康检查:`GET /api/v1/health/ready`,端口 `3000`。
5. **持久化存储**:compose 用命名卷(`postgres-data` 等),Coolify 面板确认
   卷已挂载;生产 grafana 的 provisioning/dashboards 从 compose 相对路径挂载。
6. 点击 **Deploy**,确认 postgres/redis 先健康、app 再启动。

### 配置 staging 自动部署(Coolify webhook)

staging 在 Coolify 侧须同时注册为 **Application** 资源(用于 webhook
触发自动部署),Application 的部署来源指向你构建好的 Docker Hub 镜像:

1. 在 staging 项目下新建 **Resource → Public Repository** 或 **Dockerfile**
   类型的 Application,设置:
   - **Docker Registry Image**: 填 `REGISTRY_IMAGE` 的值(如 `docker.io/<你的用户名>/lucent`),
     拉取 `latest` tag 进行部署。
   - **Base Directory**: `/`(或 Dockerfile 所在子目录)。
   - **Port**: `3000`。
   - **域名**: 与 Docker Compose Service 的 staging app 域名一致(或用同一个
     域名;两者指向同一个 container,选一个入口即可)。
2. 进入该 Application → **Settings → Webhooks**,复制 **Deploy Webhook URL**:
   ```
   https://<coolify-domain>/api/v1/deploy?uuid=<app-uuid>&force=false
   ```
3. 在 GitHub 仓库 **Settings → Secrets and variables → Actions** 添加:
   - `COOLIFY_STAGING_WEBHOOK`: 粘贴上一步的完整 URL(含 `uuid` 与 `force` 参数)。

完成后,`lucent-staging` workflow 在 CI 通过并推送镜像后,会自动 `curl -fsS -X POST`
触发该 webhook,无需手动到面板操作。

## 二、日常发布

### staging(自动)

1. 合并 main → `lucent-ci` 校验 → `lucent-staging` 自动构建并推送镜像(
   `<sha8>` + `latest`),然后自动调用 Coolify webhook 触发 staging 部署。
2. 容器启动时 `entrypoint.sh` 会自动执行 `prisma migrate deploy`;迁移失败
   则容器启动中止(不会带坏 schema 上线)。无需手动执行迁移命令。
3. 验证:`curl https://<staging-domain>/api/v1/health/deep`。

### production(手动)

1. 手动触发 `lucent-production`(`workflow_dispatch`,main 分支)
   构建并推送镜像(仅 `<sha8>`。
2. 在 Coolify 面板把服务的 `LUCENT_IMAGE` 更新为含新短 sha 的完整引用。
3. **Pull Latest Images & Restart**(拉新镜像并重建)。
4. 容器启动时 `entrypoint.sh` 会自动执行 `prisma migrate deploy`,无需
   手动执行迁移命令。
5. 验证:`curl https://<domain>/api/v1/health/deep`。

> 说明:发布 = 更新 `LUCENT_IMAGE` → pull & restart;
> 迁移自动执行,失败则容器不启动;破坏性迁移走 expand-contract。

## 三、回滚

把 `LUCENT_IMAGE` 改回上一可用完整引用(旧短 sha),再次
**Pull Latest Images & Restart**。`latest` 不做回滚锚点。

## 四、访问指标栈(端口已发布,安全组收口)

- Grafana(仅生产):`http://<host>:3001`(admin 密码 = `GRAFANA_ADMIN_PASSWORD`)
- VictoriaMetrics VMUI:`http://<host>:8428`(staging 看指标用这个)
- VictoriaLogs UI:`http://<host>:9428`,LogsQL 按 `trace_id:xxx` 检索

公网可达性由云厂商安全组控制;`/metrics` 与这些端口不要配到 Coolify 域名下。

## 五、注意

- **备份未启用**:当前无自动备份,勿在未验证恢复路径的情况下做破坏性操作。
- **告警未配置**:存活依赖 Coolify 健康检查与重启;指标可在 Grafana 人工查看。
- 现场构建(Dockerfile 在服务器构建)是反模式,已弃用;一律 CI 构建推镜像。
