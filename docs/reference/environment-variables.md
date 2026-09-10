---
status: active
owner: backend
quadrant: reference
updated: 2026-09-09
---

# Environment Variables

本文件是环境变量完整参考(唯一事实源);本地环境与运行时基线也在此文件。
所有运行时配置统一通过环境变量管理,敏感值在 `.env.*` 文件中,非敏感值附带默认值。

## 配置加载方式

Env 文件仅本地使用、不入库(`.env.development|production|test` 及对应 `.local` 覆盖);
模板为 `.env.development.example` / `.env.test.example` / `.env.production.example`。
加载优先级从高到低:`.env.<NODE_ENV>.local` → `.env.<NODE_ENV>`,没有根 `.env` 回退;
运行时、Prisma CLI 与药品导入脚本共用同一解析顺序(`src/config/env/env-file-paths.ts`)。

**全部配置均从环境变量读取**,非敏感默认值统一定义在 zod 校验层
(`src/config/env/environment.validation.ts` 的 `.default()`);敏感值
(API key、数据库 URL、secret)经 `.env.*` 注入。
业务代码统一通过 `configService.get(EnvKey.X)` 读取(启动早期引导代码除外),
未设置的键自动使用 zod 校验层定义的默认值,无需额外配置文件。

## 本地开发基线

- Development DB:`postgres/postgres@127.0.0.1:15432/lucent`;Test/e2e DB:
  `lucent/lucent_dev@127.0.0.1:5432/lucent`;Redis:`redis://127.0.0.1:6379`
- Global prefix `/api`,URI 版本默认 `1`;管理面板 `GET /admin`
- 健康探针:`GET /api/v1/health`(readiness 别名,关键依赖不可用返回 503)、
  `/api/v1/health/live`(纯进程存活)、`/api/v1/health/ready`、`/api/v1/health/deep`(诊断)
- 启动顺序:`pnpm dev:stack` → `pnpm db:migrate` → `pnpm start:dev`
- `pnpm dev:stack`(`compose.dev.yaml`)以 `pgvector/pgvector:pg18` 启动
  postgres-dev / postgres-test——Assistant RAG 的向量索引与查询依赖
  `CREATE EXTENSION vector`;同时启动 SeaweedFS(dev-only S3 兼容存储,S3 API 端口 8333、
  Filer 端口 8888,`STORAGE_PROVIDER=s3` 启用)与 Jaeger UI(OTLP 4318)。若本地卷由旧版
  纯 Postgres 镜像创建,重建 dev/test 卷即可补齐扩展二进制

## 常用脚本

- `pnpm check` — 一键校验:lint、format、typecheck、build、单测、e2e
- `pnpm typecheck` / `typecheck:tools` — 全量 TS 检查(`src/`、spec、`test/`;`scripts/` 助手)
- `pnpm start:dev` / `start:test:dev` / `start:prod` — development / test / production 运行时
- `pnpm test` / `test:ci` / `test:e2e` — 单测、eslint-plugins 测试与 e2e(CI 变体串行执行)
- `pnpm test:runtime:start` / `test:runtime:stop` — 全栈 lane 的 test 运行时启动/停止
- `pnpm export:openapi` — build 后导出 `docs/reference/generated/openapi.json`(生成物,禁手改)
- `pnpm dev:stack:down` / `dev:stack:reset` — 停止 / 重建本地 Docker dev 栈
- `pnpm db:reset:dev` / `db:reset:test` — 重置对应数据库(`prisma migrate reset --force`)
- `pnpm import:medicine:all` — 药品知识库默认导入序列(数据源细节见模块 README 与导入脚本)
- 部署见 [deployment.md](deployment.md) 与 [../howto/deploy.md](../howto/deploy.md):
  production 走 Coolify + 仓库 compose + 镜像;staging 走宿主原生 PM2 + 自建 Traefik
  (推送即部署,无发布脚本)
- 非 development 目标的 Prisma 命令须显式指定 NODE_ENV,例如
  `NODE_ENV=test pnpm exec prisma migrate deploy`

## Required Production Variables

Lucent app runtime in production requires:

```text
DATABASE_URL
REDIS_URL
JWT_ACCESS_SECRET
JWT_REFRESH_SECRET
BETTER_AUTH_SECRET
ADMIN_EMAIL
ADMIN_PASSWORD
ADMIN_COOKIE_SECRET
METRICS_USER
METRICS_PASSWORD
```

