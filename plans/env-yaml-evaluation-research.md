---
status: active
owner: backend
quadrant: plan
updated: 2026-08-24
---

# Lucent 配置迁移计划：.env → YAML + PaaS 部署适配

> 前身：环境变量迁移到 YAML 的评估报告（2026-08-22）。本文件在原评估结论基础上，
> 结合部署方向变更（自托管 PaaS + VictoriaMetrics 监控栈）改写为实施计划。
>
> 原评估中的 Docker Compose / Kubernetes 分析已退役，相关官方来源记录保留在
> `docs/03-archive/` 以供回溯。

## 背景与决策变更

原评估报告基于 Docker Compose + Nginx + Prometheus/Grafana/Alertmanager 自建部署体系。
经讨论，部署和监控方向发生以下变更：

- **部署**：从手写 `deploy.ts` + `compose.yml` + Nginx 切换到自托管 PaaS（Coolify）。
  Coolify 部署在 2C2G 管理服务器上，通过 SSH 远程管理 2C4G 应用服务器上的部署。
  Coolify 自带 Traefik 反向代理，接管 SSL 证书、路由和健康检查。
- **反向代理**：从 Nginx 换成 Traefik（Coolify 自带，自动安装到每台被管理的服务器）。
  接受能力降级：Nginx 的 `limit_conn` 并发连接限制在 Traefik 中无原生等价物，
  但 Lucent 应用层已有 ThrottlerModule 限流和 SseConnectionRegistry 连接管理，不构成实质风险。
- **监控**：从 Prometheus + Grafana + 多个 exporter 切换到 VictoriaMetrics 单机 + vmalert。
  VictoriaMetrics 部署在 2C4G 应用服务器上，localhost 抓取 `/metrics`，不走公网。
  详细方案见 `plans/observability-lightweight-research.md`。
- **部署流程**：PaaS 接管后，`deploy/deploy.ts`、`deploy/render-configs.sh`、
  `deploy/compose.yml`、`deploy/nginx/nginx.conf` 退役或由 PaaS 等价能力替代。

这些变更简化了配置边界——不再需要 Compose 插值、`render-configs.sh` 渲染、
`LUCENT_IMAGE` / `COMPOSE_PROJECT_NAME` 等部署状态变量。

## 计划目标

1. 非敏感运行时配置从扁平 `.env` 迁移到嵌套 YAML，获得分组和类型收益。
2. 敏感变量继续由 `.env` / PaaS 环境变量面板注入。
3. Prisma CLI 保持独立加载链，不依赖 Nest bootstrap 或 YAML。
4. 部署侧配置由 PaaS 管理，不再维护 `deploy.ts` / `render-configs.sh` / `compose.yml`。
5. 监控配置不再需要宿主机渲染脚本，VictoriaMetrics scrape 配置为静态文件。

## 不变的技术约束

以下约束来自 NestJS / Prisma / Node.js 官方行为，与部署方式无关：

- **Node.js 原生 dotenv 只处理 `.env` 键值文件**：YAML 必须由应用或额外库解析，
  不能直接作为 `--env-file` / `process.loadEnvFile()` 的输入。
- **NestJS 支持自定义配置工厂读取 YAML**：官方文档给出 `js-yaml` 解析 + `load` 配置的示例；
  Nest CLI 不会自动把非 TS 的 YAML 资产复制到 `dist`，需配置 `compilerOptions.assets`。
- **Prisma 官方链路是 dotenv / `process.env`**：`prisma.config.ts` 保持独立加载 `.env`，
  继续从 `process.env` 读取 `DATABASE_URL`，不依赖 Nest 或 YAML。
- **当前配置工厂直接读取 `process.env`**：仅把 YAML 加到 `ConfigModule.load` 不能保证
  现有工厂看到 YAML 值。必须在配置工厂执行前合并 YAML，或让工厂改为读取 Nest 配置对象。

## 当前仓库约束（一手资料）

以下约束基于仓库现状，不是外部资料推断：

- `prisma.config.ts` 遍历 `getDotenvLoadOrder()`，用 `dotenv.config({ path, override: true })`
  加载 `.env.<NODE_ENV>` 和 `.env.<NODE_ENV>.local`，然后读取 `process.env['DATABASE_URL']`。
- `src/config/env/env-file-paths.ts` 为 Nest 运行时返回 `.env.<NODE_ENV>.local`、`.env.<NODE_ENV>`；
  为 Prisma / 脚本返回 `.env.<NODE_ENV>`、`.env.<NODE_ENV>.local`。
