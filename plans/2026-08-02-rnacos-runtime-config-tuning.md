---
status: active
owner: backend
---

# rnacos 动态运行时配置与调优实施计划

> 2026-08-02 起草；**2026-10-19 重开并重写**。
>
> **重开理由**：2026-08-16 功能盘点把本计划降级为「环境变量 + 重启」，触发条件是
> 「离线评测流程存在，且证明参数需要以天为粒度频繁调整」。该前置未成立即重开，是
> **主动决策**：管理面板（2026-10-18）已裁决运行时配置归 rnacos、不进 admin 面，
> 且部署已收敛为三机 Compose（ADR-0023），配置中心的基础设施成本从「新增一套系统」
> 降为「多一个 10MB 容器」。**2026-08-16 的降级裁决就此撤销**，本文件重新成为执行源。
>
> 三个事实变化让原计划必须重写：
>
> 1. **餐食识别 matcher 已删除**（ADR-0020 改为多模态直出），原计划的份量/营养阈值
>    热更新对象不存在了；餐食侧可调项只剩 vision 的模型、温度、重试、超时与提示词，
>    其余可调项按 §1 的家族盘点。
> 2. **NestJS 12 / ESM / Node ≥26 / Zod 4**（原计划写 11 / Node 24），测试命令与
>    模块写法需按现状写；`docs:check` 已退役，改为 `docs:verify` + `docs:links`。
> 3. **接入方式改为 Nacos 2.x gRPC 长连接**（2026-10-19 裁决）：
>    `nacos@2.6.3` 只实现 1.x HTTP 协议（含长轮询），不满足要求；Node 侧没有官方
>    gRPC SDK，故采用官方 `nacos-sdk-rust` 的 NAPI 绑定
>    `nacos-sdk-rust-binding-node@0.8.0`，由它在 gRPC 长连接上做配置订阅。
>    代价是原生模块（预编译多平台二进制）与第三方绑定维护风险。

**Goal:** 在不重启 Lucent 进程的前提下调整全部非密钥、可热生效的参数（AI 角色与
提示词、检索预算、队列并发与重试、缓存 TTL、认证/存储 TTL、应用元信息、运维阈值）；
环境变量仍是唯一基线，rnacos 只是可选的叠加层。

**Architecture:** `RuntimeConfigService` 持有经 Zod 校验的不可变快照与版本号。
启动时由环境变量解析出基线快照；`RNACOS_ENABLED=true` 时由一个
`RuntimeConfigSource` 适配器用 `nacos-sdk-rust-binding-node`（`nacos-sdk-rust` 的
NAPI 绑定，**Nacos 2.x gRPC 长连接**）拉取并 `addListener` 监听文档，只有整份校验
通过才原子替换快照。业务代码只依赖快照端口，不接触 rnacos，也不接触原生模块。

**Tech Stack:** NestJS 12（ESM）、Node ≥26、Zod 4、BullMQ 5、
`nacos-sdk-rust-binding-node@0.8.0`（napi，CJS + 预编译二进制）、`@nestjs/cache-manager`、
Vitest、Docker Compose、rnacos（`qingpan/rnacos`）。

---

## 0. 与既有决策的关系

| 决策                               | 与本计划的关系                                                                                                                                 |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR-0018（配置文件回退纯环境变量） | **继续有效**。环境变量是唯一基线与兜底；本计划只把「每次调用读取即可生效」的非密钥项做成远程叠加层，不恢复本地配置文件，也不把密钥搬进配置中心 |
| 管理面板计划（2026-10-18，已归档） | 管理面**不做**配置读写；`GET /admin/dependencies` 只暴露 sidecar 开关。配置编辑入口是 rnacos 控制台                                            |
| ADR-0023（三机 Compose 部署）      | rnacos 作为主站上的一个 sidecar 容器，8848/9848/10848 对宿主开放，防火墙只放行受信来源                                                         |
| 微服务计划（2026-10-18，未开工）   | 本计划**不新增 ADR**：配置中心只是 ADR-0018 之上的实现细节，不足以单独立档；微服务计划预留的编号不动                                           |

**不新立 broker、不做服务注册。** rnacos 只承担配置中心角色，注册中心能力不用。

## 1. 当前基线（2026-10-19 核对代码）

配置加载链路：`src/app.module.ts:87` 的 `ConfigModule.forRoot({ isGlobal: true,
validationSchema: validatedEnvSchema })` → `src/config/env/environment.validation.ts`
的 `envSchema`（Zod）→ 各 `registerAs` 配置服务从 `process.env[EnvKey.X]` 取值
（`src/config/env/env-keys.enum.ts` 是键的唯一声明处，共 139 个）。

调优面现状（按家族；非密钥、能在运行时生效的都进配置中心）：

