---
status: active
owner: backend
updated: 2026-10-16
---

# 后端工程能力补齐：OpenAPI 元数据 / 压缩 / Terminus 探针 / Prisma 插桩 / 队列面板

Created: 2026-10-16
Revised: 2026-10-16（按维护者口径修正：① `@nestjs/terminus` **引入并替换现有探针**，不再保留自研探针；
② OTel **默认开启**（`OTEL_ENABLED` 未设即启用），现状的 `false` 只是未配置而非产品口径；
③ bull-board **能力全开**（不做只读模式）；④ 本计划不设"裁决不引入"类结论，所有条目按维护者指定范围执行；
⑤ **§二机制更正**：实测（2026-10-16）响应组件由 `z.toJSONSchema(..., { target: 'openapi-3.0' })` 生成、
请求侧由 NestJS `StandardSchemaOpenApiConverter` 调 `~standard.jsonSchema.input(...)` 转换，**两者都读 zod 4 原生
`.meta()`**（`.meta({ example })` / `.meta({ examples })` 直出 `example`/`examples`，`.nullable()` 直出 `nullable: true`）。
`@asteasolutions/zod-to-openapi` 的 `.openapi()` 存于自有 registry，两条管道都不读，故**不引入该依赖**，
改用原生 `.meta()`；§二-1 的 extension point / lint 门禁随之取消（无中间层可回退）。）

定位：引入 5 组包/依赖，把 5 处「基础设施靠手写或缺失」换成生态标准件。
`P0/P1` 只是**排期建议**，不是范围裁剪——全部条目都在本计划范围内。

> 本计划只做「怎么做」。剩余项唯一台账是 `docs/TODO.md`。
> 落地后本文件按 `plans/README.md` 生命周期第 4 条删除。

---

## 〇、引入清单

| 包                                                               | 版本           | 解决什么                                                                                                                                                                 | 排期 |
| ---------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| _（无新依赖）_ 原生 zod 4 `.meta()`                              | zod 4.6.5 自带 | `docs/TODO.md`「OpenAPI example/nullable 语义元数据补全」——`.describe()` 丢 example；`example`/`examples`/`nullable` 改由原生 `.meta()` / `.nullable()` 直出（见头注 ⑤） | P0   |
| `@fastify/compress`                                              | ^1.x           | Fastify 默认不压缩响应；药品详情/health-context 大 JSON 直出                                                                                                             | P0   |
| `@nestjs/terminus`                                               | ^12.1.0        | **替换** `src/app.service.ts` 的三档自研探针                                                                                                                             | P1   |
| `@prisma/instrumentation`                                        | ^7.10.1        | Prisma 查询无 OTel span，链路追踪到 DB 即断                                                                                                                              | P1   |
| `@bull-board/nestjs` + `@bull-board/fastify` + `@bull-board/api` | ^9.10.4        | BullMQ 队列可视化；**能力全开**（见 §七）                                                                                                                                | P1   |

## 版本核实（2026-10-16，registry 实测）