- `src/app.module.ts` 使用 `ConfigModule.forRoot({ envFilePath, load: [...], validate })`。
  已有配置工厂（`src/config/app.config.ts`、`src/config/services/*.config.ts`）直接读取 `process.env`。
- `package.json` 当前有 `@nestjs/config`、`dotenv`、`prisma` 依赖，没有 `yaml` 或 `js-yaml` 依赖。
- `src/main.ts` 在 Nest 应用创建前读取 `TRUST_PROXY`；`src/tracing.ts` 在 Nest bootstrap 前
  决定是否启用 OTel。这些值不能只通过 Nest `load` 配置工厂提供。
- `Dockerfile` 生产镜像只显式复制 `dist`、Prisma 文件和 i18n 资产；新增 YAML 文件必须显式 COPY
  或配置 Nest assets。
- `src/config/env/environment.validation.ts` 中 Zod schema 已有大量 `.default()` 调用，
  这些代码级默认值是迁移期间的安全网。
- `src/config/constants.ts` 集中了所有默认值常量和上限值，Zod schema 引用它们。
- **退役中的部署文件**：`deploy/deploy.ts`、`deploy/render-configs.sh`、`deploy/compose.yml`、
  `deploy/nginx/nginx.conf` 在 PaaS 迁移后不再使用。其中的 `.env` 承载的
  `COMPOSE_PROJECT_NAME`、`LUCENT_IMAGE`、`GRAFANA_ADMIN_PASSWORD`、`WECOM_*` 等变量
  随之消失，不进入 YAML 迁移范围。

## YAML 文件存放位置：`Lucent/config/`

决定：YAML 文件放在 `Lucent/config/` 目录，不放项目根目录。

理由：

1. `src/config/` 是配置加载代码，`config/` 是配置数据——职责分离清晰。
2. `deploy/` 是部署基础设施配置（退役中），`config/` 是应用运行时配置——边界明确。
3. 项目根目录已有 `nest-cli.json`、`tsconfig.json`、`pnpm-workspace.yaml` 等构建配置文件，
   再加 YAML 配置文件容易混淆。
4. Dockerfile 中 `COPY config/ ./config/` 一行搞定；Nest CLI assets 配置 `"config/**/*.yaml"` 精确匹配。
5. 多环境 YAML 文件（`default.yaml`、`production.yaml`、`development.yaml`、`test.yaml`）
   在子目录中组织更清晰。

## 默认值策略：不需要 `.env.defaults`

决定：不创建 `.env.defaults` 文件。默认值通过两层提供：

1. **`config/default.yaml`**：非敏感配置的显式默认值，入库可审查，嵌套结构可读。
2. **Zod schema `.default()`**：代码级安全网，确保即使 YAML 缺失某键也能工作。

不创建 `.env.defaults` 的理由：

- 默认值出现在两个文件（`.env.defaults` 和 Zod schema `.default()`）中容易出现不一致。
- `.env.defaults` 是扁平键值，无法表达嵌套分组——与迁移到 YAML 的初衷矛盾。
- 敏感信息的默认值（如 `JWT_ACCESS_SECRET=dev_access_secret_change_me_min_32_chars`）
  容易被人直接使用，不应入库。

长期目标（第二阶段）：评估是否去掉 Zod schema 的 `.default()`，让 `default.yaml` 成为默认值的唯一来源。
这需要确保 YAML loader 在所有启动路径中都能被正确加载。

## 配置分类与归属

### 保留在 `.env` / PaaS 环境变量

- `DATABASE_URL`：Prisma CLI 直接需要。
- 数据库密码、Redis密码/URL、对象存储 secret、邮件密码、OAuth secret、推送密钥、AI API key。
- JWT secret、Admin 密码、Admin cookie secret、Better Auth secret。
- `METRICS_USER` / `METRICS_PASSWORD`：VictoriaMetrics scrape 认证。
- `TESTING_SHARED_SECRET`：测试支持。
- 任何会造成凭证泄露的值。

### 迁移到 `config/` YAML

