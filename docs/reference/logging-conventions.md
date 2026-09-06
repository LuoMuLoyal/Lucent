---
status: active
owner: backend
quadrant: reference
updated: 2026-09-06
---

# Logging Conventions

Lucent 统一使用 NestJS `Logger`（nest-winston 输出）。结构化日志（`logger.warn/error(…, meta)`）
的字段名不做全局强制，但**在 `src/` 内保持一致的命名约定**，避免日志聚合工具（VictoriaLogs /
ELK）按字段名过滤时出现「同名含义不同、同义不同名」的漂移。

## 字段名约定

| 字段                             | 含义                                                                               | 示例                                                              |
| -------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `error`                          | 错误对象 / 错误信息（**不要用 `err`**）                                            | `{ error, key: cacheKey, traceId, spanId }`                       |
| `key` / `userId` / `userSegment` | 关联上下文键                                                                       | `{ error, userId, traceId, spanId }`                              |
| `traceId` / `spanId`             | 活跃 OTel span 的链路 ID（经 `getActiveTraceIds()`，无活跃 span 时为 `undefined`） | `{ error, key, traceId, spanId }`                                 |
| `code`                           | 稳定的业务错误码（与 Problem Details `code` 注册表同源）                           | `{ code: 'AUTH_REFRESH_TOKEN_INVALID', reason }`                  |
| `event`                          | fire-and-forget / 异步侧失败的稳定事件名                                           | `{ userId, event: 'password_change_notification_failed', error }` |

## 规则

1. **错误字段名固定为 `error`**：`err` 是历史残留（2026-09-05 审查 S3 对齐了
   `dashboard.service.ts` 的 5 处），新代码一律用 `error`。若要将 `Error` 对象本身写入
   Winston，直接传对象（`winston` 会序列化 `message`/`stack`），或传
   `error instanceof Error ? error.message : String(error)` 的字符串。
2. **不要重复已由 Winston 自动附加的字段**：`trace_id` / `span_id` 由 `otelTraceFormat`
   在活跃 span 内自动附加；`context`、`level`、`message`、`timestamp` 为保留键。
   （显式传入的 `traceId`/`spanId` camelCase 字段仅在无活跃 span 的 bootstrap/队列场景
   作为补充信息，见 `dashboard.service.ts`。）
3. **敏感信息严禁入日志**：token、密码、cookie、真实凭据、请求 URI 中可能携带的 token。
4. **错误信息用两个通道**：`logger.warn` 用于业务降级/失败但可继续；`logger.error` 用于
   真正的异常路径（会进入 Sentry 等异常通道）。
5. **结构化与模板并用**：有上下文的失败用结构化 `(message, meta)`；纯字符串调试信息
   用模板字符串即可。

## 相关

- 日志框架选型与理由：[adr/0007-logging-pino-to-winston.md](adr/0007-logging-pino-to-winston.md)
- Winston transport 与格式配置：`src/common/logger/logger.config.ts`
