# Lucent Deployment

Last updated: 2026-06-16

这份文档只保留当前简化后的生产部署模型。

## 目录

服务器只保留两块：

```text
/opt/lucent/app
/opt/lucent/server
```

- `/opt/lucent/app`
  - 由 GitHub Actions 覆盖上传
  - 包含 `deploy/docker-compose.yml`
  - 包含 `deploy/deploy-server.ts`
  - 包含 `deploy/validate-assets.ts`
  - 包含 `deploy/nginx/nginx.conf`
- `/opt/lucent/server`
  - 只放服务器本地文件
  - `.env.production`
  - `certs/*`
  - `data/postgres`
  - `data/redis`
  - `logs/app`
  - `logs/nginx`

没有 `releases/<sha>`。
没有 `current` 软链接。
没有 Prometheus / Grafana / synthetic monitor。

## 首次准备

```bash
mkdir -p /opt/lucent/app
mkdir -p /opt/lucent/server/certs
mkdir -p /opt/lucent/server/data/postgres
mkdir -p /opt/lucent/server/data/redis
```

然后把这些本地文件放好：

```text
/opt/lucent/server/.env.production
/opt/lucent/server/certs/fullchain.pem
/opt/lucent/server/certs/privkey.pem
```

## 部署方式

GitHub Actions 做四件事：

1. 构建并推送 Lucent 镜像到 TCR
2. 覆盖上传 `/opt/lucent/app`
3. 在服务器执行 `node deploy/deploy-server.ts`
4. 用 `docker compose` 拉镜像并启动

服务器不保留源码 checkout。
服务器也不做 release 回溯。

## 手工排障

以后所有和生产 compose 相关的命令，都只在这里执行：

```bash
cd /opt/lucent/app
docker compose -f deploy/docker-compose.yml --env-file .env.compose ps
docker compose -f deploy/docker-compose.yml --env-file .env.compose logs --tail=200 app
docker compose -f deploy/docker-compose.yml --env-file .env.compose logs --tail=200 nginx
docker compose -f deploy/docker-compose.yml --env-file .env.compose down
docker compose -f deploy/docker-compose.yml --env-file .env.compose up -d
```

不会再出现从软链接目录运行 `docker compose` 的 warning。

## 最低上线检查

```bash
curl http://127.0.0.1:3000/api/v1/health
curl http://127.0.0.1:3000/api/v1/health/live
curl http://127.0.0.1:3000/api/v1/health/ready
curl -k https://your-domain.example/api/v1/health/ready
```

通过标准：

- `app`、`postgres`、`redis`、`nginx` 四个容器在运行
- `/api/v1/health/ready` 返回 `200`
- Nginx 能正常反代 HTTPS 请求

## GitHub Secrets

`production` environment 至少保留：

```text
TCR_USERNAME
TCR_PASSWORD
DEPLOY_HOST
DEPLOY_PORT
DEPLOY_USER
DEPLOY_SSH_KEY
DEPLOY_SSH_KNOWN_HOSTS
```
