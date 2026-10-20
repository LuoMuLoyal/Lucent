---
status: active
owner: backend
quadrant: reference
updated: 2026-10-19
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
- **生产侧 env 模板按机器分三份**(ADR-0023 的 2026-10-12 修订):`.env.production.example`
  (主站,`compose.yaml`)、`.env.graph.example`(图库机,`compose.graph.yaml`)、
  `.env.monitoring.example`(监控机,`compose.monitoring.yaml`)。服务器上各拷成自己那份
  `.env`。⚠️ 不要把三台的变量合到一份:compose 对整个文件插值,合表会让图库机也必须
  凑齐主站的口令才能启动
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

`PUBLIC_BASE_URL`(默认 `http://localhost:3000`)同时决定 **Helmet 的 HTTPS 专属响应头是否下发**:
只有它是 `https://` 时才带 `Strict-Transport-Security` 与 CSP 的
`upgrade-insecure-requests`。纯 HTTP 部署(如运行基线里的 `http://<主站IP>:3000`)必须
保持 `http://`,否则浏览器会把 `/admin/assets/*.js|css` 全部改写成 `https://` 同端口,
TLS 握手失败后管理端只剩空白页(回环地址被视为可信来源,本地开发复现不出)。

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

AI 家族的运行时覆盖（配置中心，见下文 rnacos 小节）：

- `AI_<ROLE>_MODEL` / `_BASE_URL` / `_THINKING` 与 `AI_<ROLE>_TEMPERATURE` /
  `_MAX_RETRIES` / `_TIMEOUT_MS` 都是热键，在**每次调用时**解析，优先级为
  **远程文档 > 调用点参数 > 环境基线**。远程值必须压过调用点，否则代码里给生成器的
  采样常量（0.2 温度、30s 超时等）会让这些开关失效。
- `AI_*_API_KEY` 与 `AI_EMBEDDING_DIMENSION` 不在白名单：密钥只从 `.env` 读，
  向量维度是 schema 不变量（换维度等于换向量空间）。角色到键名的映射只在
  `LLM_ROLE_KEYS`（`src/config/services/llm.config.ts`）声明一次，单测会校验它与
  中心白名单、AI 字段表三者一致。
- 提示词覆盖由 `PROMPT_*` 九个键承担，注册表是
  `src/config/runtime/prompt-registry.ts`：发布文本必须保留该键声明的占位符
  （`PROMPT_ASSISTANT_SYSTEM` → `{{tools}}` `{{toolAvailability}}`，
  `PROMPT_MEAL_ANALYSIS_SYSTEM` / `_USER` → `{{language}}`，
  `PROMPT_SUGGESTION_COPY` → `{{tone}}`），缺占位符或超过 8000 字符整份拒绝。
  占位符用当次请求的值填充；日志只记 12 位 sha256 指纹，不记提示词正文。
- Embedding has no chat model, so no `AI_EMBEDDING_THINKING` exists.

检索与助手预算家族的运行时覆盖：

- 19 个 `LIGHTRAG_*` / `SEMANTICA_*` / `ASSISTANT_*` 预算键同样是热键，在**每次调用时**
  解析，远程文档优先于调用点参数与代码常量。两个 sidecar 的 `*_API_KEY` 不在白名单，
  密钥仍只从 `.env` 读。
- 工具参数 schema 与执行侧夹紧读同一份快照：`buildToolDefinitions(names, budgets)` 每次
  构建时按当前预算生成 `maximum` 与描述里的 `(1-N)`，模型看到的窗口与服务端实际接受的
  窗口因此一致；发布更小的上限后，下一次请求即可生效。
- `ASSISTANT_NODE_TIMEOUT_MS`（默认 80s）是单个 agent 节点的整体上限，须大于该节点可能
  触发的最大工具预算（默认 65s）加模型超时（10s）。调大任一工具超时要同步调大本键，
  否则节点先取消，得到的是节点级失败而非工具级信封。
- `LIGHTRAG_ENABLED` / `SEMANTICA_ENABLED` 也可热关：关闭后下一次检索直接返回"未配置"
  信封，`GET /admin/dependencies` 同步反映当前发布值。

队列与餐食清扫家族的运行时覆盖：

- 12 个队列各有一个并发键，映射在 `src/common/queue/queue-runtime.registry.ts` 的
  `QUEUE_CONCURRENCY_KEYS`（类型上覆盖全部 `QUEUE_NAMES`，漏一个编译不过）。发布后
  直接改写运行中 worker 的 `concurrency`，不重建 Queue/Worker、不打断在跑的任务；
  进程重启后回到环境基线。默认值与代码声明一致：cron / report-summary /
  suggestion-explanation 为 2，suggestion-copy-generation 为 3，其余为 1。