- `HOST`、`PORT`、`CORS_ORIGIN`、`PUBLIC_BASE_URL`：非机密运行参数。
- `LOG_LEVEL`、`LOG_FORMAT`、`SLOW_REQUEST_THRESHOLD_MS`、`SLOW_QUERY_THRESHOLD_MS`：日志与可观测性参数。
- 队列并发、缓存 TTL、上传大小、模糊匹配阈值、餐食分析参数、验证码参数等数值参数。
- AI `BASE_URL` / `MODEL`（不含 API key）、OAuth redirect URI、COS/S3 endpoint / bucket / region。
- `MAIL_DRIVER`、`MAIL_HOST`、`MAIL_PORT`、`MAIL_FROM`：邮件非敏感配置。
- `STORAGE_PROVIDER`、`JPUSH_APNS_PRODUCTION`、`JPUSH_API_BASE_URL`：功能开关和公共 endpoint。
- `SUPPORT_EMAIL`、`MIN_CLIENT_VERSION`、`LATEST_VERSION`、`DOWNLOAD_URL`：客户端运营配置。
- `METRICS_ENABLED`：功能开关。

### 保留为环境变量（启动选择器）

以下变量在 Nest / OTel / Prisma 启动前读取，不能放入 YAML：

- `NODE_ENV`：决定加载哪个 `.env.<NODE_ENV>` 和 `config/<NODE_ENV>.yaml`。
- `OTEL_ENABLED`、`OTEL_EXPORTER_OTLP_ENDPOINT`：`src/tracing.ts` 在 Nest bootstrap 前读取。
- `TRUST_PROXY`：`src/main.ts` 在 Nest 应用创建前读取。
- `OPENAPI_EXPORT_SKIP_DB_CONNECT`：OpenAPI 导出脚本在 Nest 启动前使用。

### 不再需要的变量（PaaS / VictoriaMetrics 迁移后退役）

- `COMPOSE_PROJECT_NAME`、`LUCENT_IMAGE`：PaaS 管理镜像和部署。
- `GRAFANA_ADMIN_PASSWORD`：Grafana 退役。
- `WECOM_CORP_ID`、`WECOM_CORP_SECRET`、`WECOM_AGENT_ID`、`WECOM_TO_USER`：Alertmanager 退役，
  告警改由 vmalert + 其他通知方式。
- `WECOM_WEBHOOK_URL`：`deploy.ts` 退役，发布通知由 PaaS 或 CI/CD 处理。
- `COS_BUCKET`、`COS_REGION`、`COS_SECRET_ID`、`COS_SECRET_KEY`（备份专用）：
  `deploy/backup.sh` 退役后由 PaaS 备份方案替代。
- `POSTGRES_PASSWORD`、`REDIS_PASSWORD`：PaaS 管理数据库和 Redis 的连接信息，
  或由 `DATABASE_URL` / `REDIS_URL` 内含。

### 按当前变量的完整分类

| 类别                 | 变量示例                                                                                                                                                                                                                         | 迁移目标                         | 说明                                                   |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------ |
| 凭证 / 连接串        | `DATABASE_URL`、`REDIS_URL`、`JWT_*_SECRET`、`ADMIN_PASSWORD`、`ADMIN_COOKIE_SECRET`、`BETTER_AUTH_SECRET`、`MAIL_PASS`、OAuth `*_SECRET`、AI `*_API_KEY`、COS/S3 `*_SECRET_KEY`、`JPUSH_MASTER_SECRET`、`TESTING_SHARED_SECRET` | `.env` / PaaS 环境变量           | 连接串内含密码按敏感信息处理。                         |
| 普通运行参数         | `HOST`、`PORT`、`CORS_ORIGIN`、`PUBLIC_BASE_URL`、`LOG_LEVEL`、`LOG_FORMAT`、`SLOW_*_THRESHOLD_MS`、`METRICS_ENABLED`                                                                                                            | `config/default.yaml` + 环境覆盖 | 适合用数字、布尔值和命名空间表达。                     |
| 业务数值参数         | `MEAL_*`、`FUZZY_*`、`VERIFICATION_*`、`OAUTH_STATE_TTL_MS`、`MAIL_QUEUE_*`、`AI_EMBEDDING_DIMENSION`                                                                                                                            | `config/default.yaml`            | 当前 Zod schema 已有 `.default()`，YAML 成为显式声明。 |
| 公共第三方配置       | AI `BASE_URL` / `MODEL`、OAuth redirect URI、COS/S3 endpoint / bucket / region、`JPUSH_API_BASE_URL`、`MAIL_HOST` / `MAIL_PORT` / `MAIL_FROM`                                                                                    | `config/<env>.yaml`              | 非敏感但可能按环境不同。                               |
| 启动选择器           | `NODE_ENV`、`OTEL_ENABLED`、`OTEL_EXPORTER_OTLP_ENDPOINT`、`TRUST_PROXY`、`OPENAPI_EXPORT_SKIP_DB_CONNECT`                                                                                                                       | 环境变量（PaaS 面板注入）        | 在 Nest / OTel / Prisma 启动前读取，不能放入 YAML。    |
| 需结合判断的身份字段 | `ADMIN_EMAIL`、`METRICS_USER`、`MAIL_USER`、OAuth `*_APP_ID`                                                                                                                                                                     | 暂留 `.env` / PaaS 环境变量      | 非秘密但与认证/运维入口绑定，先不拆以减少迁移面。      |
| 退役变量             | `COMPOSE_PROJECT_NAME`、`LUCENT_IMAGE`、`GRAFANA_ADMIN_PASSWORD`、`WECOM_*`、`POSTGRES_PASSWORD`、`REDIS_PASSWORD`、备份用 `COS_*`                                                                                               | 删除                             | PaaS + VictoriaMetrics 迁移后不再需要。                |

