# How-To: 生产部署快速路径

详细部署手册见 [[../deployment]]。本文仅给出快速步骤和检查点。

## 前置

- 服务器已配置 `.env.production`、TLS 证书、Nginx 反向代理
- Docker 镜像仓库（Tencent TCR）凭证已配置
- 阅读 [[../deployment]] 了解完整目录布局和运维流程

## CI/CD 自动部署

Lucent 使用 GitHub Actions CD：Docker 镜像构建 → Tencent TCR 推送 → SSH 部署。

推送到 `main` 分支即触发自动部署流程。

## 手动部署（紧急修复）

```bash
cd Lucent

# 1. 构建镜像
docker build -f Dockerfile -t lucent:latest .

# 2. 推送到 TCR
docker tag lucent:latest {registry}/lucent:latest
docker push {registry}/lucent:latest

# 3. SSH 到服务器拉取并重启
ssh deploy@server "cd /opt/lucent/app && docker compose pull && docker compose up -d"
```

## 部署后验证

```bash
# 冒烟测试
pnpm deploy:smoke

# 部署资产检查
pnpm deploy:assets:check

# 健康检查
curl https://{host}/api/v1/health
curl https://{host}/api/v1/health/deep
```

## 回滚

```bash
ssh deploy@server "cd /opt/lucent/app && docker compose rollback"
```

具体回滚策略和保留版本数见 [[../deployment]]。
