# Tencent Cloud CVM + TCR + GitHub Actions CI/CD 操作说明

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
- GitHub Actions 负责：
  - 用仓库里的 `.github/workflows/lucent-cd.yml` 构建 Lucent 镜像
  - 推送镜像到腾讯云 TCR
  - 通过 SSH 上传部署资产到服务器
  - 在服务器上执行部署脚本
- 服务器负责：
  - `docker compose pull`
  - `docker compose up`

这就是你最终选定的纯制品方案：

- 应用从 CI 产出的镜像部署
- 服务器不保留 git checkout
- compose、monitoring、deploy 脚本等部署资产由 GitHub Actions 上传

## 为什么是这套

这是判断，不是云厂商官方原话。

理由：

1. 应用镜像由 CI 构建，回滚和复现都更稳
2. 生产机不负责编译应用，压力更小
3. 服务器不需要安装 Node、pnpm 或保留源码 checkout
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
- CD 入口：`.github/workflows/lucent-cd.yml`

服务器：

- release 目录：`/opt/lucent/releases`
- 运行时目录：`/opt/lucent/runtime`

## GitHub Actions CD 关键变量

`.github/workflows/lucent-cd.yml` 当前使用这些变量：

- `SERVER_RELEASES_DIR`
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

- `REGISTRY_HOST` 指向 TCR 地址，当前使用香港地域 `hkccr.ccs.tencentyun.com`
- `REGISTRY_NAMESPACE` 是你的命名空间，当前为 `lucent`
- `REGISTRY_IMAGE_NAME` 建议固定为 `lucent`

workflow 会把当前 commit SHA 作为 release id 和镜像 tag，并额外推送一个 `latest` tag。

## 服务器前提

部署用户需要满足：

1. 能 SSH 登录服务器
2. 能写入 `/opt/lucent/releases`
3. 能执行 `docker compose`
4. 能访问 TCR
5. 能读取 `/opt/lucent/runtime/.env.production`
6. 能读取 `/opt/lucent/runtime/nginx/nginx.conf`
7. 能读取 `/opt/lucent/runtime/certs/*`

## 当前部署脚本边界

部署实际落在两个脚本：

- `scripts/deploy/deploy-server.sh`
  - 真正执行 compose pull/up
  - 根据传入镜像引用写 `.deploy-image.env`
- `scripts/deploy/sync-deploy-assets.sh`
  - 把某次 release 目录切换成 `/opt/lucent/releases/current`

GitHub Actions 先上传 release 目录，再在服务器顺序执行这两个脚本。

## `.github/workflows/lucent-cd.yml` 当前职责

1. `checkout`
2. Docker Buildx
   - 构建 Lucent 镜像
   - 推送到 TCR
   - 当前显式关闭 provenance / SBOM attestation，并固定 `linux/amd64`，避免部分 TCR 场景在推送 OCI attestation / manifest list 时卡住
3. SSH 上传：
   - `docker-compose.yml`
   - `monitoring/**`
   - `scripts/deploy/**`
   - `deploy/nginx/nginx.conf`
4. 远程执行：
   - `scripts/deploy/sync-deploy-assets.sh`
   - `scripts/deploy/deploy-server.sh`

## 首次接通建议

1. 先确认 GitHub repository 的 `production` environment 已经配置好这些 secrets：
   - `TCR_USERNAME`
   - `TCR_PASSWORD`
   - `DEPLOY_HOST`
   - `DEPLOY_PORT`
   - `DEPLOY_USER`
   - `DEPLOY_SSH_KEY`
   - `DEPLOY_SSH_KNOWN_HOSTS`
2. 先确认服务器上手工执行以下命令能成功：

```bash
export LUCENT_RELEASES_DIR=/opt/lucent/releases
export LUCENT_RELEASE_ID=manual-test
sh /opt/lucent/releases/manual-test/scripts/deploy/sync-deploy-assets.sh
export LUCENT_DEPLOY_DIR=/opt/lucent/releases/current
export LUCENT_RUNTIME_DIR=/opt/lucent/runtime
export LUCENT_IMAGE=<a-real-tcr-image>
export POSTGRES_IMAGE=postgres:18-alpine
export REDIS_IMAGE=redis:8-alpine
export PROMETHEUS_IMAGE=prom/prometheus:v3.12.0
export GRAFANA_IMAGE=grafana/grafana-oss:13.0.2
export NGINX_IMAGE=nginx:1.29.1-alpine
sh /opt/lucent/releases/current/scripts/deploy/deploy-server.sh
```

3. 手工跑通后，再触发 GitHub Actions `lucent-cd`

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

### GitHub Actions 构建失败

优先核对：

- `REGISTRY_HOST`
- `REGISTRY_NAMESPACE`
- GitHub `production` environment 中的 TCR 凭证
- `Dockerfile`

如果日志停在 `Build and push Lucent image` 且已经出现：

- `exporting attestation manifest`
- `exporting manifest list`
- `pushing layers`

优先怀疑不是登录失败，而是 registry 对 buildx 默认 attestation / image index 输出兼容性差。当前 workflow 已关闭 `provenance`、`sbom` 并固定单平台推送来规避这一类问题。

### 服务器部署失败

优先核对：

- `/opt/lucent/releases/current` 是否已经切到本次 release
- `/opt/lucent/runtime/.env.production` 是否存在
- `.deploy-image.env` 是否已写入
- `docker compose --project-name lucent --project-directory /opt/lucent/releases/current -f /opt/lucent/releases/current/docker-compose.yml --env-file /opt/lucent/runtime/.deploy-image.env logs --tail=200 app`

### 服务器拉镜像失败

优先核对：

- 服务器能否访问 TCR
- 镜像是否已经成功推送
- 镜像标签是否与 `LUCENT_IMAGE` 一致

## 参考

- Docker Docs: [Image digests](https://docs.docker.com/dhi/core-concepts/digests/)
- Tencent Cloud: [TCR Documentation](https://www.tencentcloud.com/document/product/1141)
- GitHub Docs: [Publishing Docker images](https://docs.github.com/actions/guides/publishing-docker-images)
