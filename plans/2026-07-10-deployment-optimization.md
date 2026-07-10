# Lucent 部署优化计划

Created: 2026-07-10
Status: planned (deferred — pick up when ready)

## 背景

当前部署链路（ADR-0004）能跑通，但存在若干结构性问题：

- Dockerfile 无 BuildKit cache mount、生产镜像带 pnpm、无 non-root 用户、entrypoint 内跑 migrate
- Compose 无资源限制、无网络隔离、Postgres 密码硬编码、app 端口直接暴露
- CD 流程 `rm -rf` + 全量重建容器 = 明确停机窗口，无回滚能力
- Nginx 无 gzip / 安全头 / 限速，SSE 端点缓冲未关闭
- 无数据库备份策略
- Grafana 有仪表盘但无告警规则
- 无 staging 环境

本计划不引入 Kubernetes，目标是在 Docker Compose 单机部署的基础上做到生产级别。

## Phase 1 — Dockerfile 重构 + 构建优化

改动文件：`Dockerfile`、`.dockerignore`、`docker-entrypoint.sh`、`prisma.config.ts`

### 1.1 Dockerfile 重写

```dockerfile
# syntax=docker/dockerfile:1

# ── Stage 1: deps ──────────────────────────────────────────────
FROM node:24-alpine AS deps
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

# ── Stage 2: builder ───────────────────────────────────────────
FROM node:24-alpine AS builder
RUN corepack enable
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts
COPY tsconfig.json tsconfig.build.json .swcrc nest-cli.json ./
COPY src ./src
# 生成 Prisma Client（输出到 generated/prisma，由 schema.prisma output 字段决定）
# 注意：直接调用 prisma generate，不走 pnpm prisma:generate 脚本（该脚本还会跑 fix-generated-prisma-internal.js）
# fix-generated-prisma-internal.js 仅用于本地开发（将 internal/*.ts 编译为 .js），
# prisma 7 的 prisma-client provider 在 Docker 中直接生成 .js，不需要后处理
RUN pnpm exec prisma generate
# 编译 TypeScript（nest build 会根据 assets 配置复制 i18n JSON 到 dist/）
RUN --mount=type=cache,id=swc,target=/root/.swc \
    pnpm run build
# 剪出生产依赖
RUN pnpm prune --prod --ignore-scripts

# ── Stage 3: production ────────────────────────────────────────
FROM node:24-alpine AS production
RUN apk add --no-cache tini
WORKDIR /app
# 创建非 root 用户
RUN addgroup -S lucent && adduser -S lucent -G lucent
# 生产依赖（已 prune）
COPY --from=builder /app/node_modules ./node_modules
# 编译产物（含 dist/i18n/ 翻译文件）
COPY --from=builder /app/dist ./dist
# Prisma 生成的客户端（schema.prisma output = ../generated/prisma，即仓库根 generated/）
# package.json imports 字段 "#generated/*": "./generated/*" 依赖此路径
COPY --from=builder /app/generated/prisma ./generated/prisma
# Prisma schema + config（migrate 独立步骤用，见 Phase 3）
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts
# src/config/env-file-paths.ts — prisma.config.ts 的导入依赖
COPY --from=builder /app/src/config/env-file-paths.ts ./src/config/env-file-paths.ts
# package.json（pino 等需要读取 version）
COPY package.json ./
# 文件权限
RUN chown -R lucent:lucent /app
USER lucent
EXPOSE 3000
ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/main.js"]
```

关键改动：

- BuildKit cache mount：pnpm store + SWC cache 跨构建复用
- builder 阶段补上 `COPY package.json pnpm-lock.yaml`（否则 `pnpm run build` / `pnpm prune` 找不到 package.json）
- 生产镜像不带 pnpm / corepack
- tini 做 PID 1 信号转发（不再安装冗余的 dumb-init）
- non-root 用户运行
- migrate 不再在 entrypoint 中执行（见 Phase 3）
- Prisma 客户端路径 `generated/prisma`（对应 `schema.prisma` 的 `output = "../generated/prisma"`，与 `package.json` 的 `imports` 字段 `"#generated/*": "./generated/*"` 匹配）
- 生产镜像额外复制 `src/config/env-file-paths.ts`，因为 `prisma.config.ts` 导入了它（`import { getDotenvLoadOrder } from './src/config/env-file-paths'`）