| 家族           | 现有调优项                                                                                                                                                                                         | 现在怎么改               |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| AI / 提示词    | 5 个角色的 `model/baseUrl/thinking`（`config/services/llm.config.ts`）、温度/重试/超时（`vision.service.ts:74-78`、`llm-runtime.service.ts:66`）、`AI_SAFETY_FORBIDDEN_PATTERNS`、9 个 prompt 文件 | env + 重启 / 改代码发版  |
| 检索与助手预算 | LightRAG、Semantica 的 `enabled/baseUrl/timeout/graphSources/workspaces`、`*_MAX_LIMIT`（8/100/20000）、工具超时（20s/45s/65s）、节点超时、记忆抽取超时                                            | env + 重启 / 改代码发版  |
| 队列           | 12 个队列的并发（`queue.factory.ts:158`）、mail 的 attempts/backoff/retention、餐食 sweeper 的 stale/batch/cron                                                                                    | env + 重启 / 改代码发版  |
| 缓存           | 药品搜索 5m / 详情 15m / 安全贴士 30m（`medicines/cache/store.constants.ts`）、异步结果 30m（`base-async-queue.service.ts:9`）                                                                     | 改代码发版               |
| 认证与投递     | 验证码 TTL/冷却/频率/长度、OAuth state TTL、JWT access/refresh TTL、存储签名过期与上传上限（COS/OSS/S3）                                                                                           | env + 重启（部分读一次） |
| 应用元信息     | `SUPPORT_EMAIL/MIN_CLIENT_VERSION/LATEST_VERSION/DOWNLOAD_URL`（`app-info/services/info.service.ts` 构造时快照）                                                                                   | env + 重启               |
| 运维           | `LOG_LEVEL`（启动时定）、慢请求 1s、慢查询阈值、限流 60s/100 次（`throttler.config.ts:99` 硬编码）、`METRICS_ENABLED`                                                                              | env + 重启 / 改代码发版  |

队列全集见 `src/common/queue/queue-names.ts`（12 个）。**热更新并发的前提是给
`QueueCreateOptions` 增加稳定的运行时键**，不能靠队列名字符串推断。

## 2. 配置契约（v3，.env 子集）

远程文档是 `.env` 的一个子集：**同一个键名、同一种写法**，只允许白名单内的
可热更新项。不另造命名空间，也不引新格式。

- `dataId`: `lucent-runtime-tuning.txt`
- `group`: `LUCENT_RUNTIME`
- `namespace`: 显式 ID（`lucent-dev` / `lucent-test` / `lucent-prod`）
- 内容类型: `text`（纯文本，服务端不解析）

**为什么沿用 env 写法**：运维已经熟悉 `KEY=value` + 上方注释，不用记第二套规则。
远程文档只解决「不重启改值」，不是第二套配置体系。

**只收热键**：只允许「改了立刻生效」的键。连 `DATABASE_URL`、密钥、provider
开关这类下次启动才生效的项也不收——它们放回来只会诱导运维在控制台改完却看不到
效果，仍由 `.env` 负责。

**白名单之外一律拒绝**：包括 `DATABASE_URL`、`JWT_ACCESS_SECRET`、`*_API_KEY`
等；密钥不会因为误贴整份 env 而进 rnacos。未知键整份拒绝（防拼写错误）。

**允许的键**（`*` = 本计划新增的 env 键，其余现已存在；这就是完整白名单）：

```text
# AI：角色模型、地址、采样与思考开关
AI_{ANALYSIS,VISION,LANGUAGE,CHAT,CHAT_COMPRESSION}_{MODEL,BASE_URL,THINKING}
AI_{ANALYSIS,VISION,LANGUAGE,CHAT,CHAT_COMPRESSION}_{TEMPERATURE,MAX_RETRIES,TIMEOUT_MS}  *
AI_EMBEDDING_{MODEL,BASE_URL}
AI_SAFETY_FORBIDDEN_PATTERNS

# 提示词（值内换行写 \n）
PROMPT_{ASSISTANT_SYSTEM,INTENT_ROUTER,MEAL_ANALYSIS_SYSTEM,MEAL_ANALYSIS_USER,RISK_CHECK,REPORT_SUMMARY,TODAY_ANALYSIS,SUGGESTION_COPY,SUGGESTION_EXPLANATION}  *

# 检索与助手预算
LIGHTRAG_{ENABLED,BASE_URL,TIMEOUT_MS,GRAPH_TIMEOUT_MS,GRAPH_SOURCES,WORKSPACE_LEAFLET,WORKSPACE_QA}
LIGHTRAG_MAX_LIMIT  *
SEMANTICA_{ENABLED,BASE_URL,TIMEOUT_MS}
SEMANTICA_{MAX_LIMIT,REASON_MAX_LIMIT}  *
ASSISTANT_VECTOR_MAX_LIMIT  *
ASSISTANT_{TOOL,ONTOLOGY_TOOL,RETRIEVAL_TOOL,NODE,MEMORY_EXTRACTION}_TIMEOUT_MS  *

# 餐食
MEAL_ANALYSIS_{VISION_TIMEOUT_MS,STALE_AFTER_MS,REAP_BATCH_SIZE,REAP_CRON}  *

# 队列（mail 沿用已有键，其余 11 个新增）
QUEUE_{CRON,REMINDER_DISPATCH,MEAL_ANALYSIS,DATA_EXPORT,MEDICINE_RECOGNITION,TODAY_ANALYSIS,CLINIC_SUMMARY_PDF,REPORT_SUMMARY,SUGGESTION_COPY_GENERATION,SUGGESTION_EXPLANATION,SUGGESTION_RECOMPUTE}_CONCURRENCY  *
MAIL_QUEUE_{WORKER_CONCURRENCY,MAX_ATTEMPTS,BACKOFF_DELAY_MS,COMPLETE_AGE_SECONDS,FAIL_AGE_SECONDS,COMPLETE_MAX_COUNT,FAIL_MAX_COUNT}

# 缓存
MEDICINES_{SEARCH,DETAIL,SAFETY_TIPS}_CACHE_TTL_MS  *
ASYNC_JOB_RESULT_CACHE_TTL_MS  *

# 认证
VERIFICATION_{CODE_TTL_MS,COOLDOWN_MS,RATE_LIMIT_WINDOW_MS,RATE_LIMIT_MAX,CODE_LENGTH}
OAUTH_STATE_TTL_MS
JWT_{ACCESS_TTL,REFRESH_TTL}

# 存储（只覆盖非密钥项）
TENCENT_COS_{UPLOAD_EXPIRES_SECONDS,MAX_UPLOAD_BYTES,DOWNLOAD_EXPIRES_SECONDS,PUBLIC_BASE_URL,BUCKET,REGION}
ALIYUN_OSS_{UPLOAD_EXPIRES_SECONDS,MAX_UPLOAD_BYTES,DOWNLOAD_EXPIRES_SECONDS,PUBLIC_BASE_URL,BUCKET,REGION}
STORAGE_S3_{UPLOAD_EXPIRES_SECONDS,MAX_UPLOAD_BYTES,DOWNLOAD_EXPIRES_SECONDS,PUBLIC_BASE_URL,BUCKET,REGION}

# 元信息与运维
SUPPORT_EMAIL
MIN_CLIENT_VERSION
LATEST_VERSION
DOWNLOAD_URL
LOG_LEVEL
SLOW_REQUEST_THRESHOLD_MS
SLOW_QUERY_THRESHOLD_MS
METRICS_ENABLED
THROTTLE_{TTL_MS,LIMIT}  *
```

