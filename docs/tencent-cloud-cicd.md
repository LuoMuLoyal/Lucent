# Tencent Cloud CVM + TCR + Gitee Go CI/CD 操作说明

Last updated: 2026-06-15

这份文档只说明当前最终推荐的部署链路，不重复解释运行时变量，也不替代部署执行清单。

- 运行时变量与本地命令：`environment.md`
- 部署文件归属：`deployment-files.md`
- 实际上线核对步骤：`deployment-checklist.md`

## 当前最终部署模型

- GitHub Actions 负责校验：
  - `lint`
  - `typecheck`
  - `build`
  - unit tests
  - e2e tests
- Gitee 仓库镜像 GitHub 仓库。
- Gitee Go 负责：
  - 用仓库里的 `.workflow/MasterPipeline.yml` 构建 Lucent 镜像
  - 推送镜像到腾讯云 TCR
  - 在服务器主机组执行部署脚本
- 服务器负责：
  - `git pull --ff-only` 同步部署编排和监控资产
  - `docker compose pull`
  - `docker compose up`

这就是你最终选定的混合方案：

- 应用从 CI 产出的镜像部署
- 服务器保留 git checkout，只同步 compose、monitoring、deploy 脚本等受版本控制资产

## 为什么是这套

这是判断，不是云厂商官方原话。

理由：

1. 应用镜像由 CI 构建，回滚和复现都更稳
2. 生产机不负责编译应用，压力更小
3. 服务器仍保留 git checkout，部署脚本、监控文件、Nginx 基线配置可以随仓库同步
4. 本地运行时文件继续留在 `/opt/lucent/runtime`，不会被仓库覆盖

## TCR 角色

TCR 在这里的职责是：

- 保存 Lucent 应用镜像
- 给服务器提供稳定拉取来源

基础镜像目前仍可直接使用公开镜像：

- `postgres:18-alpine`
- `redis:8-alpine`
- `prom/prometheus:v3.12.0`
- `grafana/grafana-oss:13.0.2`
- `nginx:1.29.1-alpine`

如果后面你希望进一步收口供应链，再把这些公共镜像也 mirror 到 TCR。

## 仓库边界

GitHub：

- 代码主仓库
- 校验入口：`.github/workflows/lucent-ci.yml`

Gitee：

- 镜像仓库
- CD 入口：`.workflow/MasterPipeline.yml`

服务器：

- 代码目录：`/opt/lucent/app`
- 运行时目录：`/opt/lucent/runtime`

## Gitee Go 需要的关键变量

`.workflow/MasterPipeline.yml` 当前使用这些变量：

- `SERVER_APP_DIR`
- `LUCENT_RUNTIME_DIR`
- `REGISTRY_HOST`
- `REGISTRY_NAMESPACE`
- `REGISTRY_IMAGE_NAME`
- `POSTGRES_IMAGE`
- `REDIS_IMAGE`
- `PROMETHEUS_IMAGE`
- `GRAFANA_IMAGE`
- `NGINX_IMAGE`

其中：

- `REGISTRY_HOST` 指向 TCR 地址，例如 `ccr.ccs.tencentyun.com`
- `REGISTRY_NAMESPACE` 是你的命名空间
- `REGISTRY_IMAGE_NAME` 建议固定为 `lucent`

`build@docker` 构建完成后会产出 `GITEE_DOCKER_IMAGE`，部署阶段直接把它当成 `LUCENT_IMAGE` 传给服务器脚本。

## 服务器前提

部署用户需要满足：

1. 能 SSH 登录服务器
2. 能进入 `/opt/lucent/app`
3. 能执行 `git pull --ff-only`
4. 能执行 `docker compose`
5. 能访问：
   - Gitee 仓库
   - TCR
6. 能读取 `/opt/lucent/runtime/.env.production`
7. 能读取 `/opt/lucent/runtime/nginx/nginx.conf`
8. 能读取 `/opt/lucent/runtime/certs/*`

## 当前部署脚本边界

部署实际落在两个脚本：

- `scripts/deploy/deploy-server.sh`
  - 真正执行 compose pull/up
  - 根据传入镜像引用写 `.deploy-image.env`
- `scripts/deploy/deploy-server-from-image.sh`
  - 先 `git pull --ff-only`
  - 再把镜像变量传给 `deploy-server.sh`

Gitee Go 主机组执行的是后者。

## `.workflow/MasterPipeline.yml` 当前职责

1. `checkout`
2. `build@docker`
   - 构建 Lucent 镜像
   - 推送到 TCR
   - 产出 `GITEE_DOCKER_IMAGE`
3. `shell@agent`
   - 在服务器上执行 `scripts/deploy/deploy-server-from-image.sh`

## 首次接通建议

1. 先确认 Gitee 仓库已经正确镜像 GitHub 仓库
2. 先确认服务器上手工执行以下命令能成功：

```bash
cd /opt/lucent/app
git pull --ff-only
export LUCENT_RUNTIME_DIR=/opt/lucent/runtime
export LUCENT_IMAGE=<a-real-tcr-image>
export POSTGRES_IMAGE=postgres:18-alpine
export REDIS_IMAGE=redis:8-alpine
export PROMETHEUS_IMAGE=prom/prometheus:v3.12.0
export GRAFANA_IMAGE=grafana/grafana-oss:13.0.2
export NGINX_IMAGE=nginx:1.29.1-alpine
sh scripts/deploy/deploy-server.sh
```

3. 手工跑通后，再触发 Gitee Go

## 安全组建议

至少对公网放行：

- `22`
- `80`
- `443`

不要对公网放行：

- `3000`
- `9090`
- `3001`

## 常见故障定位

### Gitee Go 构建失败

优先核对：

- `REGISTRY_HOST`
- `REGISTRY_NAMESPACE`
- Gitee Go 的镜像仓库凭证
- `Dockerfile`

### 服务器部署失败

优先核对：

- `git pull --ff-only` 是否正常
- `/opt/lucent/runtime/.env.production` 是否存在
- `.deploy-image.env` 是否已写入
- `docker compose --env-file /opt/lucent/runtime/.deploy-image.env logs --tail=200 app`

### 服务器拉镜像失败

优先核对：

- 服务器能否访问 TCR
- 镜像是否已经成功推送
- 镜像标签是否与 `LUCENT_IMAGE` 一致

## 参考

- Docker Docs: [Image digests](https://docs.docker.com/dhi/core-concepts/digests/)
- Tencent Cloud: [TCR Documentation](https://www.tencentcloud.com/document/product/1141)
- Gitee Help: [Gitee Go](https://help.gitee.com/gitee-go/)