## PaaS 与监控部署架构

### 服务器分配

两台服务器不处于内网，通过公网通信。Coolify（2C2G）通过 SSH 远程管理应用服务器（2C4G）。

```text
┌─────────────────────────────────────┐     ┌──────────────────────────────────────────┐
│  2C2G 机器（管理服务器）              │     │  2C4G 机器（应用服务器）                    │
│                                      │     │                                          │
│  Coolify UI (:3000)                  │     │  Traefik (:80/:443)                      │
│  Coolify 内置 PostgreSQL              │ SSH │  ├── Lucent app (:3000, /metrics)         │
│  Coolify 内置 Redis                   │◄───►│  ├── PostgreSQL (:5432)                  │
│  Coolify 内置 Soketi                  │     │  ├── Redis (:6379)                       │
│  Coolify 自带 Traefik                 │     │  ├── VictoriaMetrics (:8428, localhost)  │
│                                      │     │  │   └── scrape localhost:3000/metrics   │
│  通过 SSH 管理 2C4G 上的部署            │     │  └── vmalert (可选, localhost)           │
│  不跑任何应用                          │     │                                          │
│  不跑监控                             │     │  VMUI 通过 SSH 隧道访问                    │
└─────────────────────────────────────┘     └──────────────────────────────────────────┘
```

### 资源预算

| 机器 | 角色             | 组件                                                             | 预估 RAM    | 剩余    |
| ---- | ---------------- | ---------------------------------------------------------------- | ----------- | ------- |
| 2C2G | Coolify 管理节点 | Coolify 全套（UI + 内置 PG/Redis/Soketi + Traefik）+ OS + Docker | ~800–900 MB | ~1.1 GB |
| 2C4G | 应用 + 监控      | Lucent app + PostgreSQL + Redis + VictoriaMetrics + Traefik + OS | ~1.3–1.5 GB | ~2.5 GB |

### 为什么 VictoriaMetrics 放在应用服务器（2C4G）

1. **安全性**：VictoriaMetrics 通过 localhost 抓取 `/metrics`，不走公网。`/metrics` 端点
   不暴露到公网，Basic Auth 只是防御纵深而非唯一防线。
2. **简单性**：不需要在 Traefik 上为 `/metrics` 开放公网路由。当前 Nginx 配置中 `/metrics`
   被 `return 403` 拦截——Traefik 迁移后保留这一安全策略。
3. **可靠性**：scrape 不依赖公网连通性。如果公网断了，仍可通过 SSH 隧道访问 VMUI 查看本地指标。
4. **资源充裕**：2C4G 跑全栈 + VictoriaMetrics 约需 1.5 GB，4 GB 绰绰有余。

VMUI 访问方式：通过 SSH 隧道，和当前 Prometheus/Grafana 的访问方式一致：

```bash
ssh -L 8428:127.0.0.1:8428 user@2c4g-server
# 然后浏览器访问 http://localhost:8428
```

### 为什么选 Coolify 而非 Dokploy

在分机部署场景下，2C2G 独占 PaaS 管理节点，资源充裕（剩余约 1.1 GB），
Coolify 的内置组件额外占用（约 200–300 MB）不构成问题。Coolify 的优势：

