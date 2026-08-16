---
status: active
owner: backend
quadrant: reference
updated: 2026-08-16
---

# Environment Variables

本文件是 [[environment]] 拆分后的子文档。

## Required Production Variables

Lucent app runtime in production requires:

```text
DATABASE_URL
REDIS_URL
JWT_ACCESS_SECRET
JWT_REFRESH_SECRET
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

JWT and admin secrets are required in every runtime now; keep them in the env
files, not in code defaults. The checked-in dev/test templates already provide
local values.

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

All four variables are optional. AppKey and Master Secret must be configured together;
if either is empty, Lucent skips push delivery. `JPUSH_APNS_PRODUCTION` accepts `true` or
`false` and defaults to `false`; `JPUSH_API_BASE_URL` defaults to `https://api.jpush.cn`.
The Master Secret is sensitive and must not be committed.

**0.1.0 发布门槛**：生产环境必须配齐 `JPUSH_APP_KEY` / `JPUSH_MASTER_SECRET`（经
`/opt/lucent/.env` 注入）并完成真机验证。缺失时服务静默禁用推送并在启动日志 `warn`，
`deploy.ts` 预检输出高亮 WARNING（不阻塞部署）；门槛本身见 [[deployment]] 最低上线检查。

Daily-record image uploads through Tencent COS:

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
  Default: `false` (SDK not started; tests and existing flows unaffected). See
  ADR-0010 for the full tracing strategy.
- `OTEL_EXPORTER_OTLP_ENDPOINT` — OTLP HTTP trace reporting endpoint. Default:
  `http://127.0.0.1:4318/v1/traces` (local Jaeger all-in-one port 4318). Only
  used when `OTEL_ENABLED=true`.

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
