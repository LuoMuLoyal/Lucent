# ADR-0007: Logging Framework — Pino → Winston Migration

- **Status**: accepted
- **Date**: 2026-07-12
- **Deciders**: LuoMuLoyal
- **Supersedes**: ADR-0006 中 "Pino 结构化日志仍是日志支柱，不做迁移" 的表述

## Context

Lucent 自项目初期使用 `nestjs-pino`（Pino）作为日志框架。ADR-0006 在制定可观测性策略时明确
"Pino 结构化日志仍是日志支柱，不做迁移"。但在实际开发和测试过程中，Pino 暴露出以下问题：

### 1. 测试输出噪音

Pino 的 transport（`pino-pretty` / `pino/file`）通过 **worker 线程** 直接写 stdout fd，绕过
`console.*`。因此 Vitest（以及之前的 Jest）内置的"仅失败测试显示 console 输出"机制无法拦截 Pino
的日志输出。E2E 测试全量运行时，每个 HTTP 请求产生一行日志，226 个测试文件共输出数千行应用日志，
完全淹没测试结果。

此问题在 Jest → Vitest 迁移过程中暴露尤为明显。虽然可以通过设置 `LOG_LEVEL=silent` 规避，但这是
workaround——Pino 的 transport 机制设计上不兼容测试框架的 console 拦截。

### 2. 双 Logger 并存

项目同时存在两套 logger：

- **PinoLogger**：通过 `nestjs-pino` 的 `@InjectPinoLogger()` 注入，用于 6 个文件（`AuthService`、
  `CredentialService`、`AssistantController`、`ApiExceptionFilter`、`LifecycleService`、
  `SlowRequestInterceptor`）
- **NestJS Logger**：通过 `new Logger(ClassName.name)` 创建，用于其余 25 个服务/控制器

两套 logger 的 API 风格、调用约定、输出格式均不同，开发者需要记住"这个文件用哪个 logger"，造成
认知负担和一致性风险。

### 3. API 人体工程学

Pino 的结构化日志 API 采用 `(obj, msg)` 顺序：

```typescript
this.logger.info({ requestId, userId, durationMs }, 'Request completed');
```

- 顺序敏感：`info(msg, obj)` 和 `info(obj, msg)` 行为完全不同
- 与 NestJS 生态主流的 `(message: string, ...optionalParams)` 约定不一致
- 其余 25 个服务已使用 NestJS Logger 的 `log(message, context)` 风格，PinoLogger 的使用是异类

### 4. 每请求 autoLogging 重复

`pino-http` 的 `autoLogging` 对每个 HTTP 请求打印一行访问日志（`GET /api/v1/medicines completed
200 in 42ms`），与已有可观测性组件完全重复：

- Nginx `access_log` — IP / UA / bytes / referer
- `ApiExceptionFilter` — 4xx/5xx 错误详情
- `SlowRequestInterceptor` — 慢请求告警
- Prometheus histogram + counter（ADR-0006 Phase 1）

虽然可以通过 `autoLogging: false` 关闭，但这进一步说明 `pino-http` 的 HTTP 集成层对 Lucent 场景
是多余的——Lucent 的请求级可观测性已由独立组件覆盖。

### 5. 依赖链庞大

`nestjs-pino` + `pino` + `pino-http` + `pino-pretty` + `pino-roll` 共引入 29 个间接依赖，
对于一个"只需要写日志到 console 和文件"的场景来说过于沉重。

## Decision

将日志框架从 Pino (`nestjs-pino`) 迁移到 Winston (`nest-winston`)。

### 具体变更

| 维度          | Pino (旧)                                                | Winston (新)                                                                       |
| ------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **集成库**    | `nestjs-pino`                                            | `nest-winston`                                                                     |
| **依赖**      | `pino`, `pino-http`, `pino-pretty`, `pino-roll`（29 包） | `winston`, `winston-daily-rotate-file`（27 包）                                    |
| **Logger DI** | `@InjectPinoLogger()` — 6 个文件                         | `new Logger(ClassName.name)` — 全项目统一                                          |
| **API 风格**  | `(obj, msg)` 顺序敏感                                    | `(message: string, ...optionalParams)` — 与 NestJS 一致                            |
| **Console**   | `pino-pretty` worker 线程                                | `winston.transports.Console`（同步，可被测试框架拦截）                             |
| **文件轮转**  | `pino-roll`                                              | `winston-daily-rotate-file`（`lucent-YYYY-MM-DD.log`，500MB，14d，gzip）           |
| **HTTP 日志** | `pino-http` autoLogging（每请求一行）                    | 不配置（由 Nginx / ApiExceptionFilter / SlowRequestInterceptor / Prometheus 覆盖） |
| **测试噪音**  | transport 绕过 console，Vitest 无法拦截                  | Console transport 走标准 stdout，Vitest 正常拦截                                   |