1. **更成熟**：49.8 万自托管实例，社区更大，遇到问题更容易找到解答。
2. **Caddy 选项**：支持 Traefik 或 Caddy 作为反向代理（当前选择 Traefik 以保持与 Nginx 能力对齐）。
3. **内置数据库备份**：备份到 S3 功能更完善，替代 `deploy/backup.sh`。
4. **Pull Request Deployments**：支持 PR 级别预览部署，对后续开发有用。
5. **Server Automations**：连接新服务器后自动完成初始化设置，包括自动安装 Traefik。
6. **文档更完善**：knowledge base 和 troubleshooting 文档覆盖更广。

### 构建策略

不在任何一台服务器上构建。在本地或 CI（GitHub Actions）构建镜像推到 registry
（GitHub Container Registry 免费），Coolify 只负责拉取和部署。
这样 2C4G 的 4 GB RAM 全部用于运行时，不用担心构建峰值导致 OOM。

### Nginx → Traefik 能力降级评估

| Nginx 能力                                 | Traefik 替代                                          | 降级影响                                                            |
| ------------------------------------------ | ----------------------------------------------------- | ------------------------------------------------------------------- |
| `limit_req_zone` 速率限制 (20r/s burst=40) | Traefik 速率限制中间件                                | Lucent 已有 ThrottlerModule 应用层限流，Traefik 层可选              |
| `limit_conn_zone` 并发连接限制 (50)        | Traefik 无原生等价物                                  | **降级**，但 Lucent SSE 有 SseConnectionRegistry 连接管理，影响可控 |
| SSE 专用 location（`proxy_buffering off`） | Traefik 对 SSE/WebSocket 原生支持，自动禁用 buffering | 无降级                                                              |
| 安全 headers (HSTS, X-Frame-Options 等)    | Traefik headers 中间件                                | 无降级                                                              |
| Gzip                                       | Traefik compress 中间件                               | 无降级                                                              |
| `/metrics` 返回 403                        | Traefik 路由规则拒绝特定 path                         | 无降级                                                              |
| HTTP → HTTPS 301                           | Traefik 自动处理                                      | 无降级                                                              |
| `client_max_body_size 20m`                 | Traefik `maxBodyBytes` 选项                           | 无降级                                                              |

**结论**：唯一降级点是并发连接限制（`limit_conn`），但应用层的 ThrottlerModule
和 SseConnectionRegistry 已覆盖核心场景。可以接受。

## 目标架构

### 文件布局

```text
Lucent/
├── config/
│   ├── default.yaml              # 入库，非敏感默认值
│   ├── development.yaml          # 入库，开发环境普通参数覆盖
│   ├── test.yaml                 # 入库，测试环境普通参数覆盖
│   ├── production.yaml           # 入库，生产环境普通参数覆盖
│   └── *.local.yaml              # gitignored，本机覆盖
├── .env.development              # gitignored，开发环境敏感值
├── .env.development.example      # 入库，开发环境模板
├── .env.production               # gitignored，生产环境敏感值
├── .env.production.example       # 入库，生产环境模板
├── .env.test                     # gitignored，测试环境敏感值
├── .env.test.example             # 入库，测试环境模板
└── src/config/                   # 配置加载代码（不变）
```

### 配置优先级

```text
PaaS 运行时环境变量 > .env.<env>.local > .env.<env>（仅敏感/启动变量）
> config/<env>.local.yaml > config/<env>.yaml > config/default.yaml > Zod schema .default()
```

`.env` 与 YAML 应尽量没有同名键。若同名键出现，启动时应报冲突警告，而不是静默覆盖。

### PaaS 配置注入模型

Coolify 通过环境变量面板或 `.env` 文件向容器注入环境变量。
Coolify 通过 SSH 远程管理 2C4G 应用服务器，自动在该服务器上安装 Traefik。
应用的配置链变为：

```text
镜像内置 config/*.yaml          → 非敏感默认值（随镜像发布，可审查）
Coolify 环境变量面板             → 敏感值 + 平台覆盖值（通过 SSH 注入到远程容器）
process.env（Coolify 运行时）    → 最高优先级覆盖
```

关键变化：

1. 不再有 Compose 插值、`env_file` 或 `render-configs.sh` 渲染。
2. Coolify 自带 Traefik 接管反向代理和 SSL 证书——`deploy/nginx/nginx.conf` 退役。
3. Coolify 接管部署/回滚/健康检查——`deploy/deploy.ts` 退役。
4. VictoriaMetrics 在 2C4G 上 localhost 抓取 `/metrics`，scrape 配置为静态 YAML 文件（不含密钥），无需宿主机渲染。
   认证通过 Coolify 环境变量面板注入 `METRICS_USER` / `METRICS_PASSWORD`。