生产(Coolify compose)下 `DATABASE_URL` / `REDIS_URL` 由 `compose.yaml`
按 `POSTGRES_PASSWORD` / `REDIS_PASSWORD` 拼接注入,不需要单独填写。

**staging(原生 PM2)**下这两个值写在服务器上仓库根 `.env.production` 里,指向回环
(`127.0.0.1`)——容器端口只绑 `127.0.0.1`。同一份文件也被
`docker compose -f compose.staging.yaml --env-file .env.production` 读取做插值,
所以 `DATABASE_URL` / `REDIS_URL` 里内嵌的密码必须与 `POSTGRES_PASSWORD` /
`REDIS_PASSWORD` 一致(改密码要改两处);`TRUST_PROXY=true` 与
`VICTORIALOGS_URL=http://127.0.0.1:9428/insert/jsonline` 也是 staging 必填项。

非敏感运行时参数(host/port/日志级别/阈值/各业务开关)均通过环境变量配置,未设置时使用
代码内默认值(见下文各节);全部可覆盖项见 `.env.production.example` 注释。

`METRICS_USER` and `METRICS_PASSWORD` protect the `/metrics` Prometheus endpoint
with HTTP Basic Auth. Both must be set together; if either is missing, `/metrics`
is served without authentication (not recommended for production). VictoriaMetrics
scrape config (`monitoring/victoriametrics/vmscraper.yml`)用 `%{METRICS_USER}` /
`%{METRICS_PASSWORD}` 占位符从容器环境变量注入同名凭据。

GitHub Actions CD 只为 production 构建并推送镜像到 Docker Hub(仓库级 secrets):

```text
DOCKERHUB_USERNAME
DOCKERHUB_TOKEN
```

staging 不再使用镜像:它的发布 secrets 是 `STAGING_SSH_HOST` / `STAGING_SSH_USER` /
`STAGING_SSH_KEY`(可选 `STAGING_SSH_PORT`、`STAGING_SSH_KNOWN_HOSTS`),变量
`STAGING_API_HOST` 用于发布后的公共健康检查(见 environment `staging`)。

`CORS_ORIGIN` may be left empty for App-only production deployments with no browser cross-origin
traffic. If you do expose browser clients from another origin, set it explicitly.

JWT, Better Auth and admin secrets are required in every runtime now; keep them in the env
files, not in code defaults. The checked-in dev/test templates already provide
local values.

## Better Auth

```text
BETTER_AUTH_SECRET
BETTER_AUTH_URL
```

- `BETTER_AUTH_SECRET` — signing secret for Better Auth sessions and tokens. Must be at least 32
  characters; treat it as a sensitive credential. Required in all runtimes once Better Auth is wired
  into the runtime (Task 2 onwards); startup validation fails if missing.
- `BETTER_AUTH_URL` — public base URL used by Better Auth to build callback and verification links.
  Defaults to `http://localhost:3000` when unset.

These variables are introduced by the Better Auth migration. Password reset uses the product-level
verification code instead of Better Auth email links, so no email-callback URL is required.

## Optional Integrations

WeChat OAuth:

```text
WECHAT_WEB_APP_ID
WECHAT_WEB_APP_SECRET
WECHAT_WEB_REDIRECT_URI
WECHAT_MOBILE_APP_ID
WECHAT_MOBILE_APP_SECRET
```

QQ OAuth:

```text
QQ_APP_ID
QQ_APP_SECRET
QQ_REDIRECT_URI
```

Weibo OAuth:

```text
WEIBO_APP_ID
WEIBO_APP_SECRET
WEIBO_REDIRECT_URI
```

Google OAuth:

```text
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI
```

All OAuth provider variables are optional. When unset, the provider logs a warning
at startup but does not block application launch. QQ, Weibo, and Google each use
the standard OAuth 2.0 authorization-code flow; WeChat additionally supports a
mobile SDK path.

JPush notification delivery:

```text
JPUSH_APP_KEY
JPUSH_MASTER_SECRET
JPUSH_APNS_PRODUCTION
JPUSH_API_BASE_URL
```