### 1.2 .dockerignore 补充

```
node_modules
dist
.git
.husky
.env
.env.*
!.env.example
*.md
*.log
test
coverage
lucent-bruno
docs
logs
.swc
plans
backend.log
test-output.txt
compodoc
.claude
.history
```

### 1.3 docker-entrypoint.sh 删除

保留 tini ENTRYPOINT 后，`docker-entrypoint.sh` 不再需要。直接在 Dockerfile 中用 `CMD ["node", "dist/main.js"]` 启动应用。删除 `docker-entrypoint.sh` 文件。

当前 entrypoint 中的 `pnpm exec prisma migrate deploy` 迁移到 Phase 3.2 的独立 migrate 步骤。

## Phase 2 — Docker Compose 重构

改动文件：`deploy/docker-compose.yml`

### 2.1 网络隔离

```yaml
networks:
  frontend:
    driver: bridge
  backend:
    driver: bridge
  observability:
    driver: bridge
```

服务分配：

- `nginx` → `frontend` + `backend`
- `app` → `backend` + `observability`
- `postgres` → `backend`
- `redis` → `backend`
- `prometheus` → `observability` + `backend`（需要 scrape app metrics）
- `grafana` → `observability`
- `postgres-backup` → `backend`

### 2.2 资源限制

每个服务加 `deploy.resources.limits`：

| 服务       | CPU limit | Memory limit | CPU reservation | Memory reservation |
| ---------- | --------- | ------------ | --------------- | ------------------ |
| app        | 2.0       | 1G           | 0.5             | 256M               |
| postgres   | 2.0       | 1G           | 0.5             | 256M               |
| redis      | 1.0       | 256M         | 0.25            | 64M                |
| nginx      | 0.5       | 128M         | 0.1             | 32M                |
| prometheus | 1.0       | 512M         | 0.25            | 128M               |
| grafana    | 0.5       | 256M         | 0.1             | 64M                |

### 2.3 安全加固

- Postgres 密码从 `.env.production` 读取，不硬编码
- Redis 加密码 `--requirepass`
- App 端口去掉 `ports`，改用 `expose`
- Postgres / Redis 端口不暴露到宿主机
- 所有服务加日志轮转

### 2.4 Postgres 数据卷

保持与 ADR-0004 和现有生产数据一致的挂载方式：

```yaml
postgres:
  volumes:
    - ${LUCENT_SERVER_DIR}/data/postgresql:/var/lib/postgresql
```

`postgres:18` 会在挂载目录里自行创建版本化子目录。不设 `PGDATA` 环境变量，不挂载到 `/var/lib/postgresql/data`。这与现有部署文档（`docs/01-reference/deployment.md`）一致，避免迁移时数据丢失。

### 2.5 日志轮转

所有服务统一：

```yaml
logging:
  driver: json-file
  options:
    max-size: '50m'
    max-file: '5'
```

### 2.6 日志驱动注记

Pino 在 production 模式下输出 JSON 到 stdout/stderr，Docker json-file 驱动会采集。本地 `logs/` 目录的文件日志（Pino 的 `pino-pretty` 目标）只在开发模式使用，生产 compose 不挂载 `logs/app` 卷。

如果后续启用 Loki + Promtail（Phase 7.3），Promtail 从 Docker 日志驱动采集即可，不需要挂载 `logs/app` 目录。

## Phase 3 — 零停机部署 + 回滚

改动文件：`deploy/deploy-server.ts`、`deploy/docker-compose.yml`、`.github/workflows/lucent-cd.yml`

### 3.1 Blue-Green 部署

compose 中定义 `app-blue` 和 `app-green` 两个服务，同时加入 `backend` 网络。Nginx upstream 同时列出两个 slot，通过 `down` / `backup` 参数控制流量指向。切换时只需 `nginx -s reload`，不存在别名切换的停机窗口。

#### Nginx upstream 配置

```nginx
# Phase 4 中的 upstream 改为：
upstream lucent_app {
    server app-blue:3000 max_fails=3 fail_timeout=10s;
    server app-green:3000 max_fails=3 fail_timeout=10s down;
    keepalive 32;
}
```