## 实施步骤

### Phase 1：YAML loader 与基础架构

1. **引入 YAML 解析依赖**：`pnpm add yaml`（选择 `yaml` 库而非 `js-yaml`，API 更现代）。

2. **创建 `config/` 目录和 `default.yaml`**：将 `src/config/constants.ts` 中的默认值
   和 `.env.*.example` 中的非敏感默认值迁移到嵌套 YAML 结构。

   YAML 命名空间设计（示例）：

   ```yaml
   app:
     host: 0.0.0.0
     port: 3000
     corsOrigin: ''
     publicBaseUrl: 'http://localhost:3000'
   log:
     level: debug
     format: pretty
     slowRequestThresholdMs: 2000
     slowQueryThresholdMs: 500
   mail:
     driver: log
     host: 'smtp.example.com'
     port: 587
     from: 'noreply@example.com'
     queue:
       maxAttempts: 3
       backoffDelayMs: 5000
       workerConcurrency: 3
       # ...
   fuzzy:
     acceptScore: 0.7
     minLead: 0.1
     queryPrefixLength: 1
   meal:
     defaultPortionGrams: 100
     # ...
   ```

3. **创建环境特定 YAML**：`config/development.yaml`、`config/test.yaml`、`config/production.yaml`，
   只包含与环境不同的覆盖值。

4. **实现 YAML loader 模块**：在 `src/config/` 下创建一个不依赖 Nest 的纯配置读取模块：
   - 按 `NODE_ENV` 选择 `config/default.yaml` + `config/<NODE_ENV>.yaml` + `config/<NODE_ENV>.local.yaml`。
   - 使用 `yaml` 库解析。
   - 合并三个层次的 YAML（deep merge）。
   - 对 YAML 做启动期 schema 校验和类型转换。
   - 合并敏感 `.env` / `process.env` 值。
   - 输出一个嵌套配置对象供 Nest `ConfigModule` 使用。

5. **修改 Nest `ConfigModule`**：`app.module.ts` 的 `ConfigModule.forRoot()` 改为加载 YAML loader
   产出的嵌套配置。`ignoreEnvFile: false` 仍保留，用于加载敏感 `.env` 文件。

6. **修改配置工厂**：`src/config/app.config.ts`、`src/config/services/*.config.ts` 从
   直接读取 `process.env` 改为读取 Nest `ConfigService` 的嵌套配置对象。
   - 迁移期间可短暂把 YAML 值映射为兼容旧代码的扁平键，但这只是过渡层。
   - 长期把所有 YAML flatten 回 `process.env` 会重新制造扁平耦合，应避免。

7. **更新 Zod schema**：`environment.validation.ts` 中的 `validate` 函数改为接收合并后的
   配置对象（YAML + env），而非只接收 `process.env`。保留 `.default()` 作为安全网。

8. **配置 Nest CLI assets**：在 `nest-cli.json` 的 `compilerOptions.assets` 中添加
   `"config/**/*.yaml"`，确保 YAML 文件被复制到 `dist/`。

9. **更新 Dockerfile**：在 production stage 添加 `COPY config/ ./config/`。

### Phase 2：`.env` 精简

1. **精简 `.env.*.example` 文件**：移除已迁移到 YAML 的非敏感变量，只保留敏感变量和启动选择器。
   - `.env.development.example`：只留 `DATABASE_URL`、`REDIS_URL`、JWT secret、Admin 密码、
     AI API key、OAuth secret、COS/S3 secret key、`NODE_ENV` 等。
   - `.env.production.example`：同上，增加 `METRICS_USER` / `METRICS_PASSWORD`。
   - `.env.test.example`：只留 `DATABASE_URL`、`REDIS_URL`、`TESTING_SHARED_SECRET` 等。

2. **更新 `env-keys.enum.ts`**：保留所有枚举值（兼容期需要），但标注哪些已迁移到 YAML。
   后续 Phase 3 中移除已退役的枚举值。

3. **更新 `env-file-paths.ts`**：Nest 和 Prisma 的 `.env` 文件路径逻辑不变，
   但 `.env` 文件内容变薄。

### Phase 3：部署侧迁移