All four variables are optional. `JPUSH_APP_KEY` and `JPUSH_MASTER_SECRET` must be
configured as a pair: if both are empty, push delivery stays silently disabled
(production logs a startup `warn`); setting only one of the pair fails startup —
the pair must always be set together. `JPUSH_APNS_PRODUCTION` accepts `true` or
`false` and defaults to `false`; `JPUSH_API_BASE_URL` defaults to `https://api.jpush.cn`.
The Master Secret is sensitive and must not be committed.

**0.1.0 发布门槛**：生产环境必须配齐 `JPUSH_APP_KEY` / `JPUSH_MASTER_SECRET`（经
Coolify/生产环境变量注入）并完成真机验证。缺失时服务静默禁用推送并在启动日志
`warn`;最低上线检查见 [deployment.md](deployment.md)。

Daily-record image uploads through object storage (Tencent COS or S3):

```text
TENCENT_COS_SECRET_ID
TENCENT_COS_SECRET_KEY
TENCENT_COS_BUCKET
TENCENT_COS_REGION
TENCENT_COS_PUBLIC_BASE_URL
TENCENT_COS_UPLOAD_EXPIRES_SECONDS
TENCENT_COS_MAX_UPLOAD_BYTES
TENCENT_COS_DOWNLOAD_EXPIRES_SECONDS
```

`TENCENT_COS_REGION` may keep its default template value alone. COS is treated as truly configured
only after at least one of `TENCENT_COS_SECRET_ID`, `TENCENT_COS_SECRET_KEY`, or
`TENCENT_COS_BUCKET` is set; from that point, all of `TENCENT_COS_SECRET_ID`,
`TENCENT_COS_SECRET_KEY`, `TENCENT_COS_BUCKET`, and `TENCENT_COS_REGION` must be set together.

Aliyun OSS dedicated SDK (provider: `ali-oss`) — set `STORAGE_PROVIDER=ali-oss` to use:

```text
STORAGE_PROVIDER=ali-oss
ALIYUN_OSS_ACCESS_KEY_ID
ALIYUN_OSS_ACCESS_KEY_SECRET
ALIYUN_OSS_BUCKET
ALIYUN_OSS_REGION
ALIYUN_OSS_ENDPOINT            # optional; defaults to the region's standard endpoint
ALIYUN_OSS_PUBLIC_BASE_URL
ALIYUN_OSS_UPLOAD_EXPIRES_SECONDS
ALIYUN_OSS_MAX_UPLOAD_BYTES
ALIYUN_OSS_DOWNLOAD_EXPIRES_SECONDS
```

`ALIYUN_OSS_REGION` defaults to `oss-cn-hangzhou`; `ALIYUN_OSS_ENDPOINT` is optional and, when
set, overrides the region-derived endpoint (use for custom domains / VPC). OSS is treated as
truly configured only after `ALIYUN_OSS_ACCESS_KEY_ID`, `ALIYUN_OSS_ACCESS_KEY_SECRET`, and
`ALIYUN_OSS_BUCKET` are all set. Like COS, OSS signed URLs are not audience-specific: the
external audience (e.g. meal-analysis vision model) receives the same URL as the client.

S3-compatible object storage (dev: SeaweedFS / staging: 七牛云 Kodo S3 兼容) — set `STORAGE_PROVIDER=s3` to use:

```text
STORAGE_PROVIDER=s3
STORAGE_S3_ENDPOINT
STORAGE_S3_CLIENT_ENDPOINT
STORAGE_S3_EXTERNAL_ENDPOINT
STORAGE_S3_PUBLIC_BASE_URL
STORAGE_S3_ACCESS_KEY
STORAGE_S3_SECRET_KEY
STORAGE_S3_BUCKET
STORAGE_S3_REGION
STORAGE_S3_UPLOAD_EXPIRES_SECONDS
STORAGE_S3_MAX_UPLOAD_BYTES
STORAGE_S3_DOWNLOAD_EXPIRES_SECONDS
```

`STORAGE_PROVIDER` defaults to `s3`; when set to `s3`, all of `STORAGE_S3_ENDPOINT`,
`STORAGE_S3_ACCESS_KEY`, `STORAGE_S3_SECRET_KEY`, and `STORAGE_S3_BUCKET` must be set together.
`STORAGE_S3_CLIENT_ENDPOINT` defaults to `STORAGE_S3_ENDPOINT` when empty.
`STORAGE_S3_EXTERNAL_ENDPOINT` is optional; when absent, requests for external-audience URLs
(e.g. meal-analysis vision model) will fail with a clear configuration error.