部署脚本动态生成 upstream 配置：active slot 正常列出，inactive slot 带 `down` 参数。切换后 `nginx -s reload` 即可。

#### 部署流程（改造 `deploy-server.ts`）

```
1. 读取当前 active slot（blue/green），从 .env.compose 的 ACTIVE_SLOT 字段获取
2. docker compose pull <inactive-slot>
3. docker compose up -d <inactive-slot>
4. 等待 <inactive-slot> 健康检查通过
   - 如果失败：docker compose stop <inactive-slot>，退出，不影响线上
5. 重写 nginx upstream 配置文件：
   - <inactive-slot> 行去掉 down
   - <active-slot> 行加 down
6. docker exec lucent-nginx nginx -s reload
   - Nginx 热加载，新连接指向 <inactive-slot>，旧连接自然结束
7. docker compose stop <active-slot>（等待旧连接结束或 stop_grace_period 超时后停止）
8. 更新 .env.compose 中 ACTIVE_SLOT = <inactive-slot>
9. 输出部署结果
```

关键：步骤 5-6 之间没有停机窗口。`nginx -s reload` 是原子操作，旧 worker 进程会继续处理已有连接直到结束，新 worker 立即使用新 upstream。

### 3.2 独立 Migrate 步骤

在 blue-green 切换之前，用一次性容器跑 migrate。生产镜像不带 pnpm，改用 `npx`（已包含在 Node.js alpine 镜像中）：

```bash
docker run --rm \
  --network lucent_backend \
  --env-file ${LUCENT_SERVER_DIR}/.env.production \
  -e DATABASE_URL=postgresql://lucent:${POSTGRES_PASSWORD}@postgres:5432/lucent?schema=public \
  ${IMAGE_REF} \
  npx prisma migrate deploy
```

注意事项：

- `DATABASE_URL` 必须显式传入，使用 compose 网络内的 `postgres:5432` 主机名，不能用 `127.0.0.1`
- `POSTGRES_PASSWORD` 从 `.env.production` 读取（Phase 2 改为环境变量后）
- `prisma.config.ts` 依赖 `src/config/env-file-paths.ts`，已在 Phase 1 Dockerfile 中复制到生产镜像
- 以 non-root 用户运行时需确保 `npx` 可执行（`node:24-alpine` 默认包含）

CD workflow 中在启动新容器之前执行。migrate 失败 = 中止部署，不影响线上。

### 3.3 回滚

`deploy-server.ts` 加 `--rollback` 参数：

1. 读取 `.env.compose.previous`（上一次成功部署的 image ref + active slot）
2. 用旧 image ref 启动 inactive slot
3. 健康检查通过后重写 nginx upstream 并 `nginx -s reload` 切换
4. 停止当前 active slot
5. 完成

注意：`.env.compose.previous` 只在部署成功后更新，确保回滚指向最近一次成功的版本。

CD workflow 也加一个 `workflow_dispatch` 回滚触发器。

### 3.4 镜像 tag 策略

保留现有 `<git-sha>` + `latest`。新增 `.env.compose` 和 `.env.compose.previous` 两个文件，分别记录当前和上一次部署的 image ref。

## Phase 4 — Nginx 加固 + 性能优化

改动文件：`deploy/nginx/nginx.conf`

### 4.1 Gzip

```nginx
gzip on;
gzip_vary on;
gzip_min_length 1024;
gzip_types text/plain text/css application/json application/javascript
           text/xml application/xml application/xml+rss text/javascript;
```

### 4.2 安全头

```nginx
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

### 4.3 请求限速

```nginx
# 在 http 块中定义
limit_req_zone $binary_remote_addr zone=ai:10m rate=2r/s;
limit_req_zone $binary_remote_addr zone=general:10m rate=20r/s;

# AI 端点 — today-analysis + assistant
location /api/v1/user/today-analysis/ {
    limit_req zone=ai burst=5 nodelay;
    proxy_pass http://lucent_app;
    # ... proxy headers
}

location /api/v1/user/assistant/ {
    limit_req zone=ai burst=5 nodelay;
    proxy_pass http://lucent_app;
    # ... proxy headers
}

