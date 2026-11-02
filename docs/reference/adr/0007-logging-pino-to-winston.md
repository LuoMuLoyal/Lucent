# ADR-0007: Logging Framework — Pino (via `nestjs-pino`)

- **Status**: accepted
- **Date**: 2026-07-12（初版）
- **Revised**: 2026-10-27 — 由「Pino → Winston」改为「选定 Pino」，见文末「修订记录」
- **Deciders**: LuoMuLoyal
- **Supersedes**: ADR-0006 中 "Pino 结构化日志仍是日志支柱，不做迁移" 的表述（该表述已随本次修订恢复成立）

## Context

### 2026-07-12 的原始背景（保留，供追溯）

Lucent 自项目初期使用 `nestjs-pino`。当时迁往 Winston 的五条理由是：

1. **测试输出噪音**：Pino 的 `transport`（`pino-pretty` / `pino/file`）通过 worker 线程直接写
   stdout fd，绕过 `console.*`，Vitest 拦截不住，E2E 全量运行输出数千行日志。
2. **双 Logger 并存**：`PinoLogger`（6 个文件）与 NestJS `Logger`（25 个文件）两套 API。
3. **API 人体工程学**：`(obj, msg)` 顺序敏感，与 NestJS 的 `(message, ...optionalParams)` 不一致。
4. **每请求 autoLogging 重复**：与 Nginx / `ApiExceptionFilter` / `SlowRequestInterceptor` / 指标重复。
5. **依赖链庞大**：Pino 全家桶 29 个间接依赖。

### 2026-10-27 修订时的事实变化

**前提变了：日志不再写文件系统。** 部署口径是「app 只写 stdout + VictoriaLogs
（`VICTORIALOGS_URL`），不写文件系统、不挂日志卷」（`deployment.md`），
`winston-daily-rotate-file` 已从依赖中移除。也就是说，当初支持 Winston 的**文件轮转**
能力（`lucent-YYYY-MM-DD.log`、500MB、14d、gzip）现在是**无用的优势**。

更关键的是，上面五条里决定性的两条**已经不成立**：

- **第 1 条归因于 `transport`，不是 pino。** worker 线程绕过 console 的是
  `pino.transport()`（`pino-pretty` / `pino/file`）。pino 的 `destination` 官方接受任意
  `WritableStream`，`pino-pretty` 也支持「作为 stream 使用」（`pino(pretty({sync:true}))`），
  两者都在进程内同步执行。`nestjs-pino` 的 `pinoHttp` 直接接受
  `[options, DestinationStream]`，因此可以把 destination 换成任何可写流——包括测试里
  一个走 `console.*` 的流，Vitest 的 `onConsoleLog` 就能接管。
  **原判「架构层面的问题，非配置可修复」是错的**：那是选了 transport 才撞上的。
- **第 2、3 条由 `nestjs-pino` v5 消解。** v5 提供与 NestJS `LoggerService` 兼容的
  `Logger`（`app.useLogger(app.get(Logger))` 后，所有 `new Logger(X.name)` 继续工作，
  且方法按 pino 语义接受 `(obj, msg)`），以及 `NativeLogger`（`ConsoleLogger` 的
  drop-in 替代，字段名与参数解析一致）。第 4、5 条本来就只是配置与依赖数量的取舍。

生态活跃度也发生了倾斜：

| 包            | 最新版 | 发布时间                                                  |
| ------------- | ------ | --------------------------------------------------------- |
| `nestjs-pino` | 5.3.1  | 2026-10-02（v5 major 于 2026-08-31，**晚于本 ADR 初版**） |
| `pino`        | 10.4.0 | 2026-10-02                                                |
| `winston`     | 3.19.0 | 2025-12-07（至修订时约 10 个月无发布）                    |

同时，Winston 侧积累了三处只为绕开其缺陷而存在的代码：`errorNormalizeFormat`
（nest-winston 把 `Error` 当元数据转发，Winston 产出 `error: {}` 与**一元数组**形态的
`stack`）、`otelTraceFormat`（Winston 没有 mixin 概念）、以及 149 行的自定义
`VictoriaLogsTransport`。这些不是业务代码，是框架适配债。

## Decision

日志框架选 **Pino**，经 **`nestjs-pino`** 集成。

| 维度          | 取值                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------- |
| 集成          | `nestjs-pino`（`LoggerModule.forRootAsync`）+ `app.useLogger(app.get(Logger))`              |
| 依赖          | `pino`、`pino-http`、`nestjs-pino`（移除 `nest-winston` / `winston` / `winston-transport`） |
| 调用点        | pino 原生 `(meta, msg)`：`logger.warn({ error, userId }, 'msg')`                            |
| 开发格式      | 进程内自定义 `Writable`（`createPrettyStream`，同步），**不用** worker transport            |
| 生产输出      | JSON 到 stdout（fd 1），不写文件                                                            |
| VictoriaLogs  | 自定义 `Writable`（`victorialogs-stream.ts`）批量 POST NDJSON                               |
| HTTP 访问日志 | 仍由 `setup-app.ts` 的 Fastify `onResponse` 钩子产出；`autoLogging: false`                  |

