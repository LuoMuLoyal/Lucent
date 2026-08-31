---
status: active
owner: backend
quadrant: reference
updated: 2026-08-31
---

# Environment Variables

本文件是环境变量完整参考(唯一事实源);本地环境与运行时基线也在此文件——YAML 配置加载、
本地 dev 基线、Docker dev 栈与常用脚本见下文对应章节。

## 配置文件与加载顺序

Env 文件仅本地使用、不入库(`.env.development|production|test` 及对应 `.local` 覆盖);
模板为 `.env.development.example` / `.env.test.example` / `.env.production.example`。
加载优先级从高到低:`.env.<NODE_ENV>.local` → `.env.<NODE_ENV>`,没有根 `.env` 回退;
运行时、Prisma CLI 与药品导入脚本共用同一解析顺序(`src/config/env/env-file-paths.ts`)。

非敏感配置来自 `config/` 下嵌套 YAML,优先级从低到高:
`config/default.yaml` → `config/<env>.yaml` → `config/<env>.local.yaml`(gitignored)。
合并由 `src/config/yaml/yaml-loader.ts` 深合并并以 Zod schema 校验,注册为
`configService.getOrThrow<YamlConfig>(ConfigKey.Yaml)`;敏感值(API key、数据库 URL、secret)
仍留在 `.env.*` 并经 `configService.get(EnvKey.*)` 读取,业务代码禁止直接读 `process.env`。

## 本地开发基线

- Development DB:`postgres/postgres@127.0.0.1:15432/lucent`;Test/e2e DB:
  `lucent/lucent_dev@127.0.0.1:5432/lucent`;Redis:`redis://127.0.0.1:6379`
- Global prefix `/api`,URI 版本默认 `1`;管理面板 `GET /admin`
- 健康探针:`GET /api/v1/health`(readiness 别名,关键依赖不可用返回 503)、
  `/api/v1/health/live`(纯进程存活)、`/api/v1/health/ready`、`/api/v1/health/deep`(诊断)
- 启动顺序:`pnpm dev:stack` → `pnpm db:migrate` → `pnpm start:dev`
- `pnpm dev:stack`(`docker-compose.dev.yml`)以 `pgvector/pgvector:pg18` 启动
  postgres-dev / postgres-test——Assistant RAG 的向量索引与查询依赖
  `CREATE EXTENSION vector`;同时启动 SeaweedFS(dev-only S3 兼容存储,S3 API 端口 8333、
  Filer 端口 8888,`STORAGE_PROVIDER=s3` 启用)与 Jaeger UI(OTLP 4318)。若本地卷由旧版
  纯 Postgres 镜像创建,重建 dev/test 卷即可补齐扩展二进制

## 常用脚本

- `pnpm check` — 一键校验:lint、format、typecheck、build、单测、e2e
- `pnpm typecheck` / `typecheck:tools` — 全量 TS 检查(`src/`、spec、`test/`;`scripts/` 与 `deploy/` 助手)
- `pnpm start:dev` / `start:test:dev` / `start:prod` — development / test / production 运行时
- `pnpm test` / `test:ci` / `test:e2e` — 单测、eslint-plugins 测试与 e2e(CI 变体串行执行)
- `pnpm test:runtime:start` / `test:runtime:stop` — 全栈 lane 的 test 运行时启动/停止
- `pnpm export:openapi` — build 后导出 `docs/reference/generated/openapi.json`(生成物,禁手改)
- `pnpm dev:stack:down` / `dev:stack:reset` — 停止 / 重建本地 Docker dev 栈
- `pnpm db:reset:dev` / `db:reset:test` — 重置对应数据库(`prisma migrate reset --force`)
- `pnpm import:medicine:all` — 药品知识库默认导入序列(数据源细节见模块 README 与导入脚本)
- `pnpm deploy:smoke` — 部署后冒烟检查;`pnpm deploy:server` — 服务器端部署脚本
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

`METRICS_USER` and `METRICS_PASSWORD` protect the `/metrics` Prometheus endpoint
with HTTP Basic Auth. Both must be set together; if either is missing, `/metrics`
is served without authentication (not recommended for production). Prometheus
scrape config must include matching `basic_auth` credentials.