**示例**（节选；完整版是带注释的运维模板）：

```text
# 空值 = 沿用环境变量基线；未出现的键同样沿用基线。
RNACOS_SCHEMA_VERSION=3
RNACOS_REVISION=2026-10-19.1

# 餐食视觉模型。留空用 AI_VISION_MODEL。
AI_VISION_MODEL=

# 温度 0-2。识别任务保持 0.1 左右，调高会开始编造份量。
AI_VISION_TEMPERATURE=0.1
AI_VISION_MAX_RETRIES=0
AI_VISION_TIMEOUT_MS=20000

# 助手检索开关。false 时工具返回「不可用」，不报错。
LIGHTRAG_ENABLED=
LIGHTRAG_MAX_LIMIT=8
LIGHTRAG_GRAPH_SOURCES=leaflet

# 多行提示词用
；必须保留 {{language}} 占位符，日志只记 hash。
PROMPT_MEAL_ANALYSIS_SYSTEM=你是营养分析助手，请用 {{language}} 回答。
只输出结构化结果，不要解释。

QUEUE_MEAL_ANALYSIS_CONCURRENCY=1
MEDICINES_SEARCH_CACHE_TTL_MS=300000
THROTTLE_LIMIT=100
```

**格式规则**（解析器逐条实现并测试）：

1. `.env` 语法：`KEY=value`，`#` 注释只认行首（允许前导空白），空行忽略；
   **行内 `#` 不是注释**（URL、提示词里可能有）。
2. 键名必须匹配 `[A-Z][A-Z0-9_]*`；白名单（含两个保留键
   `RNACOS_SCHEMA_VERSION`/`RNACOS_REVISION`）之外的键 → 整份拒绝（密钥、连接串
   同样被拒）。
3. 重复键 → 整份拒绝（不取最后一个）。
4. 空值等价于「不设置」，回退基线；不解释成 0 或空串。
5. 数组用逗号分隔（与 `CORS_ORIGIN` 一致）；元素去首尾空白，不允许空元素。
6. 布尔只接受 `true`/`false`；整数必须安全整数；非法类型 → 整份拒绝。
7. 提示词用 `\n` 表示换行；上限 8000 字符，且必须保留该 prompt 声明的
   占位符（如 `{{language}}`），缺失 → 整份拒绝。
8. 数值上下限：温度 `[0,2]`、重试 `[0,5]`、超时 `[1000,300000]`、并发 `[1,20]`、
   TTL `[1s,30d]`（JWT refresh 上限 `90d`）、验证码长度 `[4,8]`、
   限流 `limit [1,1000]`、`ttl [1s,1h]`。
9. 文档上限 256 KiB；版本号由 `RNACOS_SCHEMA_VERSION` 与 `RNACOS_REVISION`
   两个保留键给出，前者必须为 3。
10. 缺键/空值回退启动基线；远程不可用时保留最后一份有效快照；启动不依赖
    rnacos 可用性。
11. 快照深度冻结；内部版本号形如 `<RNACOS_REVISION>#<seq>`。快照内不含密钥，
    可安全序列化进日志。
12. 首版不提供 `public` 命名空间回退：`RNACOS_NAMESPACE` 必须显式配置。

**注释就是运维文档**：正式发布的示例文件
`docs/reference/runtime-config.example.txt` 按 `.env.*.example` 的标准写——每个
键上方注明「是什么 / 控制什么 / 默认值与范围 / 什么时候该改」，危险项加 `⚠️`
（限流下限、提示词占位符、bucket 切换、日志级别降噪）。示例文件必须能通过同一套
schema 校验，由 `docs:verify` 防漂移；键增删时示例与 schema 同一次提交改完。

## 3. 热更新边界

| 类别                   | 处理          | 本计划纳入                                                                                                                            |
| ---------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 每次调用读取即可生效   | 热更新        | AI 角色参数与提示词、检索开关/超时/上限、缓存 TTL、验证码与 OAuth TTL、JWT TTL、存储签名参数、应用元信息、慢请求/慢查询阈值、日志级别 |
| 已创建对象支持安全变更 | 热更新 + 钩子 | BullMQ `worker.concurrency`、限流 guard 取值、`METRICS_ENABLED`（按请求判定）                                                         |
| 连接/启动期配置        | **不进中心**  | `DATABASE_URL`、`REDIS_URL`、全部密钥与凭据、Cache store 类型、存储 provider、mail driver、端口、CORS、`OTEL_*`、模块装配开关         |
| 进程引导               | **不进中心**  | `RNACOS_*`、`NODE_ENV`、`OPENAPI_EXPORT_*`                                                                                            |

