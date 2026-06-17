# Lucent Deployment

Last updated: 2026-06-17

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
  - 包含 `deploy/post-deploy-smoke.ts`
  - 包含 `deploy/validate-assets.ts`
  - 包含 `deploy/nginx/nginx.conf`
- `/opt/lucent/server`
  - 只放服务器本地文件
  - `.env.production`
  - `certs/*`
  - `data/postgresql`
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
mkdir -p /opt/lucent/server/data/postgresql
mkdir -p /opt/lucent/server/data/redis
```

PostgreSQL 18 注意事项：

- 生产 compose 现在把宿主机目录挂到容器内 `/var/lib/postgresql`
- 不再使用旧的 `/var/lib/postgresql/data` 挂载方式
- `postgres:18` 会在挂载目录里自行创建版本化子目录

首次部署时，确保服务器上存在空目录 `/opt/lucent/server/data/postgresql` 即可。

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

## 部署后 Smoke Checklist

进入服务器应用目录后，优先跑统一脚本，而不是手工记命令：

```bash
cd /opt/lucent/app
LUCENT_APP_DIR=/opt/lucent/app \
LUCENT_SERVER_DIR=/opt/lucent/server \
LUCENT_PUBLIC_BASE_URL=https://your-host-or-domain \
pnpm deploy:smoke
```

这个脚本会检查：

- `app / postgres / redis / nginx` 四个 compose service 都在 `running`
- `http://127.0.0.1:3000/api/v1/health`
- `http://127.0.0.1:3000/api/v1/health/live`
- `http://127.0.0.1:3000/api/v1/health/ready`
- 如果设置了 `LUCENT_PUBLIC_BASE_URL`，再检查一次公网 `https://.../api/v1/health/ready`

如果你当前只有 IP 自签名证书，也可以这样跑：

```bash
cd /opt/lucent/app
LUCENT_APP_DIR=/opt/lucent/app \
LUCENT_SERVER_DIR=/opt/lucent/server \
LUCENT_PUBLIC_BASE_URL=https://106.52.105.88 \
pnpm deploy:smoke
```

脚本内部已经对公网检查使用 `curl -k`，不会因为自签名证书直接失败。

## 演示前最低人工核查

Smoke 通过后，再做一次人工核查：

1. 打开移动端，确认 demo 账号能登录
2. 确认 Today 可触发 AI 总结
3. 确认 Medicine 风险检查页能打开
4. 确认 Report 至少一条 PDF 导出请求能成功

这部分前端基线见 `../Luminous/docs/MVP_Demo_Baseline.md`。

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
