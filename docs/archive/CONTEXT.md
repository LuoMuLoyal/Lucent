# Lucent Domain Context

## Error contract vocabulary

- **Problem Details**：普通 HTTP 4xx/5xx 的机器可读错误表示；它包含稳定的 `type`、`title`、`code`，以及安全、可操作的 `detail`。
- **Stable error code**：客户端分支和重试策略使用的字符串标识。它不编码 HTTP status，也不使用历史 `HHHSSS` 数字格式。
- **Title**：错误类别的稳定短标题，用于日志、调试和默认展示；客户端不得依赖它做业务分支。
- **Detail**：本次请求的安全、具体、可操作描述；可按 `Accept-Language` 本地化，但不能承担机器语义。
- **SSE error event**：连接建立后发送的流终止错误。它复用 Problem Details 的 `type`、`title`、`code`、`detail` 和重试提示；事件专属的 `status` 只表示流终止原因，不是 HTTP status。
- **Unknown failure**：无法归类的编程或基础设施故障。对客户端使用稳定的 `INTERNAL_ERROR` Problem Details，对服务端保留完整日志和 trace 关联。