---

## 4. Task 0：SDK 兼容 spike 与裁决（先做，不做完不进 Task 1）

**目的**：把「gRPC 绑定能否连上 rnacos」固定成文档事实，避免适配器写完才发现不兼容。

**rnacos 侧事实（2026-10-19 查上游 README）**：

- 镜像 `qingpan/rnacos:stable`（生产请钉具体版本号，不用 `stable`）。
- 端口：`8848` HTTP / **`9848` gRPC** / `10848` 独立控制台；数据目录容器内 `/io`
  （`RNACOS_DATA_DIR` 自 0.6.x 起可改）。
- 控制台默认账号 `admin/admin`，可用 `RNACOS_INIT_ADMIN_USERNAME/PASSWORD` 改
  （仅首次启动生效）；**不可长期留默认密码**。
- API 鉴权默认**关闭**，需 `RNACOS_ENABLE_OPEN_API_AUTH=true` 开启；
  `RNACOS_CONSOLE_LOGIN_ONE_HOUR_LIMIT`（默认 5 次）与 `RNACOS_API_LOGIN_TIMEOUT`
  （默认 3600s）决定锁定与 token 有效期。
- 支持 Nacos 1.x HTTP OpenAPI 与 **2.x/3.x gRPC**；配置历史/导入导出可用，
  **不支持灰度发布与 tag 隔离**。

**绑定侧事实（2026-10-19 核对 `nacos-sdk-rust-binding-node@0.8.0`）**：

- `nacos-sdk-rust` 是 nacos-group 官方 Rust SDK；本包是社区 NAPI 绑定
  （`opc-source`，MIT），README 明示「nacos-sdk-nodejs 暂无 2.x gRPC，故用 addon 调 rust SDK」。
- API：`new NacosConfigClient({ serverAddr, namespace, username, password, appName,
configLoadCacheAtStart })`；`getConfig` / `getConfigResp` / `addListener` /
  `removeListener` / `publishConfig` / `removeConfig`。
- **`serverAddr` 是 `host:port` 且必须指向 gRPC 端口（9848）**，不是 HTTP 的 8848。
- **无 `close()`/`shutdown()`**：客户端内部持有长连接直至进程退出；
  `removeListener` 的 d.ts 注释写明实际是 no-op（「不移除也不是大问题」）。
- `configLoadCacheAtStart` 默认 `false`；**必须保持 false**，否则会用磁盘缓存
  覆盖 env 基线语义。
- 预编译二进制覆盖 `x86_64-unknown-linux-musl`（Alpine 镜像可用）、`linux-gnu`、
  `darwin`、`win32-*`；安装走 optionalDependencies，**不需要构建脚本**，
  与 Dockerfile 的 `--ignore-scripts` 兼容。
- 日志默认 INFO，写 `$HOME/logs/nacos/`；级别用 `NACOS_CLIENT_LOGGER_LEVEL`，
  线程数用 `NACOS_CLIENT_COMMON_THREAD_CORES`（默认 1）。

**待验证（每条给出实际命令与输出，结论追加为 Task 0 末尾的表格）**：

1. **连通性**：`serverAddr` 指向 `127.0.0.1:9848` 能 `getConfig` 成功；指向 8848
   必须失败（确认端口语义，避免部署时错配）。
2. **ESM 互操作**：NestJS 12（ESM + SWC）下 `import { NacosConfigClient } from
'nacos-sdk-rust-binding-node'` 的行为；原生模块通常需要
   `createRequire(import.meta.url)`，这一层只出现在适配器内。
3. **鉴权**：`RNACOS_ENABLE_OPEN_API_AUTH=true` 时 `username`/`password` 生效；
   错误密码的失败形态与耗时；确认错误消息不含密码。
4. **命名空间**：`namespace` 传 ID 还是名称；控制台建 namespace 时 ID 是否可自定义
   （决定 §2 的 `lucent-dev` 等 ID 是否可行）。
5. **订阅语义**：`addListener` 在 rnacos 上是否即时推送（gRPC 长连接）；断线重连后
   是否补推；配置被删除时回调内容；**监听器不可移除**对测试与热替换的影响。
6. **本地缓存**：`configLoadCacheAtStart=false` 时进程重启是否仍读磁盘；
   确认不会用磁盘旧值覆盖 env 基线。
7. **镜像内可用**：`docker build` 后的 Alpine 镜像里 `require` 该包能加载
   `.node`（`pnpm install/prune --ignore-scripts` 不破坏 optionalDependencies）。

**门禁**：七项验证结论回写本文件；绑定与 rnacos 不兼容时**停下来重新裁决**
（换 `@grpc/grpc-js` + `@nacos-group/sdk-proto` 自建最小客户端 / 换配置中心 /
退回纯 env），不得在适配器里偷偷改回 HTTP 轮询。**spike 通过前不写业务代码。**

## 5. Task 1：运行时配置类型、schema 与快照服务

**Files:**