1. **部署 Coolify 到 2C2G 管理服务器**：
   - `curl -fsSL https://cdn.coollabs.io/coolify/install.sh | sudo bash`
   - 创建管理员账户，配置域名和 HTTPS。
   - 通过 Coolify 面板添加 2C4G 为远程服务器（SSH 连接），Coolify 自动安装 Traefik。

2. **配置 CI 构建流程**：
   - 在 GitHub Actions 中构建 Docker 镜像，推到 GitHub Container Registry。
   - Coolify 配置为从 registry 拉取镜像部署，不在服务器上构建。

3. **迁移部署配置**：将 `deploy/compose.yml` 中保留的基础设施（postgres、redis）迁移到
   Coolify 管理的数据库服务或独立 Docker Compose。应用容器由 Coolify 直接管理。

4. **退役旧部署文件**：
   - `deploy/deploy.ts`：Coolify 接管部署流程。
   - `deploy/render-configs.sh`：监控配置不再需要渲染。
   - `deploy/compose.yml`：拆分为基础设施 Compose 或由 Coolify 管理。
   - `deploy/nginx/nginx.conf`：Coolify 自带 Traefik 替代。
   - `deploy/prometheus/`、`deploy/grafana/`、`deploy/alertmanager/`：由 VictoriaMetrics 替代。
   - `deploy/backup.sh`：由 Coolify 内置数据库备份到 S3 替代。

5. **在 2C4G 上部署 VictoriaMetrics**：按 `plans/observability-lightweight-research.md` 的推荐 1 执行：
   - 部署 VictoriaMetrics 单机，绑定 `127.0.0.1:8428`。
   - scrape 配置为静态 YAML 文件，targets 指向 `localhost:3000`（Lucent app）
     和可选的 `localhost:9100`（node-exporter）。
   - 保留 `node-exporter`（可选）。
   - 需要告警时添加 `vmalert`（同样绑定 localhost）。
   - 应用 `/metrics` 和 `prom-client` 不改。
   - VMUI 通过 SSH 隧道访问：`ssh -L 8428:127.0.0.1:8428 user@2c4g-server`。

6. **配置 Traefik 中间件**（在 Coolify 面板中配置，替代 Nginx 能力）：
   - 安全 headers 中间件（HSTS、X-Frame-Options、X-Content-Type-Options 等）。
   - compress 中间件（Gzip）。
   - `/metrics` 路径拒绝规则（返回 403）。
   - SSE 路由保持默认（Traefik 原生支持 SSE/WebSocket）。
   - `maxBodyBytes` 限制为 20m。
   - HTTP → HTTPS 自动重定向（Coolify/Traefik 默认）。

7. **确认 DB snapshot / rollback 替代方案**：
   - Coolify 是否提供部署前数据库快照。
   - Coolify 的回滚能力是否足够（镜像级回滚 vs schema 回退）。
   - 如不足，编写轻量级 pre-deploy hook 脚本。

### Phase 4：清理与验证

1. **移除退役变量**：从 `env-keys.enum.ts`、`environment.validation.ts`、
   `.env.*.example` 中删除 `COMPOSE_PROJECT_NAME`、`LUCENT_IMAGE`、`GRAFANA_ADMIN_PASSWORD`、
   `WECOM_*` 等已退役变量。

2. **更新文档**：
   - `docs/01-reference/environment.md`：更新配置来源说明。
   - `docs/01-reference/deployment.md`：改为 PaaS 部署流程。
   - `Lucent/AGENTS.md`：如有部署相关命令则更新。
   - 当日迁移日志。

3. **全量验证**：执行下方验证矩阵。

## 验证矩阵

### YAML 加载与优先级

- [ ] 仅提供 `config/default.yaml` + 必需敏感 `.env`：Nest 启动成功，普通配置类型正确，Prisma 连接成功。
- [ ] `config/<env>.yaml` 覆盖 `config/default.yaml` 中的值：结果符合预期。
- [ ] `config/<env>.local.yaml` 覆盖 `config/<env>.yaml` 中的值：结果符合预期。
- [ ] 普通 YAML 缺失、字段类型错误：启动失败且错误指向明确。
- [ ] 必填敏感变量缺失：启动失败且错误指向明确。
- [ ] PaaS 环境变量覆盖 YAML 同名配置：PaaS 注入值优先。
- [ ] `.env` 与 YAML 同名键同时存在：启动时报冲突警告。

### Prisma 独立性

