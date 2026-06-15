# Lucent Deployment Files

Last updated: 2026-06-15

这份文档只记录部署相关文件和目录归属，不写执行步骤。

## 目录边界

```text
/opt/lucent/releases
/opt/lucent/runtime
```

- `/opt/lucent/releases`
  - 服务器上的部署资产目录
  - 由 GitHub Actions 通过 SSH 上传
  - 保存每次发版的 `docker-compose.yml`、`monitoring/**`、部署脚本和 Nginx 基线示例
  - `current` 软链接指向当前启用版本
- `/opt/lucent/runtime`
  - 服务器本地运行时目录
  - 只放不应进 git 的本地配置与证书

## 服务器本地必须存在

```text
/opt/lucent/runtime/.env.production
/opt/lucent/runtime/nginx/nginx.conf
/opt/lucent/runtime/certs/fullchain.pem
/opt/lucent/runtime/certs/privkey.pem
```

说明：

- `.env.production` 是生产环境变量
- `nginx/nginx.conf` 是服务器实际启用的 Nginx 配置
- `certs/*` 是 HTTPS 证书

这些都不由 Git 管理，也不应由 CI 自动覆盖。

## 由 GitHub Actions 上传到服务器

```text
/opt/lucent/releases/<git-sha>/docker-compose.yml
/opt/lucent/releases/<git-sha>/scripts/deploy/deploy-server.sh
/opt/lucent/releases/<git-sha>/scripts/deploy/sync-deploy-assets.sh
/opt/lucent/releases/<git-sha>/monitoring/prometheus/prometheus.yml
/opt/lucent/releases/<git-sha>/monitoring/grafana/provisioning/**
/opt/lucent/releases/<git-sha>/monitoring/grafana/dashboards/**
/opt/lucent/releases/<git-sha>/monitoring/synthetic-checker/synthetic-checker.mjs
/opt/lucent/releases/<git-sha>/deploy/nginx/nginx.conf
```

说明：

- `deploy/nginx/nginx.conf` 只是仓库里的基线示例，用来拷贝出运行时版本
- `monitoring/**` 是受版本控制的部署资产，但在服务器上以 release 资产形式存在，不属于 runtime 目录

## Docker 持久化数据

## 部署时自动生成

部署脚本会写入：

```text
/opt/lucent/runtime/.deploy-image.env
```

用途：

- 记录当前部署使用的镜像引用
- 供 `docker compose --env-file /opt/lucent/runtime/.deploy-image.env ...` 使用

这个文件不应手工长期维护；它应该由部署脚本覆盖生成。

Compose 数据卷：

```text
lucent_pgdata
lucent_redisdata
lucent_prometheusdata
lucent_grafanadata
```

这些是运行期数据，不属于 git 仓库，也不属于手工维护的配置文件。
