---
status: active
owner: backend
quadrant: reference
updated: 2026-09-17
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
- LightRAG sidecar 默认**不在** dev 栈里(拖慢启动且需要模型 key),它在
  `compose.dev.yaml` 的 `lightrag` profile 内:
  `docker compose -f compose.dev.yaml --profile lightrag up -d lightrag`
  起在 `127.0.0.1:9621`;变量见下方 LightRAG 小节

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

`ADMIN_ENABLED`(`'true'` / `'false'`,默认开启)控制 AdminJS 面板是否注册:
设为 `'false'` 时启动阶段完全跳过面板——不加载 `adminjs` / `@adminjs/fastify` /
`@sergiyiva/adminjs-prisma`,也不做 Prisma DMMF 自省与 resource 构建,可省下一块
启动内存(内存受限的 staging 用得上:`.env.production` 里写 `ADMIN_ENABLED=false`)。
只认字面量 `'false'`,其它值/未设置都保持开启;关闭面板**不影响** `ADMIN_EMAIL` /
`ADMIN_PASSWORD` / `ADMIN_COOKIE_SECRET` 的必填性(它们同时被 AdminJS 登录与
`AdminGuard` 的管理员断言复用)。

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

LightRAG sidecar — 中文散文检索(说明书字段级语义检索 + 医学问答):

```text
LIGHTRAG_ENABLED            # 默认 false；关闭时检索工具返回"未配置"信封，不抛错
LIGHTRAG_BASE_URL           # 默认 http://lightrag:9621
LIGHTRAG_API_KEY            # 启用时必填（sidecar 调用密钥）
LIGHTRAG_TIMEOUT_MS         # 默认 8000；`naive` 模式的客户端超时
LIGHTRAG_GRAPH_TIMEOUT_MS   # 默认 60000；图模式的客户端超时（见下方说明）
LIGHTRAG_GRAPH_SOURCES      # 默认 leaflet；逗号分隔，含义是"这些来源的图已建好"
LIGHTRAG_WORKSPACE_LEAFLET  # 默认 leaflet
LIGHTRAG_WORKSPACE_QA       # 默认 qa
```

`LIGHTRAG_ENABLED=true` 时启动校验要求 `LIGHTRAG_API_KEY` 非空；关闭状态下残留的
base URL / key 不阻断启动。**这几个变量与上面的 `AI_*` 完全独立**：LightRAG 侧用自己的
变量名与自己的凭据，即使指向同一家厂商也是两套配置、两个 key、各自轮换、各自限流。

> **图模式（`local`/`global`/`hybrid`/`mix`）与这两个变量**：图模式每次查询要现调 LLM
> 做关键词抽取、再遍历图，实测 16–29 秒（`naive` 是 352ms），因此需要一个远大于 8 秒的
> 预算。`LIGHTRAG_GRAPH_SOURCES` 决定**哪些来源允许**图模式——它是"**索引建没建**"的
> 运维事实，不是代码分支：没建图却放行图模式的后果**不是报错，是空结果**（图模式拿不到
> 实体，`coverage.reason` 会如实说明）。设成空串即回到"图模式全禁"。
>
> 超时是三层嵌套的，改动时三个值要一起看：
> 客户端 `LIGHTRAG_GRAPH_TIMEOUT_MS`(60s) < 工具级
> `RETRIEVAL_TOOL_EXECUTION_TIMEOUT_MS`(65s) < 图节点
> `ASSISTANT_NODE_TIMEOUT_MS`。客户端必须是最小的那个，超时信封里才会是
> "检索超时"而不是工具层那句笼统的 "Tool execution timed out."。
>
> 依据见 `lightrag-eval/results/mode-comparison.md`（line 132-134 与结论 5）。

关闭时 `search_cn_medicine_knowledge` 在 `GET /assistant/capabilities` 上报
`disabledReason: 'retrieval_unavailable'`——中文散文检索没有降级路径，必须让客户端
看见"检索暂不可用"而不是"确实没有证据"。

> **`LIGHTRAG_WORKSPACE_*` 的当前实情**：上游 #2527 确认单实例仅支持单 workspace，
> 实测 `LIGHTRAG-WORKSPACE` 头并不改变实际读写位置（`get_workspace_from_request`
> 只被 `/health` 调用）。两个 workspace 变量仍然保留在契约里，但**同一 sidecar 实例上
> `leaflet` 与 `qa` 实际落在同一命名空间**，靠灌入时写入的 doc id 前缀
> （`leaflet:` / `qa:`）区分来源。需要真正隔离时应另起一个 sidecar 实例。

