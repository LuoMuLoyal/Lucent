# Lucent Deployment Checklist

Last updated: 2026-06-14

这份文档只保留执行清单。变量解释看 `environment.md`，文件归属看 `deployment-files.md`，腾讯云/TCR 账号与仓库配置看 `tencent-cloud-cicd.md`。

## 首次服务器准备

1. 创建目录：

```bash
sudo mkdir -p /opt/lucent/app
sudo mkdir -p /opt/lucent/runtime/certs
sudo mkdir -p /opt/lucent/runtime/nginx
sudo chown -R "$USER":"$USER" /opt/lucent
```

2. 把 Lucent 仓库 checkout 到 `/opt/lucent/app`。
3. 确认仓库里的监控资产已经存在：

```bash
ls /opt/lucent/app/monitoring/prometheus/prometheus.yml
ls /opt/lucent/app/monitoring/grafana/provisioning
ls /opt/lucent/app/monitoring/grafana/dashboards
ls /opt/lucent/app/monitoring/synthetic-checker/synthetic-checker.mjs
```

4. 确认部署用户在服务器上能执行：

```bash
cd /opt/lucent/app
git pull --ff-only
```

5. 放置运行时文件：
   - `/opt/lucent/runtime/.env.production`
   - `/opt/lucent/runtime/nginx/nginx.conf`
   - `/opt/lucent/runtime/certs/fullchain.pem`
   - `/opt/lucent/runtime/certs/privkey.pem`
6. 从仓库里的 [deploy/nginx/nginx.conf](D:/25080/Documents/VSCodeProject/Lumos/Lucent/deploy/nginx/nginx.conf) 复制一份作为 Nginx 初始配置，再按域名继续改。
7. 至少确认 `.env.production` 里这些值已替换：
   - `CORS_ORIGIN`
   - `JWT_ACCESS_SECRET`
   - `JWT_REFRESH_SECRET`
   - `ADMIN_EMAIL`
   - `ADMIN_PASSWORD`
   - `ADMIN_COOKIE_SECRET`
   - `GF_SECURITY_ADMIN_PASSWORD`
8. 如果启用对应能力，再补这些配置：
   - AI：各角色 `AI_*`
   - 邮件：`MAIL_*`
   - COS：`TENCENT_COS_*`
   - synthetic check：`SYNTHETIC_LOGIN_EMAIL`、`SYNTHETIC_LOGIN_PASSWORD`

## 镜像仓库准备

1. 在 GitHub 仓库配置：
   - Secrets：`REGISTRY_USERNAME`、`REGISTRY_PASSWORD`、`SERVER_HOST`、`SERVER_PORT`、`SERVER_USER`、`SERVER_SSH_KEY`、`SERVER_KNOWN_HOSTS`
   - Variables：`SERVER_APP_DIR=/opt/lucent/app`、`LUCENT_RUNTIME_DIR=/opt/lucent/runtime`、`REGISTRY_HOST`、`REGISTRY_NAMESPACE`、`REGISTRY_IMAGE_NAME`
2. 在服务器手工验证仓库登录：

```bash
docker login ccr.ccs.tencentyun.com --username '<tencent-account-id>'
```

3. 首次部署前，先手工同步基础镜像到你的 registry：

```bash
docker pull postgres:18-alpine
docker tag postgres:18-alpine ccr.ccs.tencentyun.com/<namespace>/lucent-postgres:18-alpine
docker push ccr.ccs.tencentyun.com/<namespace>/lucent-postgres:18-alpine

docker pull redis:8-alpine
docker tag redis:8-alpine ccr.ccs.tencentyun.com/<namespace>/lucent-redis:8-alpine
docker push ccr.ccs.tencentyun.com/<namespace>/lucent-redis:8-alpine
```

4. 在服务器验证基础镜像可拉取：

```bash
docker pull ccr.ccs.tencentyun.com/<namespace>/lucent-postgres:18-alpine
docker pull ccr.ccs.tencentyun.com/<namespace>/lucent-redis:8-alpine
```

## 首次部署执行

1. push 到 `main`，或者手工触发 GitHub Actions 里的 `lucent-ci-cd`。
2. 等 deploy job 完成后，在服务器检查：

```bash
cd /opt/lucent/app
docker compose --env-file /opt/lucent/runtime/.deploy-image.env ps
docker compose --env-file /opt/lucent/runtime/.deploy-image.env logs --tail=100 app
```

3. 核对容器内与宿主机探针：

```bash
curl http://127.0.0.1:3000/api/v1/health/live
curl http://127.0.0.1:3000/api/v1/health/ready
curl http://127.0.0.1:3000/metrics
curl http://127.0.0.1:9090/api/v1/targets
curl http://127.0.0.1:3001/api/health
curl -k https://your-domain.example/nginx-health
curl -k https://your-domain.example/api/v1/health/ready
```

4. 最低通过标准：
   - `app`、`postgres`、`redis`、`prometheus`、`grafana`、`nginx` 容器都在运行
   - `/api/v1/health/ready` 返回 200
   - `/metrics` 可抓
   - Prometheus targets 里有 `lucent-app` 和 `lucent-synthetic`
   - Grafana 默认面板已出现
   - 如果配置了 synthetic 账号，相关检查为成功状态

## 每次发版核对

1. 确认服务器当前分支和远端一致：

```bash
cd /opt/lucent/app
git status --short
git rev-parse HEAD
git pull --ff-only
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

1. 应用没起来：`docker compose --env-file /opt/lucent/runtime/.deploy-image.env logs --tail=200 app`
2. 反代异常：`docker compose --env-file /opt/lucent/runtime/.deploy-image.env logs --tail=200 nginx`
3. 监控没起来：分别看 `prometheus`、`grafana`、`synthetic-monitor` 日志
4. 镜像拉取失败：先在服务器重跑 `docker login` 和 `docker pull`
