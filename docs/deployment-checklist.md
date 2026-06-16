# Lucent Deployment Checklist

Last updated: 2026-06-15

这份文档只保留执行清单。变量解释看 `environment.md`，文件归属看 `deployment-files.md`，腾讯云/TCR/GitHub Actions 配置看 `tencent-cloud-cicd.md`。

## 首次服务器准备

1. 创建目录：

```bash
sudo mkdir -p /opt/lucent/releases
sudo mkdir -p /opt/lucent/runtime/certs
sudo mkdir -p /opt/lucent/runtime/nginx
sudo chown -R "$USER":"$USER" /opt/lucent
```

2. 放置运行时文件：
   - `/opt/lucent/runtime/.env.production`
   - `/opt/lucent/runtime/nginx/nginx.conf`
   - `/opt/lucent/runtime/certs/fullchain.pem`
   - `/opt/lucent/runtime/certs/privkey.pem`
3. 从仓库里的 `deploy/nginx/nginx.conf` 复制一份作为 Nginx 初始配置，再按域名继续改。
4. 至少确认 `.env.production` 里这些值已替换：
   - `CORS_ORIGIN`
   - `JWT_ACCESS_SECRET`
   - `JWT_REFRESH_SECRET`
   - `ADMIN_EMAIL`
   - `ADMIN_PASSWORD`
   - `ADMIN_COOKIE_SECRET`
   - `GF_SECURITY_ADMIN_PASSWORD`
5. 如果启用对应能力，再补这些配置：
   - AI：各角色 `AI_*`
   - 邮件：`MAIL_*`
   - COS：`TENCENT_COS_*`
   - synthetic check：`SYNTHETIC_LOGIN_EMAIL`、`SYNTHETIC_LOGIN_PASSWORD`

## 仓库与流水线准备

1. 保持服务器可以访问外网，至少能访问：
   - 腾讯云镜像仓库 TCR
   - GitHub Actions SSH 来源地址
2. GitHub 侧保留校验型 workflow：
   - `.github/workflows/lucent-ci.yml`
3. GitHub 侧启用部署 workflow：
   - `.github/workflows/lucent-cd.yml`
4. GitHub 仓库 `production` environment 至少配置这些 secrets：
   - `TCR_USERNAME`
   - `TCR_PASSWORD`
   - `DEPLOY_HOST`
   - `DEPLOY_PORT`
   - `DEPLOY_USER`
   - `DEPLOY_SSH_KEY`
   - `DEPLOY_SSH_KNOWN_HOSTS`

## 首次部署执行

1. 先手工模拟和 workflow 一致的环境变量，在服务器执行：

```bash
mkdir -p /opt/lucent/releases/manual-test
# 先把当前仓库中的 docker-compose.yml / monitoring / scripts/deploy / deploy/nginx 上传到这个目录
export LUCENT_RELEASES_DIR=/opt/lucent/releases
export LUCENT_RELEASE_ID=manual-test
sh /opt/lucent/releases/manual-test/scripts/deploy/sync-deploy-assets.sh
export LUCENT_DEPLOY_DIR=/opt/lucent/releases/current
export LUCENT_RUNTIME_DIR=/opt/lucent/runtime
export LUCENT_IMAGE=<tcr-app-image>
export POSTGRES_IMAGE=postgres:18-alpine
export REDIS_IMAGE=redis:8-alpine
export PROMETHEUS_IMAGE=prom/prometheus:v3.12.0
export GRAFANA_IMAGE=grafana/grafana-oss:13.0.2
export NGINX_IMAGE=nginx:1.29.1-alpine
sh /opt/lucent/releases/current/scripts/deploy/deploy-server.sh
```

2. 手工跑通后，再触发 GitHub Actions 的 `lucent-cd`。
3. 等部署完成后，在服务器检查：

```bash
export LUCENT_RUNTIME_DIR=/opt/lucent/runtime
export LUCENT_DEPLOY_DIR=/opt/lucent/releases/current
docker compose --project-name lucent --project-directory /opt/lucent/releases/current -f /opt/lucent/releases/current/docker-compose.yml --env-file /opt/lucent/runtime/.deploy-image.env ps
docker compose --project-name lucent --project-directory /opt/lucent/releases/current -f /opt/lucent/releases/current/docker-compose.yml --env-file /opt/lucent/runtime/.deploy-image.env logs --tail=100 app
```

4. 核对容器内与宿主机探针：

```bash
curl http://127.0.0.1:3000/api/v1/health/live
curl http://127.0.0.1:3000/api/v1/health/ready
curl http://127.0.0.1:3000/metrics
curl http://127.0.0.1:9090/api/v1/targets
curl http://127.0.0.1:3001/api/health
curl -k https://your-domain.example/nginx-health
curl -k https://your-domain.example/api/v1/health/ready
```

5. 最低通过标准：
   - `app`、`postgres`、`redis`、`prometheus`、`grafana`、`nginx` 容器都在运行
   - `/api/v1/health/ready` 返回 200
   - `/metrics` 可抓
   - Prometheus targets 里有 `lucent-app` 和 `lucent-synthetic`
   - Grafana 默认面板已出现
   - 如果配置了 synthetic 账号，相关检查为成功状态

## 每次发版核对

1. 确认当前 release 目录和 runtime 文件仍在：

```bash
ls /opt/lucent/releases
readlink /opt/lucent/releases/current
```

2. 确认 `.env.production`、证书、Nginx 配置仍在：

```bash
ls /opt/lucent/runtime
ls /opt/lucent/runtime/certs
ls /opt/lucent/runtime/nginx
```

3. 发版后至少跑一次：

```bash
curl -k https://your-domain.example/api/v1/health/ready
curl http://127.0.0.1:9090/api/v1/targets
```

## 网络与暴露面检查

1. CVM 安全组至少放行：
   - `22`
   - `80`
   - `443`
2. 不要对公网放行：
   - `3000`
   - `9090`
   - `3001`

## 失败时先查

1. 应用没起来：`docker compose --project-name lucent --project-directory /opt/lucent/releases/current -f /opt/lucent/releases/current/docker-compose.yml --env-file /opt/lucent/runtime/.deploy-image.env logs --tail=200 app`
2. 反代异常：`docker compose --project-name lucent --project-directory /opt/lucent/releases/current -f /opt/lucent/releases/current/docker-compose.yml --env-file /opt/lucent/runtime/.deploy-image.env logs --tail=200 nginx`
3. 监控没起来：分别看 `prometheus`、`grafana`、`synthetic-monitor` 日志
4. 镜像拉取失败：先查服务器出网、DNS、代理和 TCR 连通性
