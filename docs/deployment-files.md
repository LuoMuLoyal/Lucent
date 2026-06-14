# Lucent Deployment Files

Last updated: 2026-06-14

这份文档只回答一个问题：部署 Lucent 时，哪些文件需要你手工准备，哪些文件会由仓库和 CI 自动同步。

## 手工准备

服务器目录默认是 `/opt/lucent`。

必须手工创建：

```text
/opt/lucent/.env.production
/opt/lucent/certs/fullchain.pem
/opt/lucent/certs/privkey.pem
```

说明：

- `.env.production` 是生产运行配置
- `fullchain.pem` / `privkey.pem` 是 Nginx HTTPS 证书
- 这三个文件都不应由 Git 管理

建议手工创建：

```text
/opt/lucent/certs/
```

## CI 自动同步

每次 `deploy-server.yml` 部署时，会同步这些仓库文件到服务器：

```text
docker-compose.yml
scripts/deploy/deploy-server.sh
monitoring/**
deploy/nginx/**
```

说明：

- `monitoring/**` 包含 Prometheus、Grafana provisioning、默认 dashboard、synthetic checker
- `deploy/nginx/**` 包含 Nginx 模板配置

## 部署时自动生成

部署脚本运行后会在服务器目录生成：

```text
/opt/lucent/.deploy-image.env
```

这个文件记录当前发版使用的镜像引用：

- `LUCENT_IMAGE`
- `POSTGRES_IMAGE`
- `REDIS_IMAGE`
- `PROMETHEUS_IMAGE`
- `GRAFANA_IMAGE`
- `NGINX_IMAGE`

不要手工长期维护它；它应由部署脚本覆盖写入。

## 运行时卷

`docker compose` 会创建这些数据卷：

```text
lucent_pgdata
lucent_redisdata
lucent_prometheusdata
lucent_grafanadata
```

这几个卷是运行期数据，不属于 Git 仓库，也不属于手工配置文件。

## 最小核对清单

部署前确认：

1. `.env.production` 已填写完整
2. `NGINX_SERVER_NAME`、`NGINX_SSL_CERT_PATH`、`NGINX_SSL_KEY_PATH` 已正确填写
3. 证书文件路径存在且 Nginx 容器可读
4. `GF_SECURITY_ADMIN_PASSWORD` 已配置
5. 如果要启用 synthetic check，`SYNTHETIC_LOGIN_EMAIL` / `SYNTHETIC_LOGIN_PASSWORD` 已配置

部署后确认：

1. `docker compose --env-file .deploy-image.env ps`
2. `curl http://127.0.0.1:3000/api/v1/health/ready`
3. `curl http://127.0.0.1:9090/api/v1/targets`
4. `curl https://<your-domain>/api/v1/health/ready`