### 环境策略

| 环境            | Transport 配置                           | 默认级别 |
| --------------- | ---------------------------------------- | -------- |
| **development** | `Console`（`format.simple()`，人类可读） | `debug`  |
| **production**  | `Console`（JSON）+ `DailyRotateFile`     | `info`   |
| **test**        | `Console`                                | `error`  |

`LOG_LEVEL` 环境变量始终优先。合法值从 Pino 的 `['silent', 'debug', 'info', 'warn', 'error']`
改为 Winston 标准的 `['error', 'warn', 'info', 'debug', 'verbose']`。

## Options Considered

### Option A: 保持 Pino，修补问题

- 保留 `nestjs-pino`，通过 `autoLogging: false` + 测试环境 `LOG_LEVEL=silent` + 统一 `PinoLogger` →
  `Logger` 适配层来修补已知问题。

| 优势                      | 劣势                                                 |
| ------------------------- | ---------------------------------------------------- |
| 零迁移成本                | worker 线程 transport 根本问题无法解决               |
| Pino 性能上限高于 Winston | 仍需维护 `pino-http` 集成层（虽然 autoLogging 关了） |
|                           | 双 logger 并存问题需要额外适配层                     |
|                           | 29 个间接依赖不变                                    |
|                           | PinoLogger API 与 NestJS 生态不一致                  |
|                           | 仅是 workaround，不是根本解决                        |

### Option B: 迁移到 Winston（**选定方案**）

- 移除 `nestjs-pino` 全家桶，引入 `nest-winston` + `winston` + `winston-daily-rotate-file`。
- 全项目统一使用 `new Logger(ClassName.name)`。
- 生产环境使用 `DailyRotateFile` 实现日志轮转。

| 优势                                       | 劣势                                             |
| ------------------------------------------ | ------------------------------------------------ |
| Console transport 同步输出，测试框架可拦截 | Winston 性能上限低于 Pino（异步场景）            |
| 全项目 logger API 统一                     | `winston-daily-rotate-file` 是社区库，非官方     |
| `nest-winston` 与 NestJS `Logger` 原生兼容 | Winston 4 类型定义存在部分 `any`（需 `as` 桥接） |
| 依赖链减少（29 → 27 包，直接依赖 5 → 3）   |                                                  |
| API 风格与 NestJS 生态主流一致             |                                                  |
| `DailyRotateFile` 原生支持日期轮转 + gzip  |                                                  |
| 配置直观，transport 数组即可               |                                                  |

### Option C: 迁移到其他框架（log4js / signale / custom）

| 优势       | 劣势                                             |
| ---------- | ------------------------------------------------ |
| 可能更轻量 | `nest-winston` 是 NestJS 官方推荐的 Winston 集成 |
|            | 社区活跃度和生态远不如 Winston                   |
|            | 需要自行实现 NestJS Logger 适配                  |
|            | 日志轮转等生产功能需从零搭建                     |

## Decision Rationale

选择 **Option B（Winston）** 的核心推理：

### 1. 测试噪音是根本性问题

Pino 的 worker 线程 transport 设计决定了它与测试框架的 console 拦截机制不兼容。这不是配置问题，
而是架构决策。`LOG_LEVEL=silent` 只是隐藏了输出，transport 仍在后台运行并消耗资源。Winston 的
`Console` transport 直接走 `process.stdout.write`，Vitest 可以正常拦截和过滤。

### 2. Logger 统一的价值大于性能差异

Pino 的性能优势（约 2-3x throughput）在高并发场景下有意义。Lucent 是单进程、个人健康管理的低流量
应用，日志吞吐量远未达到 Pino vs Winston 的性能边界。统一 logger API 带来的开发体验和一致性收益
远大于理论性能差异。

