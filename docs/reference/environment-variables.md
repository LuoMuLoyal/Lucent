---
status: active
owner: backend
quadrant: reference
updated: 2026-10-01
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
- Global prefix `/api`,URI 版本默认 `1`;管理控制台 `/admin`(SPA,由后端同源挂载)
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
  三台机器各跑一份仓库内 compose(鲲鹏主站 / 腾讯云 Neo4j+semantica / 阿里云监控栈),
  用 `docker compose up -d` 直接管理;跨云走公网,访问控制由云安全组限源承担
- 非 development 目标的 Prisma 命令须显式指定 NODE_ENV,例如
  `NODE_ENV=test pnpm exec prisma migrate deploy`

## Required Production Variables

Lucent app runtime in production requires:

```text
DATABASE_URL
REDIS_URL
JWT_ACCESS_SECRET
JWT_REFRESH_SECRET
METRICS_USER
METRICS_PASSWORD
```

生产(`compose.yaml`,服务器 `/opt/lucent/.env`)下 `DATABASE_URL` / `REDIS_URL` 由
`compose.yaml` 按 `POSTGRES_PASSWORD` / `REDIS_PASSWORD` 拼接注入,不需要单独填写。

`ADMIN_CONSOLE_ENABLED`(`'true'` / `'false'`,默认 `'true'`)控制管理控制台 SPA 是否由
后端同源挂载在 `/admin`;设为 `'false'` 时后端不注册任何静态路由,须由外部 Web 服务器
托管构建产物。`ADMIN_CONSOLE_DIR` 覆盖构建产物目录,留空按仓库内 `admin/dist` 解析,
容器内为 `/app/admin/dist`。构建产物缺失时后端只记一条 warn 并跳过挂载,不影响其它路由。
控制台没有独立凭据:登录使用真实 Lucent 账号,权限来自 `AdminUser` 角色矩阵。

主站上 `DATABASE_URL` / `REDIS_URL` 由 `compose.yaml` 的 `environment` 块用
`POSTGRES_PASSWORD` / `REDIS_PASSWORD` 拼接注入(容器名寻址,不写回环),
所以 `.env` 里内嵌的密码必须与 `POSTGRES_PASSWORD` / `REDIS_PASSWORD` 一致
(改密码要改两处);`TRUST_PROXY`(当前无反代 → `false`)与 `VICTORIALOGS_URL`
也是主站必填项。

非敏感运行时参数(host/port/日志级别/阈值/各业务开关)均通过环境变量配置,未设置时使用
代码内默认值(见下文各节);全部可覆盖项见 `.env.production.example` 注释。

`METRICS_USER` and `METRICS_PASSWORD` protect the `/metrics` Prometheus endpoint
with HTTP Basic Auth. Both must be set together; if either is missing, `/metrics`
is served without authentication (not recommended for production). VictoriaMetrics
scrape config (`monitoring/victoriametrics/vmscraper.yml`)用 `%{METRICS_USER}` /
`%{METRICS_PASSWORD}` 占位符从容器环境变量注入同名凭据。

GitHub Actions `release.yml` 构建并推送 multi-arch 镜像到发布者自有 registry
(仓库级 secrets):

```text
REGISTRY_IMAGE
DOCKERHUB_USERNAME
DOCKERHUB_TOKEN
```

`REGISTRY_IMAGE` 是 app 镜像完整引用(如 `docker.io/<用户名>/lucent`);DB 镜像由它
派生出同命名空间的 `<namespace>/lucent-db`,**不需要单独配 secret**。

镜像只在服务器侧被消费:更新目标主机 `.env` 里的 `LUCENT_IMAGE` / `LUCENT_DB_IMAGE`
引用后 `docker compose pull && docker compose up -d --force-recreate <service>`。
tag 形如 `sha-<短sha>`,指向 multi-arch manifest,故不含架构、跨机器通用。

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

Google OAuth:

```text
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI
```

All OAuth provider variables are optional. When unset, the provider logs a warning
at startup but does not block application launch. QQ and Google each use
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
生产环境变量注入,即服务器上的 `/opt/lucent/.env`）并完成真机验证。缺失时服务静默禁用推送并在启动日志
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