- [ ] `NODE_ENV=test` 下运行 `prisma migrate deploy / generate / validate`：
      Prisma 仍加载正确的 `.env.test*`，不依赖应用 YAML。
- [ ] `prisma.config.ts` 不 import Nest 或 YAML loader。

### 构建与镜像

- [ ] `pnpm build` 后 `dist/config/` 目录存在且包含所有 YAML 文件。
- [ ] 从 `dist` 启动（模拟生产镜像）：YAML 资产路径正确，应用正常启动。
- [ ] Dockerfile production stage 中 `COPY config/ ./config/` 生效。

### Coolify 部署

- [ ] Coolify 在 2C2G 上安装成功，管理面板可访问。
- [ ] 2C4G 通过 SSH 添加为 Coolify 远程服务器，Traefik 自动安装。
- [ ] Coolify 从 registry 拉取镜像部署成功（不在服务器上构建）。
- [ ] Coolify 环境变量面板中的敏感值正确注入容器 `process.env`。
- [ ] Coolify 健康检查通过（`GET /api/v1/health`）。
- [ ] Coolify 回滚功能验证。
- [ ] Coolify SSL 证书自动管理验证。
- [ ] Traefik 安全 headers 中间件生效。
- [ ] Traefik `/metrics` 路径返回 403。
- [ ] Traefik SSE 路由正常工作（`proxy_buffering` 自动禁用）。
- [ ] Traefik `maxBodyBytes` 限制生效。
- [ ] VMUI 通过 SSH 隧道可访问（`ssh -L 8428:127.0.0.1:8428`）。

### 监控栈（VictoriaMetrics 在 2C4G localhost）

- [ ] VictoriaMetrics 单机成功在 localhost 抓取应用 `/metrics`。
- [ ] `METRICS_USER` / `METRICS_PASSWORD` 认证生效。
- [ ] VMUI 可查询核心指标（应用 up、5xx、延迟、BullMQ、event loop）。
- [ ] `vmalert` 规则触发正确（如启用）。
- [ ] VictoriaMetrics 只绑定 `127.0.0.1:8428`，不暴露到公网。
- [ ] VMUI 通过 SSH 隧道访问成功。
- [ ] 旧 Prometheus / Grafana / exporter 容器已停止且不影响应用。

### 旧文件退役

- [ ] `deploy/deploy.ts` 不再被调用。
- [ ] `deploy/render-configs.sh` 不再被调用。
- [ ] `deploy/compose.yml` 已拆分或删除。
- [ ] `deploy/nginx/nginx.conf` 已删除。
- [ ] `deploy/backup.sh` 已由 Coolify 内置备份替代。
- [ ] `deploy/prometheus/`、`deploy/grafana/`、`deploy/alertmanager/` 已删除。
- [ ] 退役变量从代码和 `.env.*.example` 中清除。

## 风险与回退

- **YAML loader bug 导致启动失败**：回退方式是 `ConfigModule` 回到直接读取 `process.env`，
  YAML 文件不影响 `.env` 中的值。迁移期间 `.env` 仍保留所有变量作为安全网。
- **Coolify 不满足需求**：若 Coolify 不满足，可回退到 Dokploy（资源占用更低，适合同机部署），
  或回退到精简后的 Compose 部署（移除监控栈但保留应用 + postgres + redis + Traefik）。
- **Traefik 并发连接限制缺失**：Nginx 的 `limit_conn` 在 Traefik 中无原生等价物。
  缓解方式：Lucent 的 ThrottlerModule 提供应用层限流，SseConnectionRegistry 管理 SSE 连接数。
  如需 Transport 层并发限制，可考虑在 Traefik 前面加一层 Cloudflare 或用 Traefik 的
  RateLimit 中间件近似（按请求速率而非并发连接数）。
- **VictoriaMetrics 兼容性问题**：`prom-client` 的 Prometheus exposition format 是标准合同，
  VictoriaMetrics 兼容此格式。风险低；回退方式是恢复精简后的 Prometheus 单机。
- **DB snapshot 缺失**：Coolify 迁移期间可能缺少 pre-deploy 数据库快照。缓解方式是
  在 Coolify 部署前手动执行 `pg_dump`，或编写独立快照脚本。
- **公网通信安全**：两台服务器不在内网，Coolify 到 2C4G 的 SSH 连接走公网。
  确保 SSH 使用密钥认证、禁用密码登录、限制端口暴露。VictoriaMetrics 不走公网（localhost），
  不受此风险影响。