# SSE 端点 — 关闭缓冲
location ~ ^/api/v1/.*\/stream$ {
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 300s;
    proxy_pass http://lucent_app;
    # ... proxy headers
}
```

实际 SSE 端点：`/api/v1/user/today-analysis/generate/stream` 和 `/api/v1/user/assistant/messages/stream`，正则 `^/api/v1/.*\/stream$` 能正确匹配。应用代码中 `prepareSse()` 已设置 `X-Accel-Buffering: no` 头，Nginx 会据此关闭缓冲，但显式配置是更可靠的做法。

SSE 端点 `proxy_read_timeout` 从默认 120s 提高到 300s，避免长时间 AI 流式响应被 Nginx 断开。

### 4.4 Upstream 容错

upstream 配置配合 Phase 3 blue-green 部署，由部署脚本动态生成：

```nginx
# active slot 正常列出，inactive slot 带 down
# 部署脚本切换时重写此文件并 nginx -s reload
upstream lucent_app {
    server app-blue:3000 max_fails=3 fail_timeout=10s;
    server app-green:3000 max_fails=3 fail_timeout=10s down;
    keepalive 32;
}
```

初始状态（首次部署，只有 blue）：green 行带 `down`。每次部署时脚本重写 active/inactive 的 `down` 标记。

### 4.5 SSL 优化

```nginx
ssl_stapling on;
ssl_stapling_verify on;
resolver 8.8.8.8 8.8.4.4 valid=300s;
resolver_timeout 5s;
```

部署前验证：

- 确认 `fullchain.pem` 包含完整证书链（中间证书），否则 OCSP stapling 会静默失败
- 用 `openssl s_client -connect your-domain:443 -status` 验证 OCSP stapling 是否生效

## Phase 5 — CI/CD 流水线增强

改动文件：`.github/workflows/lucent-cd.yml`、新建 `.github/workflows/lucent-cd-staging.yml`

### 5.1 构建缓存

```yaml
- uses: docker/build-push-action@v6
  with:
    cache-from: type=gha
    cache-to: type=gha,mode=max
```

### 5.2 CD 流程改造

```
1. Checkout
2. 构建并推送镜像（带 GHA cache）
3. SSH 配置
4. 上传 deploy assets
5. 独立容器执行 prisma migrate deploy
6. Blue-Green 部署（deploy-server.ts）
7. 等待健康检查
8. 自动 smoke test（post-deploy-smoke.ts）
9. 失败 → 自动 rollback + 通知
```

### 5.3 Staging 环境

- 新增 `lucent-cd-staging.yml`
- PR 合并到 main → 先部署到 staging（同服务器不同端口或独立服务器）
- Staging 通过 smoke test → 触发 `lucent-cd.yml` 的 `workflow_dispatch`（手动审批）
- Production deploy 需要手动 approve

### 5.4 部署后自动 smoke + 告警

CD 末尾自动执行 `deploy:smoke`，失败时：

- 自动触发 rollback
- 发送 webhook 通知（飞书/钉钉）

## Phase 6 — 数据库运维

改动文件：`deploy/docker-compose.yml`

### 6.1 定时备份

新增 `postgres-backup` 服务：

```yaml
postgres-backup:
  image: prodrigestivill/postgres-backup-local:18
  environment:
    POSTGRES_HOST: postgres
    POSTGRES_DB: lucent
    POSTGRES_USER: ${POSTGRES_USER:-lucent}
    POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    SCHEDULE: '@daily'
    BACKUP_KEEP_DAYS: 7
    BACKUP_KEEP_WEEKS: 4
    BACKUP_KEEP_MONTHS: 6
    HEALTHCHECK_PORT: 8080
  volumes:
    - ${LUCENT_SERVER_DIR}/data/backups:/backups
  networks:
    - backend
  depends_on:
    postgres:
      condition: service_healthy
```

### 6.2 PgBouncer（可选，多实例时启用）

```yaml
pgbouncer:
  image: edoburu/pgbouncer:latest
  environment:
    DB_USER: lucent
    DB_PASSWORD: ${POSTGRES_PASSWORD}
    DB_HOST: postgres
    DB_NAME: lucent
    POOL_MODE: transaction
    MAX_CLIENT_CONN: 200
  ports:
    - '6432:5432'
  networks:
    - backend
  depends_on:
    postgres:
      condition: service_healthy