S3-compatible object storage (dev: SeaweedFS / prod: 七牛云 Kodo S3 兼容) — set `STORAGE_PROVIDER=s3` to use:

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
AI_THINKING
AI_ANALYSIS_THINKING
AI_VISION_THINKING
AI_LANGUAGE_THINKING
AI_CHAT_THINKING
AI_CHAT_COMPRESSION_THINKING
```

AI safety configuration (optional):

```text
AI_SAFETY_FORBIDDEN_PATTERNS
```

- Comma- or newline-separated regex strings used by `LlmSafetyPolicyService`.
- If unset or empty, a hardcoded medical-advice baseline is used.
- Example: `AI_SAFETY_FORBIDDEN_PATTERNS=诊断,确诊,停药,\bprescription\b`

Reasoning ("thinking") mode (optional):

```text
AI_THINKING                    # 默认 auto；全局默认值
AI_ANALYSIS_THINKING           # 按角色覆盖，未设则继承 AI_THINKING
AI_VISION_THINKING
AI_LANGUAGE_THINKING
AI_CHAT_THINKING
AI_CHAT_COMPRESSION_THINKING
```

- Values are semantic, not vendor payloads: `auto` | `enabled` | `disabled`.
  Anything else is rejected at startup (a typo must not silently fall back to
  `auto` and leave the operator believing the switch is on).
- **`auto` preserves pre-existing behaviour** and is the default. It applies the
  legacy detection — DeepSeek host (`api.deepseek.com`), or an Aliyun-compatible
  host serving a `qwen3*` model — and emits nothing anywhere else. Upgrading
  without setting these variables therefore cannot change a single request.
- An explicit `enabled` / `disabled` **is** honoured on the recognized families
  even when `auto` would have stayed quiet. That is the point of the switch:
  production used to run a DeepSeek model through an Aliyun MaaS gateway, which
  matched neither legacy branch, so thinking was uncontrolled there.
- How the intent reaches the wire is decided from the role's `BASE_URL`
  (`src/llm-runtime/llm-runtime.service.ts`): DeepSeek gets
  `thinking: { type }`, Aliyun-compatible gateways get `enable_thinking`.
  An unrecognized gateway receives nothing rather than a guessed field, because
  an unknown reasoning parameter is a request-validation error on strict
  OpenAI-compatible servers.
- Embedding has no chat model, so no `AI_EMBEDDING_THINKING` exists.

`AI_PROVIDER` currently supports only `openai-compatible`.

Each role is independent. If a role is configured, that role must provide all of
`BASE_URL`, `API_KEY`, and `MODEL`. Partial role configuration is rejected at startup.

DeepSeek compatibility note:

- When an AI role points to `https://api.deepseek.com`, Lucent disables DeepSeek `thinking`
  mode by default for LangChain OpenAI-compatible chat runtime creation. This prevents Today/Report
  streaming tool-use requests from failing on `tool_choice`.
- That default is now `AI_THINKING=auto` behaviour and can be overridden per deployment or per
  role with `AI_<ROLE>_THINKING` (see the reasoning-mode section above).

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

> **抽取/关键词必须用便宜的非 thinking 模型，查询才用强模型**（2026-09-21 更正）。
> 按角色分离的变量就是为此存在的：`EXTRACT_LLM_MODEL` / `KEYWORD_LLM_MODEL` 与
> `QUERY_LLM_MODEL`。若三者配成同一个强模型且不关 thinking，建图会慢一个数量级，
> 而且**抽出的实体名会带上剂量单位**（实测 `2 Tablets`、`20mg Per Kilogram`
> 被当成实体）。两条纪律：
>
> - **关 thinking** 走 role 级 provider option，变量名是
>   `{ROLE}_{BINDING}_{FIELD}`，值为 JSON：`EXTRACT_OPENAI_LLM_EXTRA_BODY={"enable_thinking": false}`
>   （`KEYWORD_*` 同理）。实测同一句话默认调用返回 999 字符 reasoning、耗时 4644ms，
>   关掉后无 reasoning、486ms。
> - **并发闸门是 `MAX_ASYNC_LLM`**（每角色 LLM 调用并发，默认仅 4），
>   不是 `MAX_PARALLEL_INSERT`（那只管文档级 / PG 写入并发）。只调后者等于调错管道。
>
> 另外 `SUMMARY_LANGUAGE` 默认 `English`（会把实体描述写成英文），中文语料要显式设
> `Chinese`；默认实体本体是 `Person`/`Organization`/`Location` 那套通用类型，对药品
> 说明书不对口，用 `ENTITY_TYPE_PROMPT_FILE` 指定领域 profile（`PROMPT_DIR` 默认
> `./prompts`，只认裸文件名 + 固定子目录 `entity_type/`，**不接受绝对路径**）。
> 完整清单与实测数据见 `deploy/lightrag/.env.example` 与
> `lightrag-eval/results/mode-comparison.md` §九。