| 包                        | 版本   | peer 与兼容性                                                                                                                                                                                                                        |
| ------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@nestjs/terminus`        | 12.1.0 | peer `@nestjs/core ^11.0.0 \|\| ^12.0.0`、`@nestjs/common ^11.0.0 \|\| ^12.0.0`、`@nestjs/swagger ^11.0.0 \|\| ^12.0.0` — **本仓 Nest 12 / swagger 12 全部命中 ✓**；`@prisma/client` 为可选 peer（提供内置 `PrismaHealthIndicator`） |
| `@prisma/instrumentation` | 7.10.1 | peer `@opentelemetry/api ^1.8` — 本仓 ^1.9.1 ✓；需 `@opentelemetry/instrumentation`（本仓已可满足）                                                                                                                                  |
| `@bull-board/nestjs`      | 9.10.4 | peer 显式含 `@nestjs/core@^12` / `@nestjs/common@^12` ✓（devDeps 内有 `nestjs-core-v12` alias，v12 是受支持路径）                                                                                                                    |
| `@fastify/compress`       | 1.x    | peer `fastify ^5` ✓                                                                                                                                                                                                                  |

> **更正（首版错误）**：首版曾以「terminus peer 不含 ^12」为由建议不引入。
> 该结论基于 **v11** 的 peer 范围，`@nestjs/terminus@12.1.0` 已显式支持 `^12`，
> 理由不成立，已删除。同类 peer 滞后问题（`@nestjs/throttler@6`、
> `nest-winston@1.10.2`，见 `docs/TODO.md`）与本批无关，不扩大。

---

## 一、现状锚点（代码事实，2026-10-16 核实）

- **DTO/契约**：`src/modules/**` 的 DTO 全是 zod schema（`@Body/@Query/@Param({ schema })`），
  `@ApiProperty` 已在 zod 迁移中退役。**唯一例外**是 `src/app.dto.ts`——健康探针响应仍是
  class + `@ApiProperty`（已于 §四-3 随探针替换迁移为 zod，见 §四）。
- **导出**：`scripts/contract/export-openapi.ts` 用 schema 注册表注入响应组件；
  `ci.yml` 有 G3 step 校验 `openapi.json` 已提交（`git diff --exit-code`）。
- **HTTP 中间件**：`src/setup-app.ts:99` 注册 `@fastify/helmet`；**无 compress**。
- **追踪**：`src/tracing.ts` 用 `getNodeAutoInstrumentations()`；`OTEL_ENABLED` 用
  `=== 'true'` 门控（**未设即关闭**），`@prisma/instrumentation` 未进 instrumentations；
  `OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG` 已在
  `docs/reference/environment-variables.md` 文档化，但 `tracing.ts` **未把它们接进 SDK**。
- **队列**：`src/common/queue/queue.factory.ts` 自建 `Queue` + `Worker` 工厂（未用
  `@nestjs/bullmq`）；`cron-jobs.service.ts` 用 `upsertJobScheduler`。
- **探针**：`src/app.controller.ts` 四端点（`/health`、`/live`、`/ready`、`/deep`）
  - `src/app.service.ts` 三档实现（`probeDatabase` 走 `SELECT 1`、`probeCache` 走
    keyv set/get/del 往返 + TTL 缓存）。
- **审计设施已存在**：`src/modules/audit-log/services/audit-log.service.ts`
  的 `AuditLogService.log({ userId, action, ... })`，内容写入审计已被
  `legal-documents` / `medicines` 的 admin service 使用（见 `src/modules/admin/README.md`）。

## 健康探针的下游消费者（替换前必须逐个确认）

`/api/v1/health*` 是被外部依赖的契约面，不是内部实现细节：

| 消费者                                                                | 依赖方式                                                         |
| --------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `compose.yaml:150`                                                    | 容器 healthcheck：`wget /api/v1/health`，**非 200 即容器不健康** |
| `scripts/dev/start-test-runtime.ts:11`                                | 本地测试运行时等待该 URL                                         |
| `test/contract/contract.e2e-spec.ts`                                  | 四个端点的响应 schema 契约断言                                   |
| `test/e2e/core/app.e2e-spec.ts`                                       | 五条用例，含「DB down → 503」「live 恒 200」                     |
| `test/security/{rate-limiting,fuzzing}.e2e-spec.ts`                   | 用该端点做限流/方法白名单断言                                    |
| `test/performance/health.k6.ts`                                       | 三个端点的性能基线                                               |
| `lucent-bruno/common/检查可达性.yml`                                  | 手工冒烟                                                         |
| `docs/reference/generated/openapi.json` + `plans/_naming-lookup.json` | 生成物与 operationId 查找表                                      |
| `docs/howto/deploy.md` L81/L98、`README.md` L162/L237-250             | 部署手册的验证命令与门禁说明                                     |

## 已决决策（维护者口径，2026-10-16）

1. **元数据走 zod 4 原生 `.meta()`，不引入 zod-to-openapi**（见头注 ⑤）：DTO 按模块分批补
   `.meta({ example })`；`.nullable()` 已是原生语义。每批验收 = `openapi.json` diff
   **只增元数据、不改结构**（实测：剥离 `example`/`examples` 后文档逐字相同）。
2. **`@fastify/compress` 全局开启，且不设开关变量**。仅 SSE 端点排除——
   `src/common/api/sse/sse.ts` 已设 `Connection: keep-alive`，压缩会破坏流式；
   排除用 `config: { compress: false }` 按路由标注。
3. **OTel 默认开启**：`OTEL_ENABLED` 未设置即启动 SDK，仅显式 `false` 才关闭。
   由 `tracing.ts` 与 zod 校验**两处默认必须一致**（见 §六-1 的硬约束）。
4. **Terminus 替换自研探针**：用 terminus 的 indicator 承载检查逻辑。
   响应体外壳已由维护者选定 **§四-1 路线 B（terminus 原生 `{ status, info, error, details }`）并执行完毕**。
   （修订注 ⑥：实现中另发现 `check()` 会抛 `ServiceUnavailableException`，被全局
   `ApiExceptionFilter` 改写为 Problem Details，故 `AppService` 需捕获并取回原生体。）
5. **bull-board 能力全开**：不启用只读模式，重试/清理/暂停/添加 job 全部可用；
   对应的**变更操作必须落审计**（`AuditLogService`），见 §七。
6. **不新增第二套鉴权**：队列面板挂 `/admin/queues`，复用既有 admin 守卫与权限模型。

---

## 二、P0 — OpenAPI 元数据补全（原生 `.meta()`）

### 2-1 机制（无需新依赖）

- zod 4.6.5 原生 `.meta({ example })` / `.meta({ examples })` 由
  `z.toJSONSchema(..., { target: 'openapi-3.0' })`（响应组件）与
  `~standard.jsonSchema.input({ target: 'openapi-3.0' })`（请求侧，NestJS
  `StandardSchemaOpenApiConverter` 调用）共同读取——两条管道**零改动**即可生效。
- 因此不引入 `@asteasolutions/zod-to-openapi`，不建 extension point，不加
  「禁止 dto 裸 import zod」的 lint 门禁（无中间层可回退）。

### 2-2 分批补元数据（已执行）

1. `user-health-context`（查询/写入 body）
2. `daily-records`（写入 body、查询参数、附件/候选形状）
3. `medicines`（查询/识别/风险请求 body）
4. `assistant`（消息/改名/提案确认 body）
5. 其余模块的响应 schema 兜底（保证每条 2xx JSON 响应组件子树至少含一个
   `example`/`examples` 或显式 `nullable`）

每批动作：schema 字段链式补 `.meta({ example })` → `pnpm export:openapi` →
验收 = `openapi.json` 剥离 `example`/`examples` 后与旧文件逐字相同（路径/类型/required 不变）。

### 2-3 门禁（已落地）

- 既有 G3 step（`openapi.json` 已提交）继续生效。
- 新增 `test/contract/openapi-metadata.e2e-spec.ts`（纯文件校验，无需 DB）：
  遍历 OpenAPI 文档所有 2xx JSON 响应的 `$ref`/内联 schema，递归跟随 `$ref`
  断言子树至少含一个 `example`/`examples` 或 `nullable: true`——防止新增 DTO 绕过。
- `docs/TODO.md` 的「OpenAPI example/nullable 语义元数据补全」已删行。

---

## 三、P0 — `@fastify/compress`（已执行）

- `pnpm add @fastify/compress`（9.2.2，peer fastify ^5 ✓）；`src/setup-app.ts` 在 helmet 之后注册：
  `global: true`、`encodings: ['gzip', 'deflate', 'br']`。
- SSE 路由用 `@RouteConfig({ compress: false })`（`@nestjs/platform-fastify`，映射到 Fastify
  `routeOptions.config.compress`）排除，共 4 处：assistant `messages/stream` 与
  `conversations/:id/regenerate`、reports `summary/generate/stream`、today-analysis `generate/stream`。
- **更正**：首版写的 `onUnhandledEncoding` 不存在；真实选项 `onUnsupportedEncoding(encoding, request, reply)`
  的**返回值会替换响应体**（用于自定义 406），不是观测钩子，故**不接入**调试日志（会破坏响应）。
- **测试**（`test/e2e/core/app.e2e-spec.ts`，自足无 DB）：
  - `GET /api/v1/test-echo/large` 带 `Accept-Encoding: gzip` → `content-encoding: gzip`，
    解压后载荷完整；不带则无压缩。
  - `GET /api/v1/test-echo/stream`（带 `@RouteConfig({ compress: false })`）→ 无 `content-encoding`，
    `content-type` 为 `text/event-stream` 且事件到达。
- **风险**：压缩启用后响应走分块传输，`content-length` 不再固定。
  已核实 `test/` 无任何 `content-length` 断言；Luminous 侧 dio 不读该头，
  **任何新写的客户端断言不得依赖 `content-length`**。

---

## 四、P1 — `@nestjs/terminus` 替换探针（已执行）

### 4-0 映射关系

| 现有实现                                                            | Terminus 承载                                                                                                                                                                                           |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `probeDatabase()`（`SELECT 1`）                                     | 内置 `PrismaHealthIndicator.pingCheck('database', prisma)`                                                                                                                                              |
| `probeCache()`（keyv set/get/del 往返 + TTL 缓存 + Redis 后端探测） | **自定义 `HealthIndicator`**（terminus 无 keyv 抽象）。备选：`MicroserviceHealthIndicator` 的 Redis 路径，但它需要引入 `@nestjs/microservices` 并直连 Redis —— 与现有 keyv 封装重复，除非你要求走该路径 |
| `getLiveHealth()`（纯进程，不查依赖）                               | 不需要 indicator；保持「无依赖检查」语义（terminus `check([])`）                                                                                                                                        |
| `getDeepHealth()` 的 per-component `durationMs` / `details`         | terminus indicator 的原生返回（`{ database: { status, ... } }`）+ 自定义包装补 `durationMs`                                                                                                             |
| `HealthAppInfo`（name/env/pid/uptime/memory）                       | terminus 无对应概念，**保留自研**                                                                                                                                                                       |

### 4-1 D-1 响应体形状（已决：路线 B，已执行）

维护者选定 **路线 B：采用 terminus 原生 `{ status, info, error, details }`**。

- 组件名仍为 `HealthResponse`（`_naming-lookup.json` 的 `responseByOld` 未实际参与
  导出，operationId `getHealth*` 亦不变，故无命名churn）。
- **下游消费者复核结论**（逐项）：`compose.yaml` healthcheck 只看状态码 → 不变；
  `docs/howto/deploy.md`、`docs/reference/deployment.md` 仅按端点名引用 → 不变；
  `README.md` 按端点名+用途描述 → 不变；`test/performance/health.k6.ts` 断言
  `body.status === 'ok'|'error'` → 原生形状仍成立；`lucent-bruno/common/检查可达性.yml`
  无断言；Luminous 侧 `rg health/live|health/ready|health/deep|/api/v1/health`
  **零命中** → 无需再生成客户端。真正需改的仅：`src/app.*`、两个 spec、
  `test/e2e/core/app.e2e-spec.ts`、`test/contract/contract.e2e-spec.ts`、`openapi.json`。

### 4-2 装配（已执行）

- `pnpm add @nestjs/terminus`（12.1.0，peer 全命中）；`AppModule` 注册 `TerminusModule`，
  providers 增加 `AppInfoHealthIndicator` / `CacheHealthIndicator` / `DatabaseHealthIndicator`。
- **更正**：未用内置 `PrismaHealthIndicator.pingCheck`。它不返回 `driver`/`probe`
  诊断字段，会丢失 deep 探针语义；改为自定义 `DatabaseHealthIndicator`（同样 `SELECT 1`）。
- **新增 `CacheHealthIndicator`**（terminus 无 keyv 抽象）：保留 `REDIS_URL` 未配置时
  memory 后端恒 `up`（非关键）、配置时 `set/get/del` 往返校验的既有语义。
- **`/health/live`** = `check([appInfo])`，控制器不写状态码 → 恒 200（DB down 也 200）。
- **探针缓存更正**：旧代码的 `PROBE_TTL_MS` 是缓存探测 key 的 TTL，并非「探针结果缓存」；
  旧实现每次 `/ready` 都实查 DB。terminus 行为与旧实现一致，**无结果缓存被移除**，§4-2
  原文「探针结果缓存保留」系对旧实现的误解。
- **关键偏差**：terminus 的 `HealthCheckService.check()` 在 `error`/`shutting_down` 时
  **抛出 `ServiceUnavailableException(result)`**（result 即原生体）。本仓
  `setup-app.ts` 注册了全局 `ApiExceptionFilter`，会把该异常改写为 RFC 9457
  Problem Details，破坏原生体。故 `AppService.run()` 捕获该异常并
  `getResponse()` 取回原生体，再由 controller 依 `isHealthy()` 决定 200/503。
- `src/app.service.ts` 原先在 `eslint.config.ts` 的裸 `throw new Error` 豁免名单中；
  迁移后该文件已无裸 throw，**已从豁免名单删除**，紧邻的 cache 控制流改为直接返回
  `indicator.down(...)`（不再抛错）。

### 4-3 顺带迁移 `src/app.dto.ts`（已执行）

- 改写为 zod：`healthIndicatorResultSchema`（`looseObject`，含 `status`/`message`/
  `durationMs`/`driver`/`probe`/`backend`/`mode`/`name`/`env`/`pid`/`uptimeSeconds`/
  `memoryRssBytes`/`memoryHeapUsedBytes`）、`healthIndicatorMapSchema`（`z.record`）、
  `healthCheckResultSchema`，均以原生 `.meta({ example })` 补元数据以过 §二-3 门禁。
- `HealthResponse` 组件改由 `registerResponseSchema` 注册；**扩展
  `ResponseSchemaRegistration.errorStatuses?: number[]`** 并在
  `scripts/contract/export-openapi.ts` 中据此把 503 响应也 `$ref` 到 `HealthResponse`
  （原 class 方案靠 `@ApiResponse({ status: 503, type })` 直接生成 503 组件引用）。

### 4-4 验收

- `test/e2e/core/app.e2e-spec.ts`：新增 3 处 route health 用例改写为原生形状，
  含 DB-down（`$queryRaw` 拒绝）→ `/health/ready` 与 `/health/deep` 503 且体为原生
  （断言无 `type` 字段，排除 Problem Details）、`/health/live` DB-down 恒 200。全绿（11 用例）。
- `test/contract/contract.e2e-spec.ts` 四个端点契约断言改写为 `status`/`info`/`error`/`details`。
- `test/contract/openapi-metadata.e2e-spec.ts`（§二-3 门禁）对 `HealthResponse` 仍绿。
- `pnpm export:openapi`：`/health`、`/health/ready`、`/health/deep` 的 200 与 503 均
  `$ref` `HealthResponse`，`/health/live` 仅 200；Paths 132、Schemas 364。
- 本地无 Docker/Postgres/Redis：容器 healthcheck 实测、停 Redis 503、DB 依赖 e2e、
  `health.k6.ts` 未能本地执行，交由 CI/部署环境验证（已在本计划「风险与已知限制」备注）。

---

## 五、P1 — `@prisma/instrumentation` + OTel 默认开启

### 5-1 OTel 默认开启（硬约束）

`src/tracing.ts` 在 `ConfigModule` **之前**执行，读裸 `process.env`，
**看不到 zod 的默认值**。因此两处必须同时改且保持一致：

| 位置                                          | 现状                                     | 改为                                       |
| --------------------------------------------- | ---------------------------------------- | ------------------------------------------ |
| `src/tracing.ts:47`                           | `process.env['OTEL_ENABLED'] === 'true'` | `process.env['OTEL_ENABLED'] !== 'false'`  |
| `src/config/env/environment.validation.ts:99` | `z.enum(['true','false']).optional()`    | `z.enum(['true','false']).default('true')` |

- **必须加单测**：断言「未设 `OTEL_ENABLED` 时 `tracing` 判定为启用」与
  「`=false` 时判定为关闭」。两处默认不一致会造成「文档说开着、实际没开」的分裂。
- **开发体验**：默认开后，本地需要 collector。`compose.dev.yaml` 已有
  `jaegertracing/all-in-one`（`16686` UI + `4318` OTLP HTTP），
  与 `tracing.ts` 的默认端点 `http://127.0.0.1:4318/v1/traces` 一致 → 开发开箱可用。
  未起 collector 时导出失败是**静默丢弃**（`environment-variables.md:567` 已声明该语义），
  不阻断业务。
- **生产端点非标准路径**：`compose.monitoring.yaml` 明确 VictoriaTraces 的 OTLP/HTTP 路径是
  `/insert/opentelemetry/v1/traces`（端口 `10428`），不是 `/v1/traces`。
  `OTEL_EXPORTER_OTLP_ENDPOINT` 必须写完整路径——**部署文档需复核一遍**（该坑已在
  `compose.monitoring.yaml` 注释里记录过，默认开启后新环境更容易踩）。
- **采样器缺口（默认开启后变成必做）**：`docs/reference/environment-variables.md`
  L579-585 文档化了 `OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG`，
  但 `src/tracing.ts` 只设了 `resource` / `traceExporter` / `instrumentations`，
  **未把它们接进 SDK**。需先实测 `NodeSDK` 是否自动读取这两个环境变量：
  - 若否（预期）→ 在 `tracing.ts` 显式构造 sampler 并传入 `NodeSDK({ sampler })`；
  - 无论结果如何，都要在 `environment-variables.md` 写明「已生效 / 未生效」，
    不能继续留一个"文档说有、代码不读"的变量。

### 5-2 Prisma 插桩

- `pnpm add @prisma/instrumentation`
- `src/tracing.ts` 的 `instrumentations` 数组加入 `new PrismaInstrumentation()`。
- **顺序约束**：必须在 Prisma Client 首次实例化前注册——`tracing.ts` 已是 `main.ts`
  第一个 import，满足。
- **span 体积控制**：默认全记 query span，叠加默认开启会显著放大写入量
  （VictoriaTraces 保留 **7 天**，见 `compose.monitoring.yaml:199-201`）。
  用 `PrismaInstrumentation({ enabled })` 或 §5-1 的 sampler 做过滤，
  **二者至少落实一个**，并在验收里给出前后 span 量对比。

### 5-3 验收

- `OTEL_ENABLED=true`（或未设）起本地栈 + Jaeger（`16686`）→ 跑一次带 DB 读的请求，
  断言 span 树里出现 `prisma:query` 子节点且 parent 是 HTTP span。
- 未设 `OTEL_ENABLED` 时 SDK 确实启动（单测 + 一次手工确认）。
- span 量对比记录进迁移日志（前后各一次，同一组请求）。

---

## 六、P1 — bull-board 队列面板（能力全开）

- `pnpm add @bull-board/nestjs @bull-board/fastify @bull-board/api`
- `src/modules/admin/` 下新增 `queues-panel` 装配：`FastifyAdapter` +
  `createBullBoard({ queues: [...], options: {} })`。
  **不设置 `readOnlyMode`**——重试 / 提升 / 清理 / 暂停 / 恢复 / 添加 job 全部开放。
- **队列清单来源**：`src/common/queue/queue.factory.ts` 已创建 Queue 实例，
  在工厂里登记一个 process-wide 的 `Queue[]` 注册表供面板读取
  （不新增 DI token，避免与现有工厂模式打架）。
- 挂载 `/admin/queues`，复用 `src/admin-console/services/console-router.service.ts`
  的静态挂载模式与既有 admin 守卫，**不新开端口**。

### 6-1 变更操作必须落审计（能力全开的对应代价）

面板开放写入后，「谁把某个 job 清了 / 重试了」当前无任何留痕。既有
`AuditLogService.log({ userId, action, ... })` 是现成设施，接入方式：

- 在面板挂载前缀上注册 Fastify `onResponse` 钩子，**只对
  `method !== 'GET'` 且 `url` 前缀匹配 `/admin/queues` 的请求**写入审计，
  记录 `userId` / `action`（如 `admin.queue.retry`）/ 路径 / 状态码。
- 用已有的 `_naming-lookup.json` 无法覆盖该项（它是 OpenAPI operationId 表），
  审计 action 命名按既有 `admin.*` 约定新增常量。
- **不要求 bull-board 提供事件回调**——HTTP 层钩子对内对外都成立，
  且不依赖其内部 API 稳定性。

### 6-2 验收

- e2e：未登录访问 `/admin/queues` → 401/403；登录后 → 200。
- e2e：**一条变更操作**（如 pause 一个测试队列）→ 断言
  (a) 操作成功返回；(b) `audit_log` 表新增一条 `admin.queue.*` 记录；
  (c) `GET /api/v1/admin/audit-logs` 能查到该条。
- 文档：`docs/reference/deployment.md` 的容器/端口表加 `/admin/queues` 行；
  `src/modules/admin/README.md` 补面板与审计口径。
- **风险**：面板暴露真实队列内容与 job payload。挂 `/admin` 同源由既有 admin
  鉴权保护；若要做到按队列粒度收权，需在守卫层加权限点——**是否现在做由你定**：
  要就在本批加，不要就登记到 `docs/TODO.md`。

---

## 七、顺带清理（成本近零）

`src/`、`scripts/`、`test/` 中 0 import 的死依赖（2026-10-16 实测）：

| 包                            | 证据                                                              |
| ----------------------------- | ----------------------------------------------------------------- |
| `qrcode` + `@types/qrcode`    | 0 import；但已写进 `THIRD_PARTY_NOTICES.md`（删依赖时同步删该行） |
| `@tiptap/core` / `@tiptap/pm` | 0 import                                                          |
| `chart.js`                    | 0 import（admin 用 recharts）                                     |
| `yaml`                        | 0 import                                                          |

处理：`pnpm remove` + 更新 `THIRD_PARTY_NOTICES.md` + 迁移日志一行。
**先接 `knip` 到主 `src/`**（admin 已有该工具），用它复核无动态引用后再删——
这同时是把 knip 引入主仓的第一步验证，避免以后再攒死依赖。

---

## 八、验收汇总

| #   | 验收                                                             | 命令/依据                                                                              |
| --- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| B1  | lint / typecheck / build 全绿                                    | `pnpm lint:check && pnpm typecheck && pnpm typecheck:tools && pnpm build`              |
| B2  | 单测全绿（含新增 contract、探针、tracing 默认值用例）            | `pnpm test:ci`                                                                         |
| B3  | e2e 全绿（压缩 / SSE / 探针 / 队列面板四组新用例）               | `pnpm test:e2e:ci`                                                                     |
| B4  | 架构检查通过                                                     | `pnpm arch:check`                                                                      |
| B5  | `openapi.json` 已重导出且与代码一致                              | `pnpm export:openapi && git diff --exit-code -- docs/reference/generated/openapi.json` |
| B6  | 压缩实测：大响应体显著变小、SSE 未被压缩                         | B3 + 手动 `curl -H 'Accept-Encoding: gzip' -o /dev/null -w '%{size_download}'`         |
| B7  | 探针：容器 healthy；停 Redis 后 `/health/ready` 503；live 恒 200 | 手动一次 + B3                                                                          |
| B8  | OTel 默认开启生效且有 span                                       | 未设 `OTEL_ENABLED` 起服务 + Jaeger UI                                                 |
| B9  | Prisma span 出现且有体积过滤                                     | Jaeger UI + 前后 span 量记录                                                           |
| B10 | 队列面板可变更且变更落审计                                       | B3 + 查 `admin/audit-logs`                                                             |
| B11 | 文档门禁                                                         | `pnpm docs:verify && pnpm docs:links`                                                  |
| B12 | 双仓契约同步（健康响应若走 B 路线或 §二 元数据影响生成客户端）   | Lucent `pnpm export:openapi` → Luminous `dart run scripts/contract/bootstrap.dart`     |

## 风险与已知限制

- **原生 `.meta()` 与 `@SerializeOptions` 注册表并存**：响应 schema 仍走导出期注册表注入
  （`@SerializeOptions` 不被 Swagger 自省），`z.toJSONSchema` 覆盖组件生成、NestJS
  Standard Schema 转换器覆盖请求侧；`.meta()` 两者都读，故无需中间层。
  两者**不合并**——边界见 ADR-0012 与 `docs/TODO.md`「响应侧 Standard Schema 序列化的未竟事项」。
- **探针缓存与 terminus 默认行为**：terminus 每次实查，必须保留外层缓存，
  否则 `compose.yaml` 的容器 healthcheck 会按 interval 持续打 DB。
- **OTel 默认开启的影响面**：所有环境（含 CI）默认启动 SDK。CI 无 collector 时导出失败
  会走静默丢弃路径，但需确认不污染测试输出（`pino` 时期的 stdout 淹没事故是同类前车之鉴，
  见 ADR-0007）。**e2e 是否 `OTEL_ENABLED=false` 由维护者定**，本计划不预设。
- **压缩 + Trivy**：新依赖进 lockfile 后 `docker.yml` 的 Trivy 扫描会覆盖；
  当前 `exit-code: '0'` report-only，若扫出 HIGH/CRITICAL 需在 `docs/TODO.md` 记白名单决策。
- **bull-board 9.10.4 的 v12 支持面**：依赖其 devDeps 的 `nestjs-*-v12` alias 路径。
  **B3 必须含登录态访问与一次变更操作**，否则 DI 装配失败只在运行时暴露。
- **`plans/_naming-lookup.json`**：§四走 B 路线或新增管理端点会影响它，需同步重生成。