- Create: `src/config/runtime/runtime-config.types.ts`
- Create: `src/config/runtime/runtime-config.schema.ts`（组合各家族 schema）
- Create: `src/config/runtime/schema/`（`ai` / `retrieval` / `queue` / `cache` / `auth` / `storage` / `app-info` / `ops`，Task 3–8 逐个填入）
- Create: `src/config/runtime/runtime-config.baseline.ts`（env → 基线快照）
- Create: `docs/reference/runtime-config.example.txt`（带字段注释的运维模板）
- Create: `src/config/runtime/runtime-config.service.ts`
- Create: `src/config/runtime/runtime-config.service.spec.ts`
- Create: `src/config/runtime/runtime-config.module.ts`
- Modify: `src/app.module.ts`
- Modify: `src/config/env/env-keys.enum.ts`
- Modify: `src/config/env/environment.validation.ts`
- Modify: `.env.development.example`
- Modify: `.env.test.example`
- Modify: `.env.production.example`

- [ ] **Step 1: 先写失败测试**

覆盖：启动基线来自环境变量；合法文档原子替换快照；语法错误、未知键、重复键、
版本不符均保持旧快照且版本不前进；缺键/空值回退基线而非零值；订阅者只在校验通过后
收到通知；单个订阅者抛错不影响其他订阅者；`getSnapshot()` 返回值被冻结（尝试改写必须抛错）；
远程不可用时不阻断启动；错误消息与日志不含值。

- [ ] **Step 2: 跑目标测试确认失败**

```bash
pnpm exec vitest run src/config/runtime/runtime-config.service.spec.ts
```

- [ ] **Step 3: 实现最小端口**

```typescript
export interface RuntimeConfigPort {
  getSnapshot(): Readonly<RuntimeConfigSnapshot>;
  getVersion(): string;
  applyDocument(raw: string): RuntimeConfigApplyResult;
  subscribe(listener: RuntimeConfigListener): () => void;
}

export type RuntimeConfigApplyResult =
  | { ok: true; version: string; changed: string[] }
  | {
      ok: false;
      reason:
        | 'invalid_syntax'
        | 'invalid_schema'
        | 'unsupported_version'
        | 'duplicate_key';
    };
```

`applyDocument` 顺序固定：逐行解析 → Zod 校验 → 合并基线 → 冻结 → 替换引用 →
通知。**返回判别联合而非抛异常**（与项目 Result 边界一致，ADR-0012）。
解析器不引第三方依赖：按 §2 的 12 条规则实现，测试覆盖行首/行内 `#`、重复键、
未知键、空值回退、布尔与整数解析、CSV 列表、提示词占位符。

`RuntimeConfigModule` 标 `@Global()`，但 Task 1 不连 rnacos。

- [ ] **Step 4: 增加启动配置并跑测试**

```text
RNACOS_ENABLED=false
RNACOS_SERVER_ADDR=127.0.0.1:9848
RNACOS_NAMESPACE=lucent-dev
RNACOS_GROUP=LUCENT_RUNTIME
RNACOS_DATA_ID=lucent-runtime-tuning.txt
RNACOS_USERNAME=
RNACOS_PASSWORD=
RNACOS_REQUEST_TIMEOUT_MS=5000
```

本计划新增的调优键（§2 中带 `*`）一并进 `EnvKey` 与 `environment.validation.ts`，
默认值等于现状代码常量；提示词键可选，缺省走代码里的 prompt。

凭据只进 `RuntimeConfigSource` 构造参数，**不进快照、不进日志**。`environment.validation.ts`
里 `RNACOS_*` 全部可选，`RNACOS_ENABLED=true` 时才对 `SERVER_ADDR`（必须是
`host:port`，且端口应等于 gRPC 端口）与凭据做跨字段校验。
`RNACOS_REQUEST_TIMEOUT_MS` 只约束首次 `getConfig`（绑定无超时参数，用 `Promise.race`
包一层，超时后保留基线；不取消底层调用）。

```bash
pnpm exec vitest run src/config/runtime
pnpm typecheck
```

## 6. Task 2：gRPC 适配器与本地可选服务

**Files:**

- Create: `src/config/runtime/runtime-config-source.ts`
- Create: `src/config/runtime/rnacos-config-source.ts`
- Create: `src/config/runtime/rnacos-config-source.spec.ts`
- Modify: `src/config/runtime/runtime-config.module.ts`
- Modify: `compose.dev.yaml`
- Modify: `scripts/dev/up-local-stack.ts`
- Modify: `docs/reference/environment-variables.md`

- [ ] **Step 1: 引入依赖**

```bash
pnpm add nacos-sdk-rust-binding-node@0.8.0
```

钉死版本：原生模块 + 社区绑定，升级需人工复核（对照 `nacos-sdk-rust` 版本）。
安装后确认 `pnpm lint:check` / `pnpm arch:check` / `pnpm build` / 镜像构建均正常；
`knip` 不应把它报成未使用。**不要**打开 postinstall 脚本（包本身不需要）。

- [ ] **Step 2: 写适配器测试（mock 客户端，不启真实服务、不加载原生模块）**

覆盖：加载成功；配置不存在（空串或抛错）→ `null`；`getConfig` 抛错 → `load()`
拒绝且进程不崩；`addListener` 触发 `watch` 回调；`watch()` 返回的取消函数**至少**
停止向订阅者分发（底层监听无法移除，见 Task 0 结论 5）；`close()` 只做本地清理；
密码与 token 不出现在日志与错误 message 中；`configLoadCacheAtStart` 恒为 `false`。

- [ ] **Step 3: 实现适配器**

