---
status: active
owner: backend
quadrant: howto
updated: 2026-09-08
---

# How-To: Coolify 部署快速路径

部署模型与组件说明见 [reference/deployment.md](../reference/deployment.md)。
本文只给操作步骤。前置:Coolify 已添加目标服务器(自动装好 Traefik)。

## 一、首次接入(Coolify 面板)

1. **Projects → 新建项目**,按环境分目录(如 `staging` / `production`)。
2. 新建 **Service → Docker Compose Empty**,把仓库 `deploy/compose.yml`
   的内容粘贴为 Source Compose;组件会被解析出来(`lucent-app`、postgres、
   redis、victoriametrics、grafana、victorialogs、node-exporter)。
3. **环境变量**:
   - Service 级填写 compose 插值所需:`POSTGRES_PASSWORD`、`REDIS_PASSWORD`、
     `LUCENT_IMAGE`(app 完整镜像引用,如 `<你的 Docker Hub 用户名>/lucent:1a2b3c4d`
     ——把 `<你的 Docker Hub 用户名>` 换成自己的)、`METRICS_USER`、
     `METRICS_PASSWORD`、`GRAFANA_ADMIN_PASSWORD`。
   - app 组件的完整运行时变量(见
     [environment-variables.md](../reference/environment-variables.md),模板
     `.env.production.example`)也填入(→ 生成服务目录 `.env`,即 compose
     `env_file` 的来源)。
4. **域名与 TLS**(app 组件):设置域名 `api.你的域名.com`,Coolify/Traefik
   自动申请证书并强制 HTTPS。健康检查:`GET /api/v1/health/ready`,端口 `3000`。
5. **持久化存储**:compose 用命名卷(`postgres-data` 等),Coolify 面板确认
   卷已挂载;grafana 的 provisioning/dashboards 从 compose 相对路径挂载。
6. 点击 **Deploy**,确认 postgres/redis 先健康、app 再启动。

## 二、日常发布(staging / production 相同)

镜像由 GitHub Actions 推送到发布者自有镜像仓库(仓库名经 GitHub secret
`REGISTRY_IMAGE` 注入,值如 `docker.io/<你的用户名>/lucent`),不需要任何
SSH 部署脚本:

1. 合并 main;`lucent-staging` 自动构建推送;生产手动触发
   `lucent-production`(`workflow_dispatch`)。
2. 在 Coolify 面板把服务的 `LUCENT_IMAGE` 更新为含新短 sha 的完整引用。
3. **Pull Latest Images & Restart**(拉新镜像并重建)。
4. 有 schema 变更时,先执行一次迁移:
   ```bash
   # Coolify 终端(或服务器 docker exec)在 lucent-app 容器内执行
   node_modules/.bin/prisma migrate deploy
   ```
5. 验证:`curl https://<domain>/api/v1/health/deep`。

> 说明:发布 = 更新 `LUCENT_IMAGE` → pull & restart;schema 不回退,
> 破坏性迁移走 expand-contract。

## 三、回滚

把 `LUCENT_IMAGE` 改回上一可用完整引用(旧短 sha),再次
**Pull Latest Images & Restart**。`latest` 不做回滚锚点。

## 四、访问指标栈(端口已发布,安全组收口)

- Grafana:`http://<host>:3001`(admin 密码 = `GRAFANA_ADMIN_PASSWORD`)
- VictoriaMetrics VMUI:`http://<host>:8428`
- VictoriaLogs UI:`http://<host>:9428`,LogsQL 按 `trace_id:xxx` 检索

公网可达性由云厂商安全组控制;`/metrics` 与这些端口不要配到 Coolify 域名下。

## 五、注意

- **备份未启用**:当前无自动备份,勿在未验证恢复路径的情况下做破坏性操作。
- **告警未配置**:存活依赖 Coolify 健康检查与重启;指标可在 Grafana 人工查看。
- 现场构建(Dockerfile 在服务器构建)是反模式,已弃用;一律 CI 构建推镜像。
