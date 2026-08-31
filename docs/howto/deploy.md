---
status: active
owner: backend
quadrant: howto
updated: 2026-08-31
---

# How-To: 生产部署快速路径

详细部署手册见 [[reference/deployment]]。本文仅给出快速步骤和检查点。

## 前置

- 服务器已配置 `.env.production`、TLS 证书、Nginx 反向代理
- Docker 镜像仓库（Tencent TCR）凭证已配置
- 阅读 [[reference/deployment]] 了解完整目录布局和运维流程

## CI/CD 部署

Lucent 使用 GitHub Actions CD：Docker 镜像构建 → Tencent TCR 推送 → SSH 部署。

- 推送到 `main` 分支：CI 成功后自动部署到 **staging**
- **production**：staging 验证通过后，手动触发 `lucent-production.yml` 的
  `workflow_dispatch`（单 slot 停机部署，发布时间需人工可控）

## 手动部署（紧急修复）

```bash
cd Lucent

# 1. 构建镜像
docker build -f Dockerfile -t lucent:latest .

# 2. 推送到 TCR
docker tag lucent:latest {registry}/lucent:latest
docker push {registry}/lucent:latest

# 3. SSH 到服务器走标准部署流程（含 migrate + 健康门禁）
ssh deploy@server "cd /opt/lucent && LUCENT_IMAGE={registry}/lucent:latest node deploy.ts"
```

## 部署后验证

```bash
# 冒烟测试
pnpm deploy:smoke

# 健康检查
curl https://{host}/api/v1/health
curl https://{host}/api/v1/health/deep
```

## 回滚

```bash
ssh deploy@server "cd /opt/lucent && node deploy.ts --rollback"
```

回滚只回滚应用版本（镜像 tag），数据库 schema 不回退。具体回滚策略和保留版本数见
[[reference/deployment]]。