```typescript
export interface RuntimeConfigSource {
  load(): Promise<unknown | null>;
  watch(onDocument: (document: unknown) => void): Promise<() => void>;
  close(): Promise<void>;
}
```

适配器内部只做四件事：构造 `NacosConfigClient`（`serverAddr` 指向 gRPC 端口，
凭据来自启动配置，`configLoadCacheAtStart: false`）、`getConfig` 桥接成 `load()`、
`addListener` 桥接成 `watch()`、本地取消订阅。**ESM 互操作兜底放在这一层**
（`createRequire`），业务代码不感知原生模块。远程源失败只记结构化告警并保留本地
快照，**不得让 API 进程退出**；重连交给 rust SDK，不自建退避循环。

- [ ] **Step 4: 接入生命周期**

`RuntimeConfigService.onApplicationBootstrap` 先做一次加载（超时上限
`RNACOS_REQUEST_TIMEOUT_MS`，失败只告警），再进入监听。`onModuleDestroy` 调用 `close()` 做本地清理（SDK 无 shutdown，长连接随
进程结束）。未开启 `RNACOS_ENABLED` 时零网络调用、不加载原生模块。

- [ ] **Step 5: 本地可选服务**

`compose.dev.yaml` 增加 `rnacos` 服务，放在独立 profile（只有显式
`pnpm dev:stack rnacos` 才启动，默认服务列表保持不变），**同时暴露 8848 与 9848**
（gRPC 必须可达）：

```yaml
rnacos:
  image: qingpan/rnacos:${RNACOS_IMAGE_TAG:?pin a version}
  profiles: ['rnacos']
  ports:
    - '8848:8848'
    - '9848:9848'
    - '10848:10848'
  volumes: ['rnacos-data:/io']
  environment:
    RNACOS_INIT_ADMIN_USERNAME: ${RNACOS_CONSOLE_USER:-rnacos}
    RNACOS_INIT_ADMIN_PASSWORD: ${RNACOS_CONSOLE_PASSWORD:?set in local env}
    RNACOS_GMT_OFFSET_HOURS: '8'
```

数据卷加入 `volumes:` 段。`scripts/dev/up-local-stack.ts` 只在显式传入服务名时启动
rnacos（默认列表继续是 postgres/redis/seaweedfs）。

端口对宿主开放：`8848` HTTP、`9848` gRPC、`10848` 控制台，三个都是必需（应用走
9848，控制台走 8848/10848）。生产 `compose.yaml` 同步加同名服务并映射同一组端口；
**安全组/防火墙只放行受信来源**，控制台密码不得留默认值。

- [ ] **Step 6: 手工验证（开发机）**

启动 rnacos 与 Lucent，记录 PID；发布合法文档 → 日志出现新版本与变更字段、PID 不变、
下一次餐食分析使用新参数；发布非法文档 → 拒绝日志且业务继续用旧值；停 rnacos →
告警后继续用旧值（gRPC 断开）；恢复后监听自动恢复；确认
`docker logs` 与 `$HOME/logs/nacos/` 中无凭据。

## 7. Task 3：AI 家族（角色参数 + 提示词）

**Files:**

- Create: `src/config/runtime/schema/ai.schema.ts`
- Create: `src/config/runtime/prompt-registry.ts`
- Create: `src/config/runtime/prompt-registry.spec.ts`
- Modify: `src/llm-runtime/llm-runtime.service.ts`
- Modify: `src/config/services/llm.config.ts`
- Modify: `src/modules/daily-records/services/meal-analysis/vision.service.ts`
- Modify: `src/modules/daily-records/prompts/meal-analysis.prompt.ts`
- Modify: 其余 8 个 `src/modules/**/prompts/*.ts` 的消费方（助手 graph、报告、今日分析、建议、风险检查）
- Modify: `src/config/env/env-keys.enum.ts` 的注释（标注可被远程覆盖的键）

- [ ] **Step 1**: `llm-runtime.service.ts` 的 `createChatModel(role, opts)` 增加
      `model?` / `baseUrl?`，并把 `temperature/maxRetries/timeout/thinking` 的解析
      移到调用时：远程值 > 调用参数 > env 基线。embedding 只允许覆盖
      `model/baseUrl`（维度不动）。
- [ ] **Step 2**: prompt 覆盖层。`prompt-registry.ts` 为每个 prompt 声明
      allowlist + 必填占位符 + 基线函数；命中覆盖时校验占位符齐全、长度上限，
      未命中走原函数。占位符缺失视为整份文档非法。
- [ ] **Step 3**: 测试：每个角色覆盖生效且互不串台；`model` 覆盖传到 provider；
      提示词缺 `{{language}}` 被拒；超长被拒；hash 日志不含正文。
- [ ] **Step 4**: 验证：改温度 → 下一次餐食分析生效；改模型名 → 下一次 LLM 调用
      使用新模型；非法提示词 → 拒绝并保留旧快照。

## 8. Task 4：检索与助手预算家族

**Files:**

- Create: `src/config/runtime/schema/retrieval.schema.ts`
- Modify: `src/modules/assistant/tools/retrieval/lightrag-client.service.ts`
- Modify: `src/modules/assistant/tools/retrieval/knowledge.service.ts`
- Modify: `src/modules/assistant/tools/retrieval/lightrag.types.ts`
- Modify: `src/modules/assistant/tools/ontology/semantica-client.service.ts`
- Modify: `src/modules/assistant/tools/ontology/ontology-reasoning.service.ts`
- Modify: `src/modules/assistant/tools/ontology/rule-reasoning.service.ts`
- Modify: `src/modules/assistant/tools/ontology/semantica.types.ts`
- Modify: `src/modules/assistant/tools/shared/tool-constants.ts`
- Modify: `src/modules/assistant/tools/shared/tool-definitions.ts`
- Modify: `src/modules/assistant/tools/drugbank/search.service.ts`
- Modify: `src/modules/assistant/agent/runtime/graph.ts`
- Modify: `src/modules/assistant/services/memory.service.ts`
- Modify: `src/modules/admin/services/console.service.ts`（状态展示改为读快照）