> **嵌入维度是「声明」与「投递」两个变量，只设一个会写入失败**（2026-10-02 实测）。
> `EMBEDDING_DIM` 只声明期望维度并据此建向量表（如 `..._768d`）；真正把维度作为
> `dimensions` 参数发给 API 的是 `EMBEDDING_SEND_DIM`，其**默认值为 `false`**
> （jina/gemini 会被强制为 `true`，OpenAI 兼容端点必须显式打开）。文本向量模型普遍
> 支持动态降维且**默认输出不等于你要的维度**：`text-embedding-v4` 支持 64–2048，
> 不传 `dimensions` 时返回 1024。于是 LightRAG 按 768 建表、API 返回 1024，
> 10 条 embeddings 共 10240 个数除不尽 768，`PGVectorStorage[entities]` flush 失败、
> 整批文档标 `failed`：
>
> ```
> Embedding dimension mismatch detected: total elements (10240) cannot be
> evenly divided by expected dimension (768)
> ```
>
> 启动日志里可提前核对，不必等报错：
> `Send embedding dimension: True by env var (dimensions=768, has_param=True, binding=openai)`
> —— 若是 `False`，无论 `EMBEDDING_DIM` 填多少都不会生效。

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
SEMANTICA_TIMEOUT_MS # 默认 20000；须大于 sidecar 的查询超时（默认 15s）
SEMANTICA_API_KEY    # 与 sidecar 的 API_TOKEN 必须一致；仅 ENABLED=true 时强制
```

**两侧共享一个握手凭据。** `SEMANTICA_API_KEY`（本侧）与 `API_TOKEN`（sidecar 侧）是
同一个值：sidecar 除 `/health` 外的每个端点都要求 `Authorization: Bearer <它>`。

早期版本没有这一项，理由是 sidecar 只在内网 compose 网络上、不发布宿主端口。跨云部署
（app 在鲲鹏、Neo4j + sidecar 在腾讯云）之后该前提不成立，于是补上 —— sidecar 会按调用方
的要求执行只读 Cypher，仅靠安全组白名单收口不够。

**启动期交叉校验**：`SEMANTICA_ENABLED=true` 而 `SEMANTICA_API_KEY` 缺失（含空白串）时
校验直接失败，进程起不来。没有这条校验，漏配要到第一次推理调用才暴露，而上层把 401 归一
成 `kind: 'unauthorized'` 后呈现的是"推理服务不可用"——一个配置错误被伪装成基础设施故障。
关闭状态下即便残留了 base URL / key 也不报错。

服务**不可达**（配了 key 但对方没起来）仍属运行时问题：表现为工具返回"推理不可用"信封，
而不是进程起不来。

`SEMANTICA_TIMEOUT_MS` 的下限要高于 sidecar 自己的查询超时（默认 15s）：
否则"查询太慢"会先被客户端掐断，拿不到 sidecar 的结构化超时报错，重试回路也就收不到
"收窄查询"这个可执行的提示。

可用性判定：`reason_over_ontology` 在 sidecar 关闭时上报
`disabledReason: 'retrieval_unavailable'`——与 LightRAG 那条线同一条纪律（没有降级路径，
必须让客户端看见"暂不可用"而不是"确实没有证据"）。两条线**各自独立判定**：一个 sidecar
挂掉不会把另一个的工具也标成不可用。

**sidecar 自身的配置不在这里**：Neo4j URI / 凭据 / 库名 / 连接池 / 查询超时在它自己的
env 文件里（模板位于 `deploy/semantica/`，复制去掉后缀即为运行时文件，变量清单与
semantica-service 仓的同名同义），与 Lucent 的 `DATABASE_URL` 完全独立（图在 Neo4j 中，
**不进 Prisma 迁移域**，也没有共用的 Postgres database）。dev 也可以直接在本机跑（不起容器）：

```bash
cd semantica-service && uv run uvicorn semantica_service.main:app --port 8099
# 然后在 .env.development 里设 SEMANTICA_ENABLED=true 与
# SEMANTICA_BASE_URL=http://127.0.0.1:8099
```

**Neo4j 容器由编排提供**：

```text
NEO4J_PASSWORD  # 必填（三份编排都按 :?required 硬失败）；同时用于 NEO4J_AUTH 与健康探针
NEO4J_IMAGE     # 可选，默认 neo4j:5.26.31-community（钉补丁号，勿用浮动 tag）
```

> **⚠️ Neo4j 容器的环境变量有硬约束**：除 `NEO4J_AUTH` 外，任何 `NEO4J_` 前缀的变量
> 都被当作配置键解析，**未声明的键会让容器拒绝启动**（`Failed to read config:
Unrecognized setting`）。因此：
> ① 口令**不能**再用一个 `NEO4J_PASSWORD` 环境变量传给 Neo4j 容器（会被解析成
> `server.password` 而报错），编排改用非该前缀的 `LUCENT_NEO4J_PASSWORD` 承载裸口令
> 供 `cypher-shell` 探针使用；
> ② 只写 5.26 真实存在的内存设置（`heap.initial_size` / `heap.max_size` /
> `pagecache.size`）。`server.memory.recovery_policy` 在 5.26 **不存在**，照抄会让库起不来。

> **`semantica` 服务**（profile `semantica`）定义在三份 compose 里以保持 dev / prod 形态
> 一致，但其镜像只在图库机上有意义（主站不启用该 profile，见
> `docs/reference/deployment.md`）。该限制不影响 `neo4j` 服务本身：它不入门控，
> `docker compose up neo4j` 即可单独使用。

Observability:

```text
LOG_LEVEL
LOG_FORMAT
SLOW_REQUEST_THRESHOLD_MS
METRICS_ENABLED
METRICS_USER
METRICS_PASSWORD
OTEL_ENABLED
OTEL_EXPORTER_OTLP_ENDPOINT
OTEL_TRACES_SAMPLER
OTEL_TRACES_SAMPLER_ARG
VICTORIALOGS_URL
```

- `LOG_LEVEL` — Winston log level (`error` / `warn` / `info` / `debug` / `verbose`).
  **未设置**时按环境取默认（在 `src/common/logger/logger.config.ts` 的 `resolveLevel` 解析）：
  development = `debug`、test = `error`、production = `info`。显式设置的值总是优先。
  校验层刻意**不**给它默认值 —— 写死默认值会让该校验结果先于按环境解析生效，
  把三种环境的日志级别压成同一个。
- `LOG_FORMAT` — 日志格式（`pretty` = 人读 / `json` = 机器采集）。**未设置**时按环境取默认：
  development 用 `pretty`，其余环境用 `json`（在 `logger.config.ts` 解析）。
  与 `LOG_LEVEL` 同理，校验层刻意**不**给它默认值 —— 写死 `.default('pretty')` 会让
  生产输出 pretty 而不是 JSON，直接影响日志采集。
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
  used when `OTEL_ENABLED=true`. 导出失败会被静默丢弃（不影响主流程）。
  In development, the endpoint points to the Jaeger all-in-one container
  (`compose.dev.yaml`). See ADR-0016 Decision 3 for the trace backend strategy.
  **生产指向 VictoriaTraces（阿里云）时路径不是标准的 `/v1/traces`**：
  该服务的 OTLP/HTTP 端点是 `/insert/opentelemetry/v1/traces`，端口 10428：
  `http://<阿里云公网IP>:10428/insert/opentelemetry/v1/traces`。
