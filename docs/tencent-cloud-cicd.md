# Tencent Cloud CVM + TCR CI/CD 操作说明

Last updated: 2026-06-11

这份说明对应当前 Lucent 仓库里的 CI/CD 实现：

- GitHub Actions 负责 `lint` / `build` / tests / Docker build / push
- 腾讯云广州 CVM 只负责拉取镜像和运行容器
- 服务器不需要在部署时访问 GitHub
- 服务器也不需要访问 Docker Hub
- 当前 workflow 对业务镜像使用普通 `docker build` + `docker push`，不走 Docker Buildx 的 attestation / manifest 导出路径
- 当前 workflow 只推送并部署业务镜像的 `latest` tag，不再额外维护 `sha-<commit>` tag；部署失败后不会自动回滚到上一版镜像

## 先说结论

对你现在这套组合，我推荐先用 `TCR Individual`，不是先上 `TCR Enterprise 私网版`。

这是判断，不是腾讯云官方原话。理由很具体：

- 当前仓库使用的是 GitHub 官方托管 runner，不是你自己机器上的 self-hosted runner。
- TCR Enterprise 新实例默认关闭公网和私网访问入口；如果要让 GitHub-hosted runner 推镜像，就必须额外解决公网访问控制问题。
- TCR Individual 对当前这种“小型单机 + GitHub Actions + 国内服务器拉取”的路径更直接，配置更少，先跑通更重要。

等你后面要上更细粒度权限、私网拉取、TKE 或自托管 runner，再迁到 TCR Enterprise。

## 方案选择

### 推荐路径：TCR Individual

适合你当前场景：

- 一台腾讯云广州 CVM
- GitHub Actions 官方托管 runner
- 目标是先把 Lucent 稳定部署起来

优点：

- GitHub Actions 可以直接推镜像到腾讯云仓库
- CVM 可以直接从腾讯云仓库拉镜像
- 不需要为 GitHub-hosted runner 设计公网白名单

代价：

- 是共享实例，不是独占实例
- namespace 名字需要全局唯一

### 升级路径：TCR Enterprise

适合后续这些情况：

- 你准备上自托管 GitHub runner
- 你希望用私网拉镜像
- 你要做 namespace 级权限、service account、审计和更严格的访问控制

当前不建议你先走这条路，除非你明确准备同时处理 runner 网络入口问题。

## 第 1 步：开通 TCR Individual

按腾讯云官方文档，TCR Individual 初始化和 push/pull 入口在广州可用，创建后要先初始化密码，再创建 namespace。

你在控制台里按这个顺序做：

1. 登录腾讯云控制台，进入 `腾讯云容器镜像服务 TCR`
2. 进入 `实例管理`
3. 选择 `广州`
4. 找到 `TCR Individual Edition` 页签
5. 点击 `Initialize Password`
6. 设置一个专门给仓库登录用的密码
7. 点击 `Log In to Instance`

然后创建 namespace：

1. 左侧进入 `Namespace`
2. 顶部选择 `TCR Individual Instance`
3. 点击 `Create`
4. namespace 建议用短小、稳定、全小写的名字，例如 `lumoslucent`

注意：

- namespace 在 TCR Individual 里要全局唯一，撞名就换一个。
- 你不一定要先手工建 repository；腾讯云官方文档说明，push 首个镜像时会自动创建对应 repository。

## 第 2 步：拿到登录信息

TCR Individual 官方登录方式是：

```bash
docker login ccr.ccs.tencentyun.com --username=<你的腾讯云账号ID>
```

这里：

- `username` 不是邮箱，也不是昵称，而是腾讯云账号 ID
- `password` 就是你刚才初始化 TCR Individual 时设置的密码

如果你不知道账号 ID：

1. 进入腾讯云控制台右上角账号信息
2. 找到 `Account ID`

## 第 3 步：在 GitHub 仓库里配置 Secrets / Variables

按当前仓库的 workflow，你需要这些配置。

### GitHub Secrets

- `REGISTRY_USERNAME`
  - 值：腾讯云 `Account ID`
- `REGISTRY_PASSWORD`
  - 值：TCR Individual 初始化时设置的密码
- `SERVER_HOST`
  - 值：你的广州 CVM 公网 IP
- `SERVER_PORT`
  - 值：通常是 `22`
- `SERVER_USER`
  - 值：例如 `root` 或你自己的 sudo 用户
- `SERVER_SSH_KEY`
  - 值：用于 SSH 登录服务器的私钥内容
- `SERVER_KNOWN_HOSTS`
  - 值：`ssh-keyscan -p 22 <server_ip>` 的输出

### GitHub Variables

- `SERVER_APP_DIR`
  - 推荐：`/opt/lucent`