### 3. nest-winston 是 NestJS 生态一等公民

`nest-winston` 在 NestJS 官方文档中被列为推荐日志集成。它直接实现 `LoggerService` 接口，通过
`WINSTON_MODULE_NEST_PROVIDER` 注入后，`app.useLogger()` 即可全局替换 NestJS 内置 Logger。所有
使用 `new Logger(ClassName.name)` 的代码无需任何修改即可获得 Winston 输出。

### 4. 生产日志轮转需求已满足

`winston-daily-rotate-file` 提供了 `pino-roll` 的全部能力（日期轮转、大小上限、保留天数、gzip
压缩），且配置更直观：

```typescript
new DailyRotateFile({
  filename: 'lucent-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  dirname: './logs',
  maxSize: '500m',
  maxFiles: '14d',
  zippedArchive: true,
});
```

### 5. 与 ADR-0006 可观测性策略的兼容性

ADR-0006 的可观测性策略以 Prometheus + Grafana 为指标支柱，日志支柱仅要求"结构化 JSON 日志"。
Winston 在生产环境使用 `Console` JSON transport 即满足此要求。`DailyRotateFile` 写入的文件日志
可用于离线分析或未来导入 Loki。

## Migration Summary

### 移除的依赖

- `nestjs-pino`, `pino`, `pino-http`, `pino-pretty`, `pino-roll`（-29 包）

### 新增的依赖

- `nest-winston`, `winston`, `winston-daily-rotate-file`（+27 包）

### 变更的文件

- `src/common/logger/logger.config.ts` — 完全重写
- `src/common/logger/logger.module.ts` — `PinoLoggerModule` → `WinstonModule.forRootAsync()`
- `src/main.ts` — `app.get(Logger)` → `app.get(WINSTON_MODULE_NEST_PROVIDER)`
- `src/setup-app.ts` — 移除 `LoggerErrorInterceptor`
- 6 个源文件 — `PinoLogger` → `new Logger(ClassName.name)`
- `src/config/environment.validation.ts` — `LOG_LEVEL` 合法值更新
- `.env.test` / `.env.test.example` — `LOG_LEVEL` 从 `silent` 改为 `error`
- 8 个测试文件 — 移除 `PinoLogger` mock，适配新 logger

### 验证结果

- `pnpm typecheck` ✓（0 错误）
- `pnpm lint:check` ✓（0 警告）
- `pnpm build` ✓（694 文件）
- `pnpm test` ✓（205 文件 / 2102 测试全部通过）

## Consequences

### 变得更容易

- **测试体验**：Vitest 正常拦截 console 输出，仅失败测试显示日志，测试输出干净
- **开发一致性**：全项目统一使用 `new Logger(ClassName.name)`，无需区分两套 logger
- **API 直觉**：`logger.log('message', context)` 风格与 NestJS 文档和生态一致
- **配置简洁**：Winston 的 transport 数组模型比 Pino 的 worker 线程 transport 更易理解和调试
- **依赖精简**：直接依赖从 5 个减至 3 个

### 变得更难 / 新增负担

- Winston 4 的 TypeScript 类型定义存在部分 `any`，测试中访问 transport options 需要类型桥接
  （`as unknown as LeveledTransport`）
- `winston-daily-rotate-file` 是社区维护库（非 Winston 官方），需关注其维护状态
- 未来若需要 Pino 级别的日志吞吐性能，需要重新评估

### 不变

- 结构化 JSON 日志仍为生产环境默认输出格式
- `SlowRequestInterceptor`、`ApiExceptionFilter`、`LifecycleService` 等日志组件行为不变
- Request ID 关联仍由 `requestIdMiddleware` + `AsyncLocalStorage` 独立处理
- ADR-0006 的 Prometheus + Grafana 可观测性策略不受影响

### 与 ADR-0006 的关系

ADR-0006 在"不变"部分声明"Pino 结构化日志仍是日志支柱，不做迁移"。本 ADR 取代该声明。ADR-0006
的其余内容（Prometheus + Grafana 指标策略、推迟 OpenTelemetry、指标范围定义）不受影响。