- 邮件队列的 `MAIL_QUEUE_MAX_ATTEMPTS` / `BACKOFF_DELAY_MS` / 保留策略在**入队时**
  取快照：已入队任务保留它们创建时的值，只有新任务读新发布值。
- `MEAL_ANALYSIS_REAP_CRON` 变化时按 scheduler id 原地 `upsertJobScheduler`，旧计划
  同时被替换；重排失败只告警，原计划继续触发。`MEAL_ANALYSIS_STALE_AFTER_MS` /
  `REAP_BATCH_SIZE` 在每轮清扫开始时读取。

缓存家族的运行时覆盖：

- 四个 TTL（`MEDICINES_SEARCH_CACHE_TTL_MS` / `MEDICINES_DETAIL_CACHE_TTL_MS` /
  `MEDICINES_SAFETY_TIPS_CACHE_TTL_MS` / `ASYNC_JOB_RESULT_CACHE_TTL_MS`）在**写入
  缓存时**读取快照：已写入的条目保留它自己的寿命，不会被追溯修改；只有下一次 miss
  写入的条目用新值。想让新 TTL 立刻作用于存量数据，必须主动失效对应缓存。
- 药品缓存服务在启动时打一行 `Medicine cache TTLs in force: ...`，发版后可用它确认
  实际生效值；`cache.schema.ts` 的默认值与 `store.constants.ts`、`DEFAULT_RESULT_TTL_MS`
  保持一致，单测守漂移。
- 验证码、登录会话、分享令牌的 TTL 不在这一族：它们由签发/校验逻辑自己持有，属于
  正确性而非调参项。

认证、存储与应用元信息的运行时覆盖：

- 认证家族的七个键（验证码 TTL/冷却/限流窗口与上限/码长、OAuth state TTL、JWT 两个
  TTL）在**签发或校验的当次**读取快照：JWT 只影响新签发的令牌，已在客户端手里的
  access/refresh token 保留自身 `exp`；验证码只影响新码，已发出的码保留原 TTL。
  密钥（`JWT_*_SECRET`）不在白名单。
- `VERIFICATION_CODE_LENGTH` 允许 4-8：请求侧 DTO 因此接受 4-8 位数字而非固定 6 位，
  否则热改码长会让登录/改邮箱/重置密码的校验先拒绝用户刚收到的码。冷却时间若发布得比
  码 TTL 长，服务端按码 TTL 夹紧。
- 存储家族覆盖 bucket / region / `publicBaseUrl` / 签名有效期 / 上传上限；SecretId、
  AccessKey、endpoint 仍只从 `.env` 读。改动只影响**此后签出**的 URL 与上传：已写入
  的对象留在原 bucket，已签出的 URL 保留原有效期。S3 与 OSS 的 SDK 客户端在 bucket 或
  region 变化时惰性重建。
- 应用元信息四个键改为**逐请求**读取，`MIN_CLIENT_VERSION` / `DOWNLOAD_URL` 发布后
  下一次调用即返回新值；发布空字符串视为未配置，回退 `.env`。

运维家族的运行时覆盖：

- `LOG_LEVEL` 发布后立即改写 Winston 的 `logger.level` 与每个 transport 的级别，无需
  重启；启动时按 `NODE_ENV` 解析出的级别是基线。
- `SLOW_REQUEST_THRESHOLD_MS` / `SLOW_QUERY_THRESHOLD_MS` 在**每次观测**读取快照：
  改动只影响之后的请求与查询，已记录的慢日志不受影响。
- `METRICS_ENABLED` 逐次判定：关闭后 `/metrics` 返回 404，各 `record*` 调用变成空操作；
  重新打开时默认采集器无需再次启动（见上文 `METRICS_ENABLED`）。
- `THROTTLE_TTL_MS` / `THROTTLE_LIMIT` 在每个请求进入限流 guard 时读取快照；Redis 里
  已存在的计数键保留原窗口，新值从下一次计数开始生效。路由级 `@Throttle(...)` 的
  更严格设置仍然优先。

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

**Neo4j 容器由编排提供**（图库机 `compose.graph.yaml`；本地 dev 在
`compose.dev.yaml` 的 `neo4j-dev`）：