- `OTEL_TRACES_SAMPLER` — trace 采样器，取 OTel 规范的标准取值：`always_on` /
  `always_off` / `traceidratio` / `parentbased_always_on` / `parentbased_always_off` /
  `parentbased_traceidratio`。`src/tracing.ts` **不传** `sampler`，NodeSDK 因此走
  `createSamplerFromEnv()` 读这两个变量 —— 所以**改采样率只需重启，不必改代码或重建镜像**。
  ⚠️ 取值非法时 OTel 只打一行 `diag.error` 然后**回落默认 `always_on`**，不抛错也不阻止启动：
  配错会静默变成全量采集，改动后务必核对拼写。
- `OTEL_TRACES_SAMPLER_ARG` — 采样率，取值 0–1，仅当 sampler 为 `traceidratio` /
  `parentbased_traceidratio` 时生效。生产用 `0.1`（10%）：span 是排查用的短期素材，
  全量采集既涨存储也涨跨云带宽。环境变量天然是字符串，校验层用 `z.coerce.number()`
  而非 `z.number()`（后者会永远校验失败）。
  实测发到 `/opentelemetry/v1/traces` 返回 400 —— 写错路径的表现是"一个 span 都
  没有"而非报错。Grafana 侧用内置 `jaeger` 数据源读它
  （`http://victoriatraces:10428/select/jaeger`，同机走容器网络）。