```

`DATABASE_URL` 改为指向 `pgbouncer:5432`。

**Prisma 7 + `pg` 驱动兼容性注意**：

- Lucent 使用 `@prisma/adapter-pg`（`pg` 驱动），transaction 模式的 PgBouncer 下 prepared statements 会冲突
- 解决方案：使用 `POOL_MODE: session`，或确保 `pg` 驱动连接参数中设置 `pgBouncer: true`（禁用 prepared statements）
- Prisma 7 的 `adapter-pg` 支持在连接 URL 中加 `?pgbouncer=true&connection_limit=1` 参数
- 建议：仅在确认多实例需要后才启用 PgBouncer，单实例下直连 Postgres 更简单可靠

### 6.3 Redis 持久化

已在 Phase 2 中加 `--requirepass` + `appendonly yes`。

## Phase 7 — 可观测性增强

改动文件：`deploy/prometheus/prometheus.yml`、`deploy/grafana/provisioning/`

### 7.1 Prometheus exporters

新增 `postgres-exporter` 和 `redis-exporter` 服务到 compose：

```yaml
postgres-exporter:
  image: prometheuscommunity/postgres-exporter:v0.15.0
  environment:
    DATA_SOURCE_NAME: 'postgresql://lucent:${POSTGRES_PASSWORD}@postgres:5432/lucent?sslmode=disable'
  networks:
    - observability

redis-exporter:
  image: oliver006/redis_exporter:v1.66.0
  environment:
    REDIS_ADDR: redis://redis:6379
    REDIS_PASSWORD: ${REDIS_PASSWORD}
  networks:
    - observability
```

prometheus.yml 新增抓取目标：

```yaml
scrape_configs:
  - job_name: 'lucent'
    metrics_path: /metrics
    static_configs:
      - targets: ['app:3000']
  - job_name: 'postgres'
    static_configs:
      - targets: ['postgres-exporter:9187']
  - job_name: 'redis'
    static_configs:
      - targets: ['redis-exporter:9121']
```

### 7.2 Grafana 告警

新增 `deploy/grafana/provisioning/alerting/`：

```
alerting/
├── alert-rules.yml
└── contact-points.yml
```

告警规则：

- App CPU > 80% 持续 5 分钟
- App 内存 > 90%
- HTTP 5xx 率 > 5% 持续 2 分钟
- `/api/v1/health/ready` 连续 3 次失败
- PostgreSQL 连接数 > 80% max_connections
- Redis 内存 > 80% maxmemory
- 磁盘使用率 > 85%

通知渠道：webhook → 飞书/钉钉。

### 7.3 Loki + Promtail（可选，日志聚合）

```yaml
loki:
  image: grafana/loki:3.0.0
  volumes:
    - ${LUCENT_SERVER_DIR}/data/loki:/loki
  networks:
    - observability

promtail:
  image: grafana/promtail:3.0.0
  volumes:
    - /var/lib/docker/containers:/var/lib/docker/containers:ro
    - ./deploy/promtail/promtail.yml:/etc/promtail/config.yml:ro
  command: -config.file=/etc/promtail/config.yml
  networks:
    - observability
```

Grafana 中加 Loki 数据源，可按 `X-Request-Id` 关联请求链路。

## Phase 8 — 应用层优雅关闭

改动文件：`src/main.ts`、`deploy/docker-compose.yml`

### 8.1 确认 graceful shutdown

- `app.enableShutdownHooks()` 已有 ✓ — 确认 PrismaModule、BullMQ workers 都注册了 `OnModuleDestroy`（已验证）
  - `PrismaService` 实现 `OnModuleDestroy`，调用 `$disconnect()` ✓
  - `BullmqQueueFactory` 实现 `OnModuleDestroy`，关闭所有 worker 和 queue ✓

### 8.2 SSE 长连接优雅关闭

应用有两个 SSE 端点：

- `/api/v1/user/today-analysis/generate/stream`
- `/api/v1/user/assistant/messages/stream`

`enableShutdownHooks()` 会触发 `OnModuleDestroy`，但不会主动关闭正在进行的 SSE 连接。在 `stop_grace_period` 超时后这些连接会被 Docker 强制 SIGKILL。

改造 `src/main.ts`：

```typescript
// 保存 Express server 引用
const server = await app.listen(port, host);