- [ ] **Step 1**: 把所有 `const *_MAX_LIMIT` / `*_TIMEOUT_MS` 改为快照读取，
      调用点统一 `clampLimit(snapshot, requested)`；`enabled` 在请求时判定，
      **不用于 Nest 模块装配**（装配仍由 env 决定），文档里写清这一差异。
- [ ] **Step 2**: `baseUrl` 覆盖只影响新请求；客户端缓存（如有）按 URL 变化失效。
- [ ] **Step 3**: 测试：开关关闭时工具返回既有「不可用」结果；上限收紧后请求被
      截断；超时值透传到 fetch/abort。
- [ ] **Step 4**: 验证：关 LightRAG → 助手退化为无检索且不报 500；恢复后立即恢复。

## 9. Task 5：队列家族（并发 + mail 重试/保留 + 餐食 sweeper）

**Files:**

- Create: `src/config/runtime/schema/queue.schema.ts`
- Create: `src/common/queue/queue-runtime.registry.ts`
- Modify: `src/common/queue/queue.factory.ts`
- Modify: `src/common/queue/queue.factory.spec.ts`
- Modify: `src/config/services/mail.config.ts`
- Modify: `src/modules/mail/**`（入队参数改读快照）
- Modify: `src/modules/daily-records/services/meal-analysis/sweeper.service.ts`
- Modify: `src/modules/daily-records/constants/meal-analysis.constants.ts`

- [ ] **Step 1**: `QueueCreateOptions` 增加 `runtimeKey: QueueName`（必填），
      factory 在快照更新时同步 `worker.concurrency`；worker 注册进
      `QueueRuntimeRegistry`，`onModuleDestroy` 注销。并发变化只改内存字段，
      **不重建 Queue/Worker**。
- [ ] **Step 2**: mail 的 `attempts/backoff/removeOnComplete/removeOnFail` 在**入队时**
      读取快照——已入队任务保持旧值，新任务用新值；在文档里明确这条语义。
- [ ] **Step 3**: 餐食 sweeper 的 stale/batch/cron 改读快照；cron 变化通过
      `upsertJobScheduler` 重排，失败只告警不退出。
- [ ] **Step 4**: 测试：并发从 1→4 后注册表内 worker `concurrency` 为 4；未知
      `runtimeKey` 在类型层报错；mail 入队参数取新值。
- [ ] **Step 5**: 验证：管理台看到并发生效；重启后回到 env 基线。

## 10. Task 6：缓存家族

**Files:**

- Create: `src/config/runtime/schema/cache.schema.ts`
- Modify: `src/modules/medicines/cache/store.constants.ts`
- Modify: `src/modules/medicines/cache/store.factory.ts`（或等价构造点）
- Modify: `src/common/queue/base-async-queue.service.ts`

- [ ] **Step 1**: 把 TTL 常量改为「默认值 + 快照读取函数」；TTL 在**写入缓存时**
      取值（已写入条目不被追溯修改）。不纳入验证码/会话/share token 类缓存。
- [ ] **Step 2**: 测试：改 TTL 后新写入条目的 `PX` 为新值；旧条目仍在。
- [ ] **Step 3**: 验证：管理台/日志能看到当前生效 TTL（只读展示）。

## 11. Task 7：认证、存储与元信息家族

**Files:**

- Create: `src/config/runtime/schema/auth.schema.ts`
- Create: `src/config/runtime/schema/storage.schema.ts`
- Create: `src/config/runtime/schema/app-info.schema.ts`
- Modify: `src/modules/auth/services/identity/verification-code.service.ts`
- Modify: `src/modules/auth/services/identity/email-verification.service.ts`
- Modify: `src/modules/auth/services/oauth/state.service.ts`
- Modify: JWT 签发处（`jwtConfig.accessTtl/refreshTtl` 的读取点改为快照）
- Modify: `src/config/services/{tencent-cos,aliyun-oss,s3-storage}.config.ts`
- Modify: `src/modules/app-info/services/info.service.ts`

- [ ] **Step 1**: 验证码/OAuth state/JWT TTL 在签发或校验时读取快照；
      JWT TTL 只影响新令牌，不改已签发令牌。
- [ ] **Step 2**: 存储签名过期、上传上限、`publicBaseUrl/bucket/region` 在每次
      签名/校验时读取；**密钥仍只来自 env**。bucket/region 变更在文档里标注
      「只影响新对象 URL」。
- [ ] **Step 3**: `AppInfoService` 从构造快照改为每请求读取（无缓存或短 TTL）。
- [ ] **Step 4**: 测试：TTL 覆盖生效；验证码长度变更后新码长度变化；bucket 覆盖
      只改新签名 URL；未配置字段回退 env。
- [ ] **Step 5**: 验证：改 `minClientVersion` 后客户端接口立即返回新值。

## 12. Task 8：运维家族（日志级别、慢阈值、指标、限流）

**Files:**

