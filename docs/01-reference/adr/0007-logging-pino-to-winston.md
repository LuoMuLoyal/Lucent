# ADR-0007: Logging Framework — Pino → Winston Migration

- **Status**: accepted
- **Date**: 2026-07-12
- **Deciders**: LuoMuLoyal
- **Supersedes**: ADR-0006 中 "Pino 结构化日志仍是日志支柱，不做迁移" 的表述

## Context

Lucent 自项目初期使用 `nestjs-pino`（Pino）作为日志框架。ADR-0006 在制定可观测性策略时明确
"Pino 结构化日志仍是日志支柱，不做迁移"。但在实际开发和测试过程中，Pino 暴露出以下问题：

1. **测试输出噪音**：Pino 的 transport（`pino-pretty` / `pino/file`）通过 worker 线程直接写 stdout fd，
   绕过 `console.*`。Vitest 内置的"仅失败测试显示 console 输出"机制无法拦截 Pino 的日志输出。E2E
   测试全量运行时，226 个测试文件共输出数千行应用日志，完全淹没测试结果。这是架构层面的问题，非配置可修复。

2. **双 Logger 并存**：项目同时存在 `PinoLogger`（`@InjectPinoLogger()` 注入，6 个文件）和 NestJS
   `Logger`（`new Logger(ClassName.name)`，25 个服务/控制器）。两套 logger 的 API 风格、调用约定、输出
   格式均不同，开发者需要记住"这个文件用哪个 logger"。

3. **API 人体工程学**：Pino 的结构化日志 API 采用 `(obj, msg)` 顺序，顺序敏感，与 NestJS 生态主流的
   `(message: string, ...optionalParams)` 约定不一致。

4. **每请求 autoLogging 重复**：`pino-http` 的 `autoLogging` 对每个 HTTP 请求打印一行访问日志，与
   Nginx `access_log`、`ApiExceptionFilter`、`SlowRequestInterceptor`、Prometheus 指标完全重复。

5. **依赖链庞大**：`nestjs-pino` + `pino` + `pino-http` + `pino-pretty` + `pino-roll` 共引入 29 个间接依赖。

## Decision

将日志框架从 Pino (`nestjs-pino`) 迁移到 Winston (`nest-winston`)。

| 维度          | Pino (旧)                                                | Winston (新)                                                                       |
| ------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **集成库**    | `nestjs-pino`                                            | `nest-winston`                                                                     |
| **依赖**      | `pino`, `pino-http`, `pino-pretty`, `pino-roll`（29 包） | `winston`, `winston-daily-rotate-file`（27 包）                                    |
| **Logger DI** | `@InjectPinoLogger()` — 6 个文件                         | `new Logger(ClassName.name)` — 全项目统一                                          |
| **API 风格**  | `(obj, msg)` 顺序敏感                                    | `(message: string, ...optionalParams)` — 与 NestJS 一致                            |
| **Console**   | `pino-pretty` worker 线程                                | `winston.transports.Console`（同步，可被测试框架拦截）                             |
| **文件轮转**  | `pino-roll`                                              | `winston-daily-rotate-file`（`lucent-YYYY-MM-DD.log`，500MB，14d，gzip）           |
| **HTTP 日志** | `pino-http` autoLogging（每请求一行）                    | 不配置（由 Nginx / ApiExceptionFilter / SlowRequestInterceptor / Prometheus 覆盖） |

环境策略：development 使用 `Console`（`format.simple()`，人类可读，`debug` 级）；production 使用
`Console`（JSON）+ `DailyRotateFile`（`info` 级）；test 使用 `Console`（`error` 级）。`LOG_LEVEL` 环境
变量始终优先。

## Options Considered

| Option                                      | Pros                                                                                                                                                                                      | Cons                                                                                                                       |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 保持 Pino，修补问题                         | 零迁移成本；Pino 性能上限高于 Winston                                                                                                                                                     | worker 线程 transport 根本问题无法解决；双 logger 并存需额外适配层；29 个间接依赖不变；PinoLogger API 与 NestJS 生态不一致 |
| **迁移到 Winston（选定方案）**              | Console transport 同步输出，测试框架可拦截；全项目 logger API 统一；`nest-winston` 与 NestJS `Logger` 原生兼容；API 风格与 NestJS 生态主流一致；`DailyRotateFile` 原生支持日期轮转 + gzip | Winston 性能上限低于 Pino（异步场景）；`winston-daily-rotate-file` 是社区库，非官方；Winston 4 类型定义存在部分 `any`      |
| 迁移到其他框架（log4js / signale / custom） | 可能更轻量                                                                                                                                                                                | `nest-winston` 是 NestJS 官方推荐的 Winston 集成；社区活跃度和生态远不如 Winston；日志轮转等生产功能需从零搭建             |

## Consequences

- **测试体验**：Vitest 正常拦截 console 输出，仅失败测试显示日志，测试输出干净
- **开发一致性**：全项目统一使用 `new Logger(ClassName.name)`，无需区分两套 logger
- **配置简洁**：Winston 的 transport 数组模型比 Pino 的 worker 线程 transport 更易理解和调试
- **依赖精简**：直接依赖从 5 个减至 3 个
- Winston 4 的 TypeScript 类型定义存在部分 `any`，测试中访问 transport options 需要类型桥接
- `winston-daily-rotate-file` 是社区维护库，需关注其维护状态
- 结构化 JSON 日志仍为生产环境默认输出格式
- `SlowRequestInterceptor`、`ApiExceptionFilter`、`LifecycleService` 等日志组件行为不变
- Request ID 关联由 `requestIdMiddleware` + `AsyncLocalStorage` 独立处理（后被 ADR-0010 退役为 OTel trace_id）
- ADR-0006 的 Prometheus + Grafana 可观测性策略不受影响