// SIGTERM 时先关闭 HTTP server（拒绝新连接，等待已有连接结束）
process.on('SIGTERM', async () => {
  // 给 NestJS shutdown hooks 5 秒执行时间
  setTimeout(() => {
    server.close();
    process.exit(0);
  }, 5_000);
});
```

或者在 NestJS 中注册一个 `OnModuleDestroy` 的 service，向所有活跃 SSE response 发送 `error` 事件后 `end()`。

更简单的方案：依赖 `stop_grace_period: 30s` + Docker 的 SIGTERM → SIGKILL 序列，SSE 连接最多 30 秒后自然断开。对于个人健康管理助手场景，SSE 连接通常不超过 30 秒（AI 生成），这个超时足够。

**建议**：Phase 8 只需确认现有 `enableShutdownHooks()` 生效，`stop_grace_period: 30s` 足够覆盖 SSE 连接生命周期。如果后续有长连接场景再增加主动关闭逻辑。

### 8.3 Docker stop 配置

```yaml
app-blue:
  stop_grace_period: 30s
  stop_signal: SIGTERM
```

## 实施顺序

```
Week 1 (P0)
├── Phase 1: Dockerfile 重构 + .dockerignore 补充
├── Phase 2: Compose 网络隔离 + 资源限制 + 日志轮转
└── Phase 4: Nginx 安全头 + gzip + SSE 优化 + upstream 双 slot 配置（为 Phase 3 铺路）

Week 2 (P0)
├── Phase 3: Blue-Green 零停机部署 + 独立 migrate + 回滚（依赖 Phase 4 upstream 配置）
└── Phase 5: CI/CD 构建缓存 + 自动 smoke

Week 3 (P1)
├── Phase 6: Postgres 定时备份
├── Phase 7.1-7.2: Prometheus exporters + Grafana 告警
└── Phase 8: 优雅关闭确认

Week 4 (P2)
├── Phase 5.3: Staging 环境
├── Phase 6.2: PgBouncer（如果准备多实例）
└── Phase 7.3: Loki + Promtail
```

## 涉及文件清单

| 文件                                                     | 改动类型                                |
| -------------------------------------------------------- | --------------------------------------- |
| `Dockerfile`                                             | 重写                                    |
| `.dockerignore`                                          | 补充                                    |
| `docker-entrypoint.sh`                                   | 删除                                    |
| `deploy/docker-compose.yml`                              | 大改                                    |
| `deploy/deploy-server.ts`                                | 重写（blue-green + rollback）           |
| `deploy/nginx/nginx.conf`                                | 增强（upstream 动态配置、限速、安全头） |
| `deploy/prometheus/prometheus.yml`                       | 增加 exporter 抓取                      |
| `deploy/grafana/provisioning/alerting/`                  | 新建                                    |
| `deploy/grafana/dashboards/lucent-backend-overview.json` | 可能需更新指标引用                      |
| `deploy/post-deploy-smoke.ts`                            | 适配 blue-green 健康检查                |
| `.github/workflows/lucent-cd.yml`                        | 改造                                    |
| `.github/workflows/lucent-cd-staging.yml`                | 新建                                    |
| `docs/01-reference/deployment.md`                        | 同步更新                                |
| `src/main.ts`                                            | 确认 graceful shutdown                  |

## 不引入的依赖

| 候选            | 不引入原因                           |
| --------------- | ------------------------------------ |
| Kubernetes      | 单服务器规模不需要，compose 足够     |
| HashiCorp Vault | `.env.production` + 文件权限控制足够 |
| ELK Stack       | 太重，Loki + Promtail 足够           |
| Traefik / Caddy | Nginx 够用，无替换必要               |

## 完成标准

- [ ] 镜像构建时间 < 3 分钟（cache hit 场景）
- [ ] 镜像大小 < 500MB（含 AdminJS、LangChain、pdf-lib 等重型依赖，先实测再定最终目标）
- [ ] 部署零停机（blue-green 切换期间 Nginx 不返回 502，通过 `nginx -s reload` 热加载）
- [ ] 回滚可在 30 秒内完成
- [ ] Postgres 每日备份自动执行且可恢复
- [ ] Grafana 告警规则生效，webhook 可发送通知
- [ ] 所有容器以非 root 用户运行
- [ ] `docker compose ps` 中无端口暴露到宿主机（除 Nginx 80/443）
