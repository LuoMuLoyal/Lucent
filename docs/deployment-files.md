# Lucent Deployment Files

Last updated: 2026-06-14

这份文档只记录部署相关文件和目录归属，不写执行步骤。

## 目录边界

```text
/opt/lucent/app
/opt/lucent/runtime
```

- `/opt/lucent/app`
  - 服务器上的 Lucent git 仓库 checkout
  - 通过 `git pull --ff-only` 更新
  - 保存 tracked 代码、`docker-compose.yml`、`monitoring/**`、部署脚本
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

## 仓库内自带并随 git 更新

```text
/opt/lucent/app/docker-compose.yml
/opt/lucent/app/scripts/deploy/deploy-server.sh
/opt/lucent/app/monitoring/prometheus/prometheus.yml
/opt/lucent/app/monitoring/grafana/provisioning/**
/opt/lucent/app/monitoring/grafana/dashboards/**
/opt/lucent/app/monitoring/synthetic-checker/synthetic-checker.mjs
/opt/lucent/app/deploy/nginx/nginx.conf
```

说明：

- `deploy/nginx/nginx.conf` 只是仓库里的基线示例，用来拷贝出运行时版本
- `monitoring/**` 是受版本控制的部署资产，不属于 runtime 目录

## 部署时自动生成

部署脚本会写入：

```text
/opt/lucent/runtime/.deploy-image.env
```

用途：

- 记录当前部署使用的镜像引用
- 供 `docker compose --env-file /opt/lucent/runtime/.deploy-image.env ...` 使用

这个文件不应手工长期维护；它应该由部署脚本覆盖生成。

## Docker 持久化数据

Compose 数据卷：

```text
lucent_pgdata
lucent_redisdata
lucent_prometheusdata
lucent_grafanadata
```

这些是运行期数据，不属于 git 仓库，也不属于手工维护的配置文件。