```text
NEO4J_PASSWORD  # 必填（按 :?required 硬失败）；同时用于 NEO4J_AUTH 与健康探针
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

> **`semantica` 服务**定义在 `compose.graph.yaml`（图库机）与 `compose.dev.yaml`
> （本地，profile 门控）里。它**不在主站的 `compose.yaml` 里** —— 分文件后主站的
> `docker compose up -d` 看不到它，不需要再用 profile 防止误起
> （拆分理由见 `docs/reference/deployment.md` 与 ADR-0023 的 2026-10-12 修订）。

Observability:

```text
LOG_LEVEL
LOG_FORMAT
SLOW_REQUEST_THRESHOLD_MS
SLOW_QUERY_THRESHOLD_MS
METRICS_ENABLED
THROTTLE_TTL_MS
THROTTLE_LIMIT
METRICS_USER
METRICS_PASSWORD
OTEL_ENABLED
OTEL_EXPORTER_OTLP_ENDPOINT
OTEL_METRICS_EXPORTER
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
- `SLOW_QUERY_THRESHOLD_MS` — Prisma queries exceeding this duration (in ms) emit a
  `warn` log. Default: `500`. Range: 10–600000.
- `METRICS_ENABLED` — enable/disable Prometheus metrics collection (`prom-client`).
  Default: `true`. Set to `false` in test environment. When enabled, the `/metrics`
  endpoint exposes Prometheus exposition format for scraping. Default collectors are
  registered at bootstrap even when disabled, so enabling the switch later takes
  effect on the next scrape without a restart. See ADR-0006 for the full
  observability strategy.
- `THROTTLE_TTL_MS` — global rate-limit window in ms. Default: `60000`.
  Range: 1000–3600000.
- `THROTTLE_LIMIT` — requests allowed per window per client. Default: `100`.
  Range: 1–1000. Route-level `@Throttle(...)` overrides still win over this value.
- `METRICS_USER` — Basic Auth username for `/metrics`. When set together with
  `METRICS_PASSWORD`, the `/metrics` endpoint requires HTTP Basic Auth.
- `METRICS_PASSWORD` — Basic Auth password for `/metrics`. Must be set together
  with `METRICS_USER`.
- `OTEL_ENABLED` — **默认开启**：未设置即启动 OpenTelemetry SDK，仅显式 `false` 时关闭。
  开启后自动插桩 HTTP/DB/Redis **与 Prisma query**（`@prisma/instrumentation`）；所有日志
  带 `trace_id` / `span_id`。BullMQ Worker 与 Cron Job span 由 `bullmq-otel` 遥测产生，
  异步任务日志同样带 `trace_id`。默认值在 `src/tracing.ts`（在 ConfigModule 之前运行、
  读裸 `process.env`）与校验层（`z.enum(['true','false']).default('true')`）**两处必须
  一致**。未起 collector 时导出失败走静默丢弃路径，不阻断业务。见 ADR-0010。
- `OTEL_EXPORTER_OTLP_ENDPOINT` — OTLP HTTP trace reporting endpoint. Default:
  `http://127.0.0.1:4318/v1/traces` (local Jaeger all-in-one port 4318). 仅在 tracing
  启用（`OTEL_ENABLED` 非 `false`）时使用。导出失败会被静默丢弃（不影响主流程）。
  In development, the endpoint points to the Jaeger all-in-one container
  (`compose.dev.yaml`). See ADR-0016 Decision 3 for the trace backend strategy.
  **生产指向 VictoriaTraces（阿里云）时路径不是标准的 `/v1/traces`**：
  该服务的 OTLP/HTTP 端点是 `/insert/opentelemetry/v1/traces`，端口 10428：
  `http://<阿里云公网IP>:10428/insert/opentelemetry/v1/traces`。
- `OTEL_METRICS_EXPORTER` — OTel SDK 的标准变量，**Lucent 自己不读**（不在 zod 校验层里），
  由 `src/tracing.ts` 里的 `NodeSDK` 解析。默认值是 `otlp`，此时 SDK 会把
  `OTEL_EXPORTER_OTLP_ENDPOINT` 当**基地址**再拼 `/v1/metrics`：生产端点已带非标准路径，
  拼出来是 `/insert/opentelemetry/v1/traces/v1/metrics`，VictoriaTraces 每分钟回一条
  `unsupported path`（2026-10-07 实测）。Lucent 的应用指标走 prom-client 的 `/metrics`
  由 VictoriaMetrics 抓取，与 OTLP 指标无关 —— 所以生产填 `none`。
- `OTEL_TRACES_SAMPLER` — trace 采样器，取 OTel 规范的标准取值：`always_on` /
  `always_off` / `traceidratio` / `parentbased_always_on` / `parentbased_always_off` /
  `parentbased_traceidratio`。`src/tracing.ts` **不传** `sampler`，NodeSDK 因此走
  `createSamplerFromEnv()` 读这两个变量（**已实测生效**，见 `src/tracing.spec.ts`）——
  所以**改采样率只需重启，不必改代码或重建镜像**。它同时是 **Prisma query span 的体积
  过滤手段**：Prisma 插桩默认每个 query 一个 span，默认开启后写入量放大，靠采样率收敛。
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