- `REGISTRY_HOST`
  - 固定写：`ccr.ccs.tencentyun.com`
- `REGISTRY_NAMESPACE`
  - 值：你刚创建的 TCR namespace，例如 `lumoslucent`
- `REGISTRY_IMAGE_NAME`
  - 推荐：`lucent`

## 第 4 步：初始化服务器目录

先 SSH 登录你的腾讯云 CVM，然后执行：

```bash
sudo mkdir -p /opt/lucent
sudo chown -R "$USER":"$USER" /opt/lucent
cd /opt/lucent
```

然后创建生产环境文件：

```bash
cat > .env.production <<'EOF'
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
CORS_ORIGIN=https://your-domain.example
DATABASE_URL=postgresql://lucent:lucent_dev@postgres:5432/lucent?schema=public
REDIS_URL=redis://redis:6379
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=14d
JWT_ACCESS_SECRET=replace_with_strong_access_secret
JWT_REFRESH_SECRET=replace_with_strong_refresh_secret
AI_PROVIDER=openai-compatible
AI_ANALYSIS_BASE_URL=
AI_ANALYSIS_API_KEY=
AI_ANALYSIS_MODEL=
AI_VISION_BASE_URL=
AI_VISION_API_KEY=
AI_VISION_MODEL=
AI_LANGUAGE_BASE_URL=
AI_LANGUAGE_API_KEY=
AI_LANGUAGE_MODEL=
AI_CHAT_BASE_URL=
AI_CHAT_API_KEY=
AI_CHAT_MODEL=
AI_CHAT_COMPRESSION_BASE_URL=
AI_CHAT_COMPRESSION_API_KEY=
AI_CHAT_COMPRESSION_MODEL=
AI_EMBEDDING_BASE_URL=
AI_EMBEDDING_API_KEY=
AI_EMBEDDING_MODEL=
MAIL_DRIVER=smtp
MAIL_HOST=smtp.example.com
MAIL_PORT=587
MAIL_FROM=noreply@example.com
MAIL_USER=your_email@example.com
MAIL_PASS=your_password
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=replace_with_strong_admin_password
ADMIN_COOKIE_SECRET=replace_with_at_least_32_chars_admin_cookie_secret
WECHAT_WEB_APP_ID=
WECHAT_WEB_APP_SECRET=
WECHAT_WEB_REDIRECT_URI=https://your-domain.example/api/v1/auth/oauth/wechat-web/callback
WECHAT_MOBILE_APP_ID=
WECHAT_MOBILE_APP_SECRET=
TENCENT_COS_SECRET_ID=
TENCENT_COS_SECRET_KEY=
TENCENT_COS_BUCKET=
TENCENT_COS_REGION=ap-guangzhou
TENCENT_COS_PUBLIC_BASE_URL=
TENCENT_COS_UPLOAD_EXPIRES_SECONDS=600
TENCENT_COS_MAX_UPLOAD_BYTES=10485760
LOG_LEVEL=info
EOF
```

必须改掉这些值：

- `CORS_ORIGIN`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `MAIL_*`
- `AI_*`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `ADMIN_COOKIE_SECRET`

如果要启用日常记录图片上传，还要配置腾讯 COS：

- `TENCENT_COS_SECRET_ID`
- `TENCENT_COS_SECRET_KEY`
- `TENCENT_COS_BUCKET`
- `TENCENT_COS_REGION`
- `TENCENT_COS_PUBLIC_BASE_URL` 可选，填 CDN 或公开访问域名时，接口会返回可保存的 `publicUrl`

## 第 5 步：先在服务器上手工验证一次 TCR 登录和拉取

这一步不要跳。先确认服务器和腾讯云仓库之间是通的。

```bash
docker login ccr.ccs.tencentyun.com --username '<你的腾讯云账号ID>'
```

输入你初始化 TCR Individual 时设置的密码。

如果登录成功，再做一个手工拉取检查。第一次仓库里还没 Lucent 镜像时，你可以等首个 GitHub Actions 成功后再拉：

```bash
docker pull ccr.ccs.tencentyun.com/<你的namespace>/lucent:latest
```

当前仓库的生产 compose 会固定使用这两个基础镜像标签：

- `ccr.ccs.tencentyun.com/<namespace>/lucent-postgres:18-alpine`
- `ccr.ccs.tencentyun.com/<namespace>/lucent-redis:8-alpine`

它们不再由每次发版的 GitHub Actions 自动同步。你需要在首个部署前手工同步一次，然后再验证拉取。

推荐在你本地开发机或一台网络比 GitHub Runner 更稳定的机器上执行：

