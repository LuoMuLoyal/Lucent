# Tencent Cloud CVM + Gitee Go CI/CD 操作说明

Last updated: 2026-06-15

这份文档只说明当前推荐的部署链路，不重复解释运行时变量，也不替代部署执行清单。

- 运行时变量与本地命令：`environment.md`
- 部署文件归属：`deployment-files.md`
- 实际上线核对步骤：`deployment-checklist.md`

## 当前部署模型

- GitHub Actions 负责代码校验：
  - `lint`
  - `typecheck`
  - `build`
  - unit tests
  - e2e tests
- GitHub 仓库是主仓库。
- Gitee 仓库是镜像仓库。
- 服务器负责：
  - `git pull --ff-only`
  - `docker compose pull`
  - `docker compose build app`
  - `sh scripts/deploy/deploy-server.sh`
- Gitee Go 的职责应该只是触发服务器执行这套已有脚本，而不是再维护一套平行部署逻辑。

## 为什么改成这套

这是判断，不是云厂商官方原话。

理由很直接：

- 你已经明确想要服务器直接访问外网。
- 服务器能直接访问 GitHub/Gitee、Docker Hub、npm registry 后，继续维护“CI 构建镜像并推送，再服务器只 pull”这套链路没有明显收益。
- 当前项目还有 Nginx、证书、`.env.production`、监控资产这类服务器本地文件；把部署边界收敛成“仓库代码 + 服务器运行时目录”更简单，也更不容易错。

## 服务器前提

部署用户需要满足：

1. 能 SSH 登录服务器
2. 能进入 `/opt/lucent/app`
3. 能执行 `git pull --ff-only`
4. 能执行 `docker compose`
5. 能访问外网，至少包括：
   - GitHub 或 Gitee
   - Docker Hub
   - npm registry
6. 能读取 `/opt/lucent/runtime/.env.production`
7. 能读取 `/opt/lucent/runtime/nginx/nginx.conf`
8. 能读取 `/opt/lucent/runtime/certs/*`

## 仓库布局

代码仓库在服务器：

- `/opt/lucent/app`

服务器本地运行时文件在：

- `/opt/lucent/runtime`

其中：

- `/opt/lucent/app` 通过 `git pull --ff-only` 更新
- `/opt/lucent/runtime` 只放本地配置、证书和环境变量，不进 git

## GitHub 与 Gitee 边界

GitHub：

- 保留 `.github/workflows/lucent-ci.yml`
- 只做校验，不直接 SSH 部署

Gitee：

- 镜像 GitHub 仓库
- 触发 Gitee Go 或其他服务器侧 runner

建议做法：

1. 先在 Gitee 里导入 GitHub 仓库
2. 打开后续同步更新
3. 让 Gitee Go 在服务器主机组上执行：

```bash
cd /opt/lucent/app
git pull --ff-only
export LUCENT_RUNTIME_DIR=/opt/lucent/runtime
sh scripts/deploy/deploy-server.sh
```

不要同时保留 GitHub 直连 SSH 部署和 Gitee Go 主机组部署两套主链路。

## 部署脚本当前行为

`scripts/deploy/deploy-server.sh` 当前会：

1. 校验 `LUCENT_RUNTIME_DIR`
2. 校验 `/opt/lucent/runtime/.env.production`
3. 校验 `GF_SECURITY_ADMIN_PASSWORD`
4. 提醒 synthetic 账号是否缺失
5. `docker compose pull postgres redis prometheus grafana nginx`
6. `docker compose build app`
7. 启动 `postgres`、`redis`
8. 等待数据库和缓存健康
9. 启动 `app`
10. 启动 `synthetic-monitor`、`prometheus`、`grafana`、`nginx`

## 首次接通建议

1. 先手工在服务器上跑通一次：

```bash
cd /opt/lucent/app
git pull --ff-only
export LUCENT_RUNTIME_DIR=/opt/lucent/runtime
sh scripts/deploy/deploy-server.sh
```

2. 手工跑通后，再把完全相同的命令搬进 Gitee Go。

别反过来。先让 Gitee Go 接管一个你本地都没验证过的部署命令，只会放大排查成本。

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

### `git pull` 失败

优先核对：

- 服务器出网
- 仓库地址
- SSH key 或访问令牌
- 当前 checkout 分支

### `docker compose pull` 失败

优先核对：

- 服务器能否访问 Docker Hub
- Docker 守护进程是否正常
- DNS / 代理 / 防火墙

### `docker compose build app` 失败

优先核对：

- 服务器能否访问 npm registry
- Node / Docker 磁盘空间是否足够
- `pnpm-lock.yaml` 是否与仓库内容匹配

### 应用起来了但页面不通

优先核对：

- `docker compose logs --tail=200 app`
- `docker compose logs --tail=200 nginx`
- `/opt/lucent/runtime/nginx/nginx.conf`
- `/opt/lucent/runtime/certs/*`

## 官方参考

- Gitee Help: [帮助中心](https://help.gitee.com/)
- Tencent Cloud: [CVM Documentation](https://www.tencentcloud.com/document/product/213)
