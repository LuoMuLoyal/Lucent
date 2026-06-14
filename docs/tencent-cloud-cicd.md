# Tencent Cloud CVM + TCR CI/CD 操作说明

Last updated: 2026-06-14

这份文档只说明腾讯云这条部署链路怎么接通，不重复解释运行时变量，也不替代部署执行清单。

- 运行时变量与本地命令：`environment.md`
- 部署文件归属：`deployment-files.md`
- 实际上线核对步骤：`deployment-checklist.md`

## 当前部署模型

- GitHub Actions 负责 `lint`、`typecheck`、`build`、tests、业务镜像构建与推送
- 腾讯云 CVM 负责：
  - `git pull --ff-only`
  - 登录镜像仓库
  - `docker compose pull` 和 `docker compose up`
- 代码仓库在服务器：
  - `/opt/lucent/app`
- 服务器本地运行时文件在：
  - `/opt/lucent/runtime`

当前 workflow 已不再通过 SSH 打包上传 tracked 文件到服务器。

## TCR 选择

当前更适合先用 `TCR Individual`。

这是判断，不是腾讯云官方原话。理由很直接：

- 当前 CI 是 GitHub 官方托管 runner
- 先跑通公网 push / pull 比先上更复杂的实例网络控制更重要
- 对单机 CVM + GitHub Actions 来说，`TCR Individual` 配置更少

后面如果你改成自托管 runner、私网拉取、或者要更细权限控制，再考虑迁到 `TCR Enterprise`。

## TCR 初始化

在腾讯云控制台按这个顺序做：

1. 进入 `腾讯云容器镜像服务 TCR`
2. 选择 `广州`
3. 打开 `TCR Individual Edition`
4. 执行 `Initialize Password`
5. 创建 namespace

登录仓库时：

```bash
docker login ccr.ccs.tencentyun.com --username=<你的腾讯云账号ID>
```

- `username` 是腾讯云 `Account ID`
- `password` 是 TCR 初始化密码

## GitHub 仓库配置

### Secrets

- `REGISTRY_USERNAME`
- `REGISTRY_PASSWORD`
- `SERVER_HOST`
- `SERVER_PORT`
- `SERVER_USER`
- `SERVER_SSH_KEY`
- `SERVER_KNOWN_HOSTS`

### Variables

- `SERVER_APP_DIR=/opt/lucent/app`
- `LUCENT_RUNTIME_DIR=/opt/lucent/runtime`
- `REGISTRY_HOST=ccr.ccs.tencentyun.com`
- `REGISTRY_NAMESPACE=<your-namespace>`
- `REGISTRY_IMAGE_NAME=lucent`

## 服务器前提

部署用户需要满足：

1. 能 SSH 登录服务器
2. 能进入 `/opt/lucent/app`
3. 能执行 `git pull --ff-only`
4. 能执行 `docker compose`
5. 能读取 `/opt/lucent/runtime/.env.production`
6. 能读取 `/opt/lucent/runtime/nginx/nginx.conf`
7. 能读取 `/opt/lucent/runtime/certs/*`

## 当前镜像约定

业务镜像：

- `ccr.ccs.tencentyun.com/<namespace>/lucent:latest`

基础镜像：

- `ccr.ccs.tencentyun.com/<namespace>/lucent-postgres:18-alpine`
- `ccr.ccs.tencentyun.com/<namespace>/lucent-redis:8-alpine`

监控与反代镜像：

- `ccr.ccs.tencentyun.com/<namespace>/lucent-prometheus:v3.12.0`
- `ccr.ccs.tencentyun.com/<namespace>/lucent-grafana:13.0.2`
- `ccr.ccs.tencentyun.com/<namespace>/lucent-nginx:1.29.1-alpine`

说明：

- `latest` 是当前业务镜像发布入口
- `prometheus`、`grafana`、`nginx` 会由 workflow 自动 mirror 到同一 registry
- `postgres`、`redis` 需要你首次手工同步一次

## 部署链路

当前 `deploy-server.yml` 的部署阶段做的是：

1. CI 组装镜像引用
2. SSH 到服务器
3. 在 `/opt/lucent/app` 执行 `git pull --ff-only`
4. 调 `scripts/deploy/deploy-server.sh`
5. 由部署脚本：
   - 校验 `/opt/lucent/runtime/.env.production`
   - 生成 `/opt/lucent/runtime/.deploy-image.env`
   - `docker login`
   - `docker compose pull`
   - 启动 `postgres`、`redis`、`app`
   - 再启动 `synthetic-monitor`、`prometheus`、`grafana`、`nginx`

## 首次部署前必须手工做的事

1. 先把 `postgres:18-alpine` 和 `redis:8-alpine` 手工同步到你的 TCR namespace
2. 先在服务器手工验证一次：

```bash
docker login ccr.ccs.tencentyun.com --username '<tencent-account-id>'
docker pull ccr.ccs.tencentyun.com/<namespace>/lucent-postgres:18-alpine
docker pull ccr.ccs.tencentyun.com/<namespace>/lucent-redis:8-alpine
```

3. 准备好 `/opt/lucent/app` 仓库 checkout 和 `/opt/lucent/runtime` 目录

具体执行顺序看 `deployment-checklist.md`。

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

### GitHub Actions push 失败

优先核对：

- `REGISTRY_HOST`
- `REGISTRY_NAMESPACE`
- `REGISTRY_USERNAME`
- TCR 密码是否正确

### 服务器 pull 失败

优先核对：

- 服务器上 `docker login` 是否成功
- 对应镜像是否已经存在于目标 namespace
- 服务器能否访问 `ccr.ccs.tencentyun.com`

### 服务器 deploy 失败

优先核对：

- 服务器上 `git pull --ff-only` 是否正常
- `/opt/lucent/runtime/.env.production` 是否存在
- `/opt/lucent/runtime/nginx/nginx.conf` 是否存在
- `GF_SECURITY_ADMIN_PASSWORD` 是否已配置

## 官方参考

- Tencent Cloud: [TCR Individual Getting Started](https://www.tencentcloud.com/document/product/1051/45257)
- Tencent Cloud: [Upload Docker Images to Tencent Container Image Repository (TCR)](https://www.tencentcloud.com/document/product/1234/61495)
- Tencent Cloud: [Creating an Enterprise Edition Instance](https://www.tencentcloud.com/document/product/1051/35486)
- Tencent Cloud: [Network Access Control Overview](https://www.tencentcloud.com/document/product/1051/35490)
- Tencent Cloud: [Private Network Access Control](https://www.tencentcloud.com/document/product/1051/35492)