```bash
docker pull postgres:18-alpine
docker tag postgres:18-alpine ccr.ccs.tencentyun.com/<你的namespace>/lucent-postgres:18-alpine
docker push ccr.ccs.tencentyun.com/<你的namespace>/lucent-postgres:18-alpine

docker pull redis:8-alpine
docker tag redis:8-alpine ccr.ccs.tencentyun.com/<你的namespace>/lucent-redis:8-alpine
docker push ccr.ccs.tencentyun.com/<你的namespace>/lucent-redis:8-alpine
```

同步完以后，再在服务器上验证：

```bash
docker pull ccr.ccs.tencentyun.com/<你的namespace>/lucent-postgres:18-alpine
docker pull ccr.ccs.tencentyun.com/<你的namespace>/lucent-redis:8-alpine
```

## 第 6 步：触发首个部署

当 GitHub Secrets / Variables 都配好以后：

1. push 到 `main`
2. 或者在 GitHub Actions 页面手工触发 `lucent-ci-cd`

首个成功部署后，服务器目录里会出现这些文件：

- `.env.production`
- `.deploy-image.env`
- `docker-compose.yml`
- `scripts/deploy/deploy-server.sh`

然后在服务器上检查：

```bash
cd /opt/lucent
docker compose --env-file .deploy-image.env ps
docker compose --env-file .deploy-image.env logs --tail=100 app
curl http://127.0.0.1:3000/api/v1/health
```

如果一切正常，健康检查应该返回 200。

注意：当前部署只使用 `latest` tag。失败时需要手工重新推送一个可用的 `latest`，或临时修改服务器 `.deploy-image.env` 里的 `LUCENT_IMAGE` 指向你明确知道可用的镜像 tag。

## 第 7 步：开放服务器端口和域名

腾讯云控制台里至少确认这些：

- CVM 安全组放行 `22`
- CVM 安全组放行 `3000`，或者只放行你前面反代要用的端口

如果你前面还要挂 Nginx / Caddy 反向代理和 HTTPS：

- 反代监听 `80/443`
- Lucent 容器继续只监听宿主机 `3000`

## 常见问题

### 1. `docker login` 成功，但 GitHub Actions push 失败

先核对三件事：

- `REGISTRY_HOST` 是否是 `ccr.ccs.tencentyun.com`
- `REGISTRY_NAMESPACE` 是否就是你在 TCR 里创建的 namespace
- `REGISTRY_USERNAME` 是否真的是腾讯云 `Account ID`

### 2. 服务器能 SSH，但部署时 pull 失败

通常是：

- TCR 密码填错
- namespace 写错
- 仓库还没被首次 push 自动创建

先在服务器手工执行：

```bash
docker login ccr.ccs.tencentyun.com --username '<你的腾讯云账号ID>'
docker pull ccr.ccs.tencentyun.com/<你的namespace>/lucent:latest
```

### 3. 为什么不直接让服务器自己 `git pull`

因为你最开始遇到的问题就是国内服务器访问外网不稳定。当前仓库已经改成：

- GitHub Actions 构建镜像
- GitHub Actions 把部署文件通过 SSH 传到服务器
- 服务器只从腾讯云镜像仓库拉镜像

基础镜像不再放在每次发版的热路径里，否则你会继续被 GitHub Runner 到 Docker Hub / TCR 的链路波动拖住。

这样服务器不再依赖 GitHub，也不再依赖 Docker Hub。

### 4. 什么时候再升级到 TCR Enterprise

建议等下面任一条件满足时再切：

- 你要用私网拉取镜像
- 你要自托管 GitHub runner
- 你要 namespace 级别的读写权限控制
- 你要 service account 管理 CI/CD 凭证

## 企业版升级说明

如果你以后切到 TCR Enterprise，要记住两个关键差异：

1. 新实例默认关闭公网和私网访问入口，不会天然允许外部 push/pull。
2. 私网拉取需要 VPC + Private DNS，并把实例和目标 VPC 建立 private network access linkage。

这条路径更适合：

- 腾讯云同地域 VPC 内的 CVM / TKE
- 自托管 runner
- 需要更严格权限边界的生产环境

## 官方参考

- Tencent Cloud: [TCR Individual Getting Started](https://www.tencentcloud.com/document/product/1051/45257)
- Tencent Cloud: [Upload Docker Images to Tencent Container Image Repository (TCR)](https://www.tencentcloud.com/document/product/1234/61495)
- Tencent Cloud: [Creating an Enterprise Edition Instance](https://www.tencentcloud.com/document/product/1051/35486)
- Tencent Cloud: [Network Access Control Overview](https://www.tencentcloud.com/document/product/1051/35490)
- Tencent Cloud: [Private Network Access Control](https://www.tencentcloud.com/document/product/1051/35492)