GitHub Actions production deploy also requires repository/environment secrets outside
`.env.production`:

```text
TCR_USERNAME
TCR_PASSWORD
DEPLOY_HOST
DEPLOY_PORT
DEPLOY_USER
DEPLOY_SSH_KEY
DEPLOY_SSH_KNOWN_HOSTS
```

`CORS_ORIGIN` may be left empty for App-only production deployments with no browser cross-origin
traffic. If you do expose browser clients from another origin, set it explicitly.

JWT, Better Auth and admin secrets are required in every runtime now; keep them in the env
files, not in code defaults. The checked-in dev/test templates already provide
local values.

## Better Auth

```text
BETTER_AUTH_SECRET
BETTER_AUTH_URL
BETTER_AUTH_EMAIL_CALLBACK_URL
```

- `BETTER_AUTH_SECRET` — signing secret for Better Auth sessions and tokens. Must be at least 32
  characters; treat it as a sensitive credential. Required in all runtimes once Better Auth is wired
  into the runtime (Task 2 onwards); startup validation fails if missing.
- `BETTER_AUTH_URL` — public base URL used by Better Auth to build callback and verification links.
  Defaults to `http://localhost:3000` when unset.
- `BETTER_AUTH_EMAIL_CALLBACK_URL` — final redirect target used in password-reset and email-verification
  links sent by Better Auth. Optional; defaults to `luminous://auth/callback` for mobile deep-links.
  Web deployments can override it with `https://<host>/auth/callback`.

These variables are introduced by the Better Auth migration. During Task 1 they are only used by the
isolated spike script; Task 2 wires them into the NestJS runtime via `AuthBetterAuthAdapter`; Task 3
adds the email-verification and password-reset callbacks.

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
`/opt/lucent/.env` 注入）并完成真机验证。缺失时服务静默禁用推送并在启动日志 `warn`，
`deploy.ts` 预检输出高亮 WARNING（不阻塞部署）；门槛本身见 [[deployment]] 最低上线检查。

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

S3-compatible object storage (dev: SeaweedFS) — set `STORAGE_PROVIDER=s3` to use:

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

`STORAGE_PROVIDER` defaults to `tencent-cos`; when set to `s3`, all of `STORAGE_S3_ENDPOINT`,
`STORAGE_S3_ACCESS_KEY`, `STORAGE_S3_SECRET_KEY`, and `STORAGE_S3_BUCKET` must be set together.
`STORAGE_S3_CLIENT_ENDPOINT` defaults to `STORAGE_S3_ENDPOINT` when empty.
`STORAGE_S3_EXTERNAL_ENDPOINT` is optional; when absent, requests for external-audience URLs
(e.g. meal-analysis vision model) will fail with a clear configuration error.

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
  the Jaeger all-in-one container (`docker-compose.dev.yml`). See ADR-0016
  Decision 3 for the trace backend strategy.
- `VICTORIALOGS_URL` — VictoriaLogs HTTP ingest endpoint. When set in production,
  Winston batches log entries as newline-delimited JSON and POSTs them directly
  to this URL (no Vector sidecar needed). The `compose.yml` injects
  `http://victorialogs:9428/insert/jsonline` automatically. Unset = only
  Console (stdout) transport is used. See ADR-0016 for the log backend strategy.

Security:

```text
TESTING_SHARED_SECRET
TRUST_PROXY
```

- `TESTING_SHARED_SECRET` — shared secret required by `TestingSharedSecretGuard`.
  The `/api/v1/testing/*` endpoints are protected by both `JwtAuthGuard` and
  `TestingSharedSecretGuard`; the client must send the shared secret via the
  `x-testing-shared-secret` header. Only registered when `NODE_ENV=test`.
- `TRUST_PROXY` — when set to `true`, Express trusts `X-Forwarded-*` headers
  from the reverse proxy (Nginx). Required in production behind Nginx for
  correct client IP extraction and protocol detection.

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
