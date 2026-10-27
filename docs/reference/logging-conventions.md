---
status: active
owner: backend
quadrant: reference
updated: 2026-10-27
---

# Logging Conventions

Lucent 统一使用 NestJS `Logger`（`nestjs-pino` 输出）。结构化日志的字段名不做全局强制，但
**在 `src/` 内保持一致的命名约定**，避免日志聚合工具（VictoriaLogs / ELK）按字段名过滤时
出现「同名含义不同、同义不同名」的漂移。

## 调用形态（pino 原生顺序）

日志方法按 pino 语义接收 **`(meta, message)`**：元数据对象在前，消息在后。

```ts
this.logger.warn({ error, userId }, 'Notification delivery failed');
this.logger.error({ error }, 'Report summary stream failed');
this.logger.log('Simple status: ' + status); // 纯字符串，无需结构化
```

⚠️ **反序会静默丢数据**：`logger.warn('msg', { error })` 在 pino 下把第二实参当作消息插值值，
而消息里没有 `%s` / `%o` 占位符时它会被**直接丢弃**。这与迁移前（Winston 把第二实参当元数据）
不同，是本次迁移唯一的破坏性约定变更。

## 字段名约定

| 字段                             | 含义                                                     | 示例                                                              |
| -------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------- |
| `error`                          | 错误对象（**不要用 `err`**）                             | `{ error, key: cacheKey }`                                        |
| `key` / `userId` / `userSegment` | 关联上下文键                                             | `{ error, userId }`                                               |
| `code`                           | 稳定的业务错误码（与 Problem Details `code` 注册表同源） | `{ code: 'AUTH_REFRESH_TOKEN_INVALID', reason }`                  |
| `event`                          | fire-and-forget / 异步侧失败的稳定事件名                 | `{ userId, event: 'password_change_notification_failed', error }` |

保留键（由日志框架填充，不要在 meta 里重复传）：`level`、`message`、`timestamp`、`context`、
`trace_id`、`span_id`。

## 规则

1. **错误字段名固定为 `error`**：`err` 是历史残留（2026-09-05 审查 S3 已对齐），新代码一律用
   `error`。直接传 `Error` 对象即可——pino 的 `stdSerializers.err` 会序列化成
   `{ type, message, stack }`；不要让调用方手工拼字符串，否则丢栈。
2. **不要重复已自动附加的字段**：`trace_id` / `span_id` 由 pino 的 `mixin` 在活跃 span 内
   自动附加（`getActiveTraceIds()`）；`context` 由 Nest 的 `new Logger(X.name)` 带入。
   无活跃 span 的 bootstrap / 队列场景可显式传 `traceId` 作为补充信息。
3. **敏感信息严禁入日志**：token、密码、cookie、真实凭据、请求 URI 中可能携带的 token。
   pino-http 的 `req` 序列化器被**刻意关闭**（它会复制请求头，其中含凭据）。
4. **错误信息用两个通道**：`logger.warn` 用于业务降级/失败但可继续；`logger.error` 用于
   真正的异常路径（会进入 Sentry 等异常通道）。
5. **结构化与模板并用**：有上下文的失败用结构化 `(meta, message)`；纯字符串调试信息
   用模板字符串即可。

## 示例（结构化 vs 模板）

| 推荐写法                                                  | 禁止写法                                         | 原因                                        |
| --------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------- |
| `this.logger.warn({ error, key }, 'msg')`                 | `this.logger.warn('msg: ' + error)`              | 结构化 meta 便于按字段过滤聚合              |
| `this.logger.error({ error, userId, event: 'x' }, 'msg')` | `this.logger.error(\`msg: \${error.message}\`)`  | error 对象入结构化可保留 stack/cause 元信息 |
| `this.logger.debug('Simple status: ' + status)`           | `this.logger.debug({ status }, 'Simple status')` | 纯状态字符串无需结构化，模板更简洁          |
| `this.logger.log(\`Cache hit (key=\${key})\`)`            | `this.logger.log({ key }, 'Cache hit')`          | 调试级日志性能要求低，模板更直观            |

## 相关

- 日志框架选型与理由：[adr/0007-logging-pino-to-winston.md](adr/0007-logging-pino-to-winston.md)
  （文件名保留初版标识；2026-10-27 修订后选定 Pino，见其「修订记录」）
- pino 配置与格式：`src/common/logger/logger.config.ts`
- **VictoriaLogs 字段映射**（`src/common/logger/victorialogs-stream.ts`，对业务代码透明）：
  入站前自动把 `message` 复制为 `_msg`（VictoriaLogs 的消息主体字段，缺失时整条日志会被降级成
  `_msg: "missing _msg field"` 占位文本）、`timestamp` 映射为 `_time`（否则按接收时间索引）。
  业务代码照常写 `message` / `timestamp`，不要在 meta 里手工传 `_msg` / `_time`。
- **嵌套对象会被摊平**：VictoriaLogs 把嵌套 JSON 展开成点号字段名，所以 `error` 序列化后
  在查询结果里是 `error.message` / `error.stack` / `error.type` 三个**字段名**，不是嵌套对象。