**JSON 字段契约保持与上一实现一致**，避免 VictoriaLogs 查询与看板失效：

- `level` 是**字符串标签**（`formatters.level`），不是 pino 的数字级别；
- `message` / `timestamp` / `context` 名称不变（`messageKey` + 自定义 `timestamp`）；
- 调用方元数据落在**顶层**，不套 `params`；
- 活跃 OTel span 内自动注入顶层 `trace_id` / `span_id`（`mixin`）；
- `error` 由 `pino.stdSerializers.err` 序列化为 `{type, message, stack}`——**不再需要**
  `errorNormalizeFormat` 那个把数组 stack 拼成字符串的 workaround。

两处刻意的取舍：

- **`base: null`**：不输出 `pid` / `hostname`，与旧输出形状一致（容器平台已带）。
- **`serializers.req/res` 返回 `undefined`**：不启用 pino-http 的请求对象绑定。
  应用已用 OTel trace id 做关联并自建访问日志；pino-http 的 `req` 序列化器还会复制
  **请求头**，其中含凭据。

## Options Considered

| Option                                                  | Pros                                                                                                 | Cons                                                                                    |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 保持 Winston                                            | 零改动                                                                                               | 决定性理由已消失；为绕开 nest-winston 缺陷维护 3 处适配代码；`winston` 停更；性能上限低 |
| **Pino + `nestjs-pino`（选定）**                        | 官方集成、`Logger` 与 `LoggerService` 兼容；原生 NDJSON/序列化/mixin；生态活跃；测试可用 stream 拦截 | 需要把约 30 个调用点改成 `(meta, msg)` 顺序；本仓需自己维护 VictoriaLogs 流             |
| Pino + 自写 `LoggerService` 适配层                      | 完全掌控参数合并语义                                                                                 | 重复实现 `nestjs-pino` 已提供的 DI/ALS 集成，维护面更大                                 |
| Pino + worker `transport`（如 `pino-pretty` transport） | 生态默认写法                                                                                         | 重新引入「绕过 console、测试拦不住」的问题，正是本次要摆脱的                            |

## Consequences

- **调用点是破坏性变更**：`logger.error(msg, stack)` / `logger.warn(msg, meta)` 在 pino 下
  第二实参会**静默丢弃**（无占位符时被当作插值值）。全部改为 `(meta, msg)`，并用一次性
  扫描确认无残留（未入库，属迁移期工具）。
- **测试可拦截**：开发/测试 destination 是进程内 `Writable`，不再是 worker 线程。
  测试默认级别仍为 `error`（`resolveLevel`），噪音与迁移前持平。
- **`verbose` 映射到 pino 的 `trace`**；`LOG_LEVEL` 合法值不变
  （`error` / `warn` / `info` / `debug` / `verbose`），运行时热更新改为写
  `PinoLogger.root.level`。
- **VictoriaLogs 嵌套字段被摊平**：VictoriaLogs 把嵌套 JSON 展开为点号字段名，
  `error.stack` 入库后是 `error.stack` 这一**字段名**而非嵌套对象。查询写法不变。
- 移除三处框架适配代码（`errorNormalizeFormat`、`otelTraceFormat`、`VictoriaLogsTransport`），
  但新增一个等价的 `Writable`（HTTP 批量推送无法由日志库本身提供）。
- 依赖净变化：`-3`（winston 三件套）`+3`（pino / pino-http / nestjs-pino）。

## Verification

- `typecheck`、`lint:check`、`prettier`、`build` 通过；单元 **397 files / 4456 tests** 全绿。
- e2e 全量通过（含 `core/app-boot` 这条整应用装配守卫）。
- **VictoriaLogs 入库实测**（本地 `victoriametrics/victoria-logs:v1.51.1`，脚本
  `scripts/verify-victorialogs-ingest.mjs`）：`_msg` / `_time` 映射、`level` 字符串标签、
  顶层元数据、`error.message` / `error.stack` / `error.type` 均按契约落地。

## 修订记录

- **2026-10-27 修订**：撤销 2026-07-12 的「Pino → Winston」决策，改为选定 Pino
  （经 `nestjs-pino`）。原因：日志不再写文件系统，使 Winston 的文件轮转优势失效；
  原第 1 条测试噪音问题被确认是 `transport`（worker 线程）造成、而非 pino 本身，
  用 `DestinationStream` 即可规避；`nestjs-pino` v5 的 `Logger` / `NativeLogger`
  消解了双 logger 与 API 风格问题；`winston` 长期无发布。历史决策内容按日期保留在上文
  「Context」中，未改写。