七牛云 Kodo 走 S3 兼容接口时，endpoint 格式为 `https://s3.<region>.qiniucs.com`（如
`cn-east-1` → `https://s3.cn-east-1.qiniucs.com`），`region` 字段对应七牛区域 ID
（`cn-east-1` / `cn-north-1` 等）。七牛原生 SDK 不支持 presigned PUT URL（其上传模型
是 uploadToken + 表单 POST），但 S3 兼容层支持 presigned PUT，与现有客户端直传契约兼容。

Mail:

```text
MAIL_DRIVER
MAIL_HOST
MAIL_PORT
MAIL_FROM
MAIL_USER
MAIL_PASS
```

AI provider configuration:

```text
AI_PROVIDER
AI_ANALYSIS_API_KEY
AI_ANALYSIS_BASE_URL
AI_ANALYSIS_MODEL
AI_VISION_API_KEY
AI_VISION_BASE_URL
AI_VISION_MODEL
AI_LANGUAGE_API_KEY
AI_LANGUAGE_BASE_URL
AI_LANGUAGE_MODEL
AI_CHAT_API_KEY
AI_CHAT_BASE_URL
AI_CHAT_MODEL
AI_CHAT_COMPRESSION_API_KEY
AI_CHAT_COMPRESSION_BASE_URL
AI_CHAT_COMPRESSION_MODEL
AI_EMBEDDING_API_KEY
AI_EMBEDDING_BASE_URL
AI_EMBEDDING_MODEL
```

AI safety configuration (optional):

```text
AI_SAFETY_FORBIDDEN_PATTERNS
```

- Comma- or newline-separated regex strings used by `LlmSafetyPolicyService`.
- If unset or empty, a hardcoded medical-advice baseline is used.
- Example: `AI_SAFETY_FORBIDDEN_PATTERNS=诊断,确诊,停药,\bprescription\b`

`AI_PROVIDER` currently supports only `openai-compatible`.

Each role is independent. If a role is configured, that role must provide all of
`BASE_URL`, `API_KEY`, and `MODEL`. Partial role configuration is rejected at startup.

DeepSeek compatibility note:

- When an AI role points to `https://api.deepseek.com`, Lucent now disables DeepSeek `thinking`
  mode for LangChain OpenAI-compatible chat runtime creation. This prevents Today/Report streaming
  tool-use requests from failing on `tool_choice`.

Recommended role split:

- `AI_ANALYSIS_MODEL`: 今日分析、周报、月报等长文本分析生成
- `AI_VISION_MODEL`: 食物图片识别、睡眠检测截图理解等视觉入口
- `AI_LANGUAGE_MODEL`: 自然语言记一笔、口语化结构提取
- `AI_CHAT_MODEL`: 轻聊天页的主对话模型
- `AI_CHAT_COMPRESSION_MODEL`: 长对话摘要、压缩历史上下文的低成本模型
- `AI_EMBEDDING_MODEL`: RAG 检索向量化、知识库分片索引和查询向量生成

Observability:

```text
LOG_LEVEL
SLOW_REQUEST_THRESHOLD_MS
METRICS_ENABLED
METRICS_USER
METRICS_PASSWORD
OTEL_ENABLED
OTEL_EXPORTER_OTLP_ENDPOINT
VICTORIALOGS_URL
```

- `LOG_LEVEL` — Winston log level (`debug` / `info` / `warn` / `error`). Defaults to `debug` in
  development, `info` in production.
- `SLOW_REQUEST_THRESHOLD_MS` — requests exceeding this duration (in ms) trigger a `warn` log
  via `SlowRequestInterceptor`. Default: `2000`. Range: 10–300000.
- `METRICS_ENABLED` — enable/disable Prometheus metrics collection (`prom-client`).
  Default: `true`. Set to `false` in test environment. When enabled, the `/metrics`
  endpoint exposes Prometheus exposition format for scraping. See ADR-0006 for the
  full observability strategy.
- `METRICS_USER` — Basic Auth username for `/metrics`. When set together with
  `METRICS_PASSWORD`, the `/metrics` endpoint requires HTTP Basic Auth.
- `METRICS_PASSWORD` — Basic Auth password for `/metrics`. Must be set together
  with `METRICS_USER`.