**sidecar 自身的配置不在这里。** LightRAG 进程（Python 容器）读它自己那份独立 env
文件：模板位于 `deploy/lightrag/`（`env.example`，入库并作为 LightRAG 全部变量的
唯一清单），使用时同目录复制去掉 `.example` 后缀；其中包含存储四件套
（`LIGHTRAG_KV_STORAGE` / `LIGHTRAG_VECTOR_STORAGE` / `LIGHTRAG_GRAPH_STORAGE` /
`LIGHTRAG_DOC_STATUS_STORAGE`）、独立 `POSTGRES_*` 与按角色分离的模型变量
（`LLM_BINDING_*` / `EXTRACT_LLM_*` / `KEYWORD_LLM_*` / `QUERY_LLM_*` / `EMBEDDING_*` /
`RERANK_*`）。单独一份文件的理由是**凭据暴露面**：共用 Lucent 的 `.env` 会让那个 Python
容器读到 `JWT_*` / `DATABASE_URL` / 微信密钥，而这一点靠变量覆盖解决不了。

两处唯一共享的值是 `LIGHTRAG_API_KEY` —— Lucent 侧的调用密钥与 sidecar env 里的同名项
**必须一致**（鉴权握手，不是模型配置复用）。

启用步骤（复制模板 → 填模型 key → 起 profile，见模板头注释）：

```bash
cp deploy/lightrag/.env.example deploy/lightrag/.env   # 填入模型 key 与 LIGHTRAG_API_KEY
docker compose -f compose.dev.yaml --profile lightrag up -d lightrag
# 然后在 .env.development 里设 LIGHTRAG_ENABLED=true 与同名 LIGHTRAG_API_KEY
```

`LIGHTRAG_BASE_URL` 在 dev 走 `http://127.0.0.1:9621`（compose profile 发布到回环），
在 production 走默认的容器名地址（同 compose 网络）。

### Semantica sidecar — 英文侧 OAG（本体推理）

```text
SEMANTICA_ENABLED    # 默认 false；关闭时 reason_over_ontology 返回"未配置"信封，不抛错
SEMANTICA_BASE_URL   # 默认 http://semantica:8099
SEMANTICA_TIMEOUT_MS # 默认 20000；须大于 sidecar 的 statement_timeout（默认 15s）
```

**没有 API key。** 与 LightRAG 不同，这是我们自己的服务：只在内网 compose 网络上
（不发布宿主端口、不挂 Traefik），自身也不持有任何模型凭据 —— NL→Cypher 的生成在
Lucent 侧用 `AI_LANGUAGE_*` 角色完成（`BaseLlmGeneratorService`），sidecar 只做校验与执行。
因此**没有启动期交叉校验**：`SEMANTICA_ENABLED=true` 但服务不可达时，表现为工具返回
"推理不可用"信封，而不是进程起不来。

`SEMANTICA_TIMEOUT_MS` 的下限要高于 sidecar 自己的 `statement_timeout`（默认 15s）：
否则"查询太慢"会先被客户端掐断，拿不到 sidecar 的结构化超时报错，重试回路也就收不到
"收窄查询"这个可执行的提示。

可用性判定：`reason_over_ontology` 在 sidecar 关闭时上报
`disabledReason: 'retrieval_unavailable'`——与 LightRAG 那条线同一条纪律（没有降级路径，
必须让客户端看见"暂不可用"而不是"确实没有证据"）。两条线**各自独立判定**：一个 sidecar
挂掉不会把另一个的工具也标成不可用。

**sidecar 自身的配置不在这里**：AGE DSN / 图名 / 连接池 / 语句超时在它自己的 env 文件里
（模板位于 `deploy/semantica/`，复制去掉后缀即为运行时文件，变量清单与 semantica-service
仓的同名同义），与 Lucent 的 `DATABASE_URL` 完全独立（AGE 在独立 database `lucent_graph`
中，不进 Prisma 迁移域）。dev 也可以直接在本机跑（不起容器）：

```bash
cd semantica-service && uv run uvicorn semantica_service.main:app --port 8099
# 然后在 .env.development 里设 SEMANTICA_ENABLED=true 与
# SEMANTICA_BASE_URL=http://127.0.0.1:8099
```

> **当前实情（2026-09-19）**：`semantica-service` 尚未提供 Dockerfile/镜像，因此三份
> compose 里的 `semantica` 服务（profile `semantica`）**暂时起不来**——服务定义已经写好
> 是为了让 dev / staging / prod 形态一致（AGE 计划 §一 的"三环境同一形态"），镜像是下一步。

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