### rnacos — 运行时配置中心（可选）

环境变量仍是**唯一基线**：进程启动时先由 env 构建一份运行时快照，rnacos 只是叠在
它之上的可选层。缺键、空值、校验失败、中心不可达都回落到基线，配置中心因此**不是
启动依赖**（`RNACOS_ENABLED=false` 时零网络调用、不加载原生模块）。

```text
RNACOS_ENABLED
RNACOS_SERVER_ADDR
RNACOS_NAMESPACE
RNACOS_GROUP
RNACOS_DATA_ID
RNACOS_USERNAME
RNACOS_PASSWORD
RNACOS_REQUEST_TIMEOUT_MS
```

- `RNACOS_ENABLED` — 默认 `false`。只有显式 `true` 才构造客户端。
- `RNACOS_SERVER_ADDR` — `host:port`，**必须写 HTTP 端口（8848）**：SDK 先从它登录
  再自行连 gRPC（`+1000`，即 9848）；写 gRPC 或控制台端口都会构造失败。
- `RNACOS_NAMESPACE` / `RNACOS_GROUP` / `RNACOS_DATA_ID` — 默认
  `lucent-dev` 系 / `LUCENT_RUNTIME` / `lucent-runtime-tuning.txt`。namespace 需要
  在 rnacos 侧先建好，否则读到的只是「配置不存在」。
- `RNACOS_USERNAME` / `RNACOS_PASSWORD` — 与应用同源的控制台凭据。**只进适配器构造
  参数，不进快照、不进日志**（错误消息与日志里的口令、token 会被替换成 `***`）。
- `RNACOS_REQUEST_TIMEOUT_MS` — 100–60000，默认 `5000`。绑定层没有超时参数，这里用
  `Promise.race` 只约束首次 `getConfig` 与订阅注册（不取消底层调用），避免中心无响应
  时拖住启动。

**冷启动与在线状态**：启动时先做一次 TCP 探活。可达时客户端**不读**磁盘缓存，避免把
上次的旧文档当成远端值应用；只有探活失败才启用 `configLoadCacheAtStart` 并把快照标成
`local-cache`。订阅建立后每 30 秒复探一次：断开时打一条告警（进程继续用最后快照），
恢复时打一条提示。

**文档格式与可覆盖范围**：发布的文档是 `.env` 子集（键名沿用环境变量名），模板与逐键
说明见 `docs/reference/runtime-config.example.txt`。可被远程覆盖的键按家族分组：AI 与
提示词、检索与助手预算、队列与餐食清扫、缓存、认证/存储/应用元信息、运维（日志、慢阈值、
指标、限流）；完整键集以模板为准，`docs:verify` 校验它与 schema 的字段集合完全一致。
只有白名单内的非密钥热键可被覆盖，白名单外的键（密钥、连接串、provider 装配开关）会让
**整份文档被拒绝**，进程继续用上一份快照。加载、校验、快照替换与回退的完整语义见
`docs/explanation/runtime-config-lifecycle.md`。回退靠发布新版本或删字段（删字段即回落 env 基线），**不要用「删除配置」**：
rnacos 删除后不再推送该 dataId，需重启中心才恢复。

**密钥与连接串一律不进配置中心**——它们只由 `.env` 负责，配置中心不承担密钥托管职责。
本地起中心见 `compose.dev.yaml` 的 `rnacos` 服务（`pnpm dev:stack rnacos`，profile
`rnacos`，需先 `export RNACOS_CONSOLE_PASSWORD`）；容器部署时 `~/nacos`（客户端磁盘
缓存）与 `~/logs/nacos`（SDK 日志）需挂卷，并设 `NACOS_CLIENT_LOGGER_LEVEL=ERROR`。

**启动耗时标定（本机 v0.8.7 + binding 0.8.0 实测）**：中心在线时构造客户端与首次加载
都在百毫秒级；中心**不可达**时构造是阻塞调用，约 19s（无本地缓存）/ 38s（有缓存）才
返回，随后 `getConfig` 交回磁盘旧值（快照标 `local-cache`）。`RNACOS_REQUEST_TIMEOUT_MS`
只约束 `getConfig` 与订阅注册，**管不到构造**——所以「启用但中心不在线」会让启动明显变慢
（进程照常起来，值仍是 env 基线或缓存旧值，不是启动失败）。