- Create: `src/config/runtime/schema/ops.schema.ts`
- Create: `src/common/throttler/runtime-throttler.guard.ts`
- Modify: `src/common/logger/logger.module.ts`
- Modify: `src/common/interceptors/slow-request.interceptor.ts`
- Modify: `src/prisma/prisma.service.ts`
- Modify: `src/common/metrics/metrics.service.ts`
- Modify: `src/config/services/throttler.config.ts`

- [ ] **Step 1**: `LOG_LEVEL` 变化时调整 winston transport 级别（保留启动默认）。
- [ ] **Step 2**: 慢请求/慢查询阈值改为每次判定读取快照。
- [ ] **Step 3**: `METRICS_ENABLED` 从构造期常量改为逐次判定（热点路径只读内存字段）。
- [ ] **Step 4**: 自定义 guard 继承 `ThrottlerGuard`，每请求从快照取 `ttl/limit`
      （storage 仍由启动期配置决定）；**schema 强制下限**（limit ≥ 1、ttl ≥ 1s），
      防止误配把全站锁死。
- [ ] **Step 5**: 测试：日志级别热切换；阈值变化影响慢日志；限流参数变化后
      429 行为随之改变；非法下限被 schema 拒绝。

## 13. Task 9：文档与可观测性

- [ ] 不新增 ADR。把「env 仍是唯一基线，配置中心只收可热更新的非密钥项、可整份
      回退，密钥与连接串不进中心」写进 `docs/reference/environment-variables.md` 的
      `RNACOS_*` 段落，并标注哪些键可被远程覆盖。
- [ ] `docs/explanation/` 补一篇「运行时配置生命周期」（加载 → 校验 → 快照 →
      订阅 → 回退），不复制字段表。
- [ ] `docs:verify` 增加一项：`runtime-config.example.txt` 可被当前 schema 解析
      通过，字段集合与 schema 完全一致（只查结构，注释靠人工评审）。
- [ ] 结构化日志：每次生效记 `revision/seq/变更字段路径`，不记值（提示词只记 hash）。
- [ ] 管理台（可选）：只读展示当前快照版本与最近一次拒绝原因。

## 14. Task 10：验收

- [ ] `pnpm typecheck`、`pnpm lint:check`、`pnpm format:check`、`pnpm test:ci`、
      `pnpm arch:check`、`pnpm docs:verify`、`pnpm docs:links` 全绿。
- [ ] Task 0 的 7 项结论回写；`RNACOS_ENABLED=false` 时零网络调用、进程启动不受影响。
- [ ] 全部家族在开发环境各做一次「生效 / 非法拒绝 / 删除回退」三连验证。
- [ ] 关闭 rnacos 后：新请求继续用最后快照，日志有告警，进程不退出。
- [ ] 把 `JWT_ACCESS_SECRET` 写进远程文档会被整份拒绝，日志给出「不在白名单」。
- [ ] 迁移日志追加 `docs/logs/migration-log/<日期>.md`。

## 15. 回滚

1. 配置回滚：rnacos 控制台恢复上一版本（历史记录可用）。
2. 单字段回滚：删字段 → 回退环境变量/代码默认值（不用 `0`/空串）。
3. 配置中心故障：保留最后快照；必要时 `RNACOS_ENABLED=false` + 重启回纯 env 模式。
4. 代码回滚：按任务边界 revert；不改数据库 schema、不改 API 契约。

## 16. 第一版不承诺

- 连接串、密钥、provider 开关一律不进配置中心；它们只在启动时读取，由 `.env`
  负责，配置中心不承担密钥托管职责。
- 不热更新存储 provider、mail driver、LightRAG/Semantica 的模块装配开关
  （`enabled` 只控制请求期可用性）。
- `AI_EMBEDDING_DIMENSION` 可写进 rnacos，但改了要重建向量表；本计划不自动化
  这一步，也不校验它与库里现有维度是否一致。
- 不承诺「可调参 = 识别质量提升」；质量结论仍需离线标注集与 A/B。
- 不提供配置灰度/按用户分流（rnacos 不支持 tag 隔离）。
- rnacos 不可用且进程重启时，回落到 env 基线；配置中心不是启动依赖。

## 17. 待裁决点

1. **生产 rnacos 落哪台机**：推荐主站 sidecar，端口对宿主开放（防火墙仅放行
   受信来源）；备选监控机。
2. **namespace 组织**：显式 ID（`lucent-dev/test/prod`）vs 全部放 `public` 靠
   group 区分。取决于 Task 0 第 4 项结论。
3. **OpenAPI 鉴权**：开发环境是否也开启（推荐开启，避免两套路径）。
4. **提示词全量覆盖的风险**：第一版就开放 9 个 prompt，还是只开放餐食 2 个 +
   助手 system，其余等有需求再开。

## 18. 参考资料

- rnacos 仓库（版本、镜像、启动参数）：<https://github.com/nacos-group/r-nacos>
- Nacos gRPC 绑定（`nacos-sdk-rust-binding-node@0.8.0`）：
  <https://github.com/opc-source/nacos-sdk-rust-binding-node>
- 底层官方 Rust SDK：<https://github.com/nacos-group/nacos-sdk-rust>
- npm 包：<https://www.npmjs.com/package/nacos-sdk-rust-binding-node>
- rnacos 文档：<https://r-nacos.github.io/docs/>
- Nacos Open API（1.x）：<https://nacos.io/en/docs/v1/open-api/>
- BullMQ worker 并发：<https://docs.bullmq.io/guide/workers/concurrency>
- ADR-0018（env-only 基线）：`docs/reference/adr/0018-config-env-only.md`