- `OTEL_ENABLED` — set to `true` to start the OpenTelemetry SDK with automatic
  instrumentation (HTTP/DB/Redis); all logs then carry `trace_id` / `span_id`.
  BullMQ Worker and Cron Job spans are also created via `bullmq-otel` telemetry,
  so async job logs carry `trace_id` too.
  Default: `false` (SDK not started; tests and existing flows unaffected). See
  ADR-0010 for the full tracing strategy.
- `OTEL_EXPORTER_OTLP_ENDPOINT` — OTLP HTTP trace reporting endpoint. Default:
  `http://127.0.0.1:4318/v1/traces` (local Jaeger all-in-one port 4318). Only
  used when `OTEL_ENABLED=true`. In production, no trace backend is deployed —
  the OTel SDK still starts so that `trace_id` is injected into logs, but OTLP
  export failures are silently dropped. In development, the endpoint points to
  the Jaeger all-in-one container (`compose.dev.yaml`). See ADR-0016
  Decision 3 for the trace backend strategy.
- `VICTORIALOGS_URL` — VictoriaLogs HTTP ingest endpoint. When set in production,
  Winston batches log entries as newline-delimited JSON and POSTs them directly
  to this URL (no Vector sidecar needed). Production `compose.yaml` injects
  `http://victorialogs:9428/insert/jsonline`; staging(原生 PM2)在
  `.env.production` 里写 `http://127.0.0.1:9428/insert/jsonline`(容器端口发布到回环)。
  Unset = only Console (stdout) transport is used. See ADR-0016 for the log backend strategy.

Security:

```text
TESTING_SHARED_SECRET
TRUST_PROXY
```

- `TESTING_SHARED_SECRET` — shared secret required by `TestingSharedSecretGuard`.
  The `/api/v1/testing/*` endpoints are protected by both `JwtAuthGuard` and
  `TestingSharedSecretGuard`; the client must send the shared secret via the
  `x-testing-shared-secret` header. Only registered when `NODE_ENV=test`.
- `TRUST_PROXY` — when set to `true`, Fastify trusts `X-Forwarded-*` headers
  from the reverse proxy. Required in production behind the Coolify Traefik
  proxy, and in staging behind the self-hosted Traefik container, for correct
  client IP extraction and protocol detection (rate limiting buckets per client).

Client-facing configuration (optional):

```text
SUPPORT_EMAIL
MIN_CLIENT_VERSION
```

- `SUPPORT_EMAIL` — support contact email shown on the app's About page and
  used for the "Help & Support" mailto link. When unset, the About page falls
  back to a hardcoded support URL.
- `MIN_CLIENT_VERSION` — minimum required client version for version-gating.
  When set, clients below this version may be prompted to update.

Bundle / docs (optional):

```text
SCALAR_API_REFERENCE_VERSION
```

- `SCALAR_API_REFERENCE_VERSION` — explicit version slug for the self-hosted
  Scalar API docs bundle (`/scalar/standalone.js?v=<version>`). When set, it
  overrides the value read from `package.json`. Useful in serverless or
  read-only filesystem deployments where `package.json` may not be available
  at runtime, so the `immutable` cache header still busts when `@scalar/api-reference`
  is upgraded.

Build / export flags (internal):

```text
OPENAPI_EXPORT_SKIP_DB_CONNECT
OPENAPI_EXPORT_SKIP_REDIS
```

- `OPENAPI_EXPORT_SKIP_DB_CONNECT` — set to `true` by `scripts/contract/export-openapi.ts`
  during the OpenAPI export process so the Prisma/Postgres connection is skipped (only the
  static schema + zod types are needed). Runtime consumer: `src/prisma/prisma.service.ts`
  (`$connect` skipped when `true`).
- `OPENAPI_EXPORT_SKIP_REDIS` — set to `true` by the same export script so Redis-backed
  throttle storage, cache, and BullMQ connections are skipped during contract generation.
  Runtime consumers: `throttler.config.ts`, `cache.config.ts`, `queue.factory.ts`,
  `redis.service.ts`. Both variables are `z.enum(['true', 'false']).optional()` in the
  env validation schema (they may be absent at runtime outside the export process).
  Typed as `EnvKey.OPENAPI_EXPORT_SKIP_DB_CONNECT` / `EnvKey.OPENAPI_EXPORT_SKIP_REDIS`.