- `VICTORIALOGS_URL` — VictoriaLogs HTTP ingest endpoint. When set in production,
  Winston batches log entries as newline-delimited JSON and POSTs them directly
  to this URL (no Vector sidecar needed).
  **默认回落到** `http://victorialogs:9428/insert/jsonline`（写在 `compose.yaml` 的
  app 服务里，供单机全栈部署使用）。监控栈在另一台机器时容器名在本机解析不了，
  必须在 `.env` 里覆盖成 `http://<监控机地址>:9428/insert/jsonline`，并在监控机
  安全组放行本机的出口 IP。
  Unset = only Console (stdout) transport is used. See ADR-0016 for the log backend strategy.
- `LUCENT_PUBLIC_HOST` — **不是 app 的变量**，不经过 zod 校验层：它只由
  `compose.monitoring.yaml`（监控机）消费，作为 VictoriaMetrics 抓取目标的
  主机名（`vmscraper.yml` 里经 `%{LUCENT_PUBLIC_HOST}` 展开成
  `http://<值>:3000/metrics` 与 `:9100/metrics`）。填主站的**公网**地址，
  不带协议与端口。该文件用 `:?` 校验它，未设置时 compose 拒绝启动。
  单机全栈部署时填本机容器网络可达的地址即可。

Alerting (监控机专属，不经过 zod 校验层):

```text
ALERT_EMAIL_TO
GF_SMTP_ENABLED
MAIL_HOST
MAIL_PORT
MAIL_USER
MAIL_PASS
MAIL_FROM
```

Grafana 统一告警的规则、联系点与通知策略都在
`monitoring/grafana/provisioning/alerting/`（可入库、不含机密），这里只有发信通道。

- `ALERT_EMAIL_TO` — 告警收件地址。`contact-points.yml` 里写
  `addresses: $ALERT_EMAIL_TO`，由 Grafana 12 的 provisioning 环境变量插值展开。
  在这几个变量里它是**唯一刻意写死的真实邮箱**——因为它是收件人而非凭据。
- `GF_SMTP_ENABLED` — 必须显式为 `true`（模板与 compose 都默认 `true`）。
  ⚠️ Grafana 该键**默认 false**，此时通知被**静默丢弃**：告警照常触发、状态页照常
  变红，但一封邮件都不发。compose 因此用 `${GF_SMTP_ENABLED:-true}` 兜底。
- `MAIL_HOST` / `MAIL_PORT` / `MAIL_USER` / `MAIL_PASS` / `MAIL_FROM` — 与主站业务
  邮件同源（`compose.monitoring.yaml` 把它们映射成 `GF_SMTP_HOST` / `GF_SMTP_PORT`
  等）。QQ 邮箱用 `smtp.qq.com` + `587` 配 `STARTTLS`（不是 465 隐式 TLS），故
  compose 设 `GF_SMTP_STARTTLS_POLICY: Opportunistic`。
  ⚠️ 监控机不发业务邮件，但它**仍需要这几项**：compose 解析阶段就要有值，
  且 `GF_SMTP_USER` 通常必须与 `GF_SMTP_FROM_ADDRESS` 同域，否则被 SMTP 服务器拒发。
  两侧值由 `deploy-secrets/build_envs.py` 的跨机守卫校验一致——只改一侧的表现是
  「告警触发但邮件静默不发」。

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
  from a reverse proxy. There is no reverse proxy in the current topology (the app
  is published directly), so it is only needed if one is introduced later; keep it
  set for correct client IP extraction and protocol detection behind a proxy
  (rate limiting buckets per client).

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
