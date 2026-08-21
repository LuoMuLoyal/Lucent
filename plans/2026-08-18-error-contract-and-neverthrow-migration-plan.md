# Lucent 错误契约与 neverthrow 硬切计划

Created: 2026-08-18
Status: blocked until the Luminous 2026-08-16 plan gate is complete

> 权威决策见 [`ADR-0012`](../docs/01-reference/adr/0012-error-contract-and-result-boundary.md)。
> 本计划与 Luminous 的 `2026-08-17-error-handling-reform-plan.md` 成对执行。

## 启动门禁

在 Luminous `plans/` 下 2026-08-16 的十份功能改造计划全部完成、验证通过、追加迁移日志、通过文档检查并按生命周期规则删除之前，不启动本计划，不修改 Lucent 的普通 HTTP 错误媒体类型或错误码。

门禁满足后，Luminous 必须先具备能够解析 RFC 9457 Problem Details 的 `LucentFailure` 映射；随后两仓库进入一次冻结新功能的集中迁移窗口。本计划不是长期双轨兼容计划。

## 最终目标

- 成功 JSON 响应直接返回 endpoint 定义的资源表示；`204 No Content` 不返回 body。
- 普通 HTTP 4xx/5xx 使用 `application/problem+json`，不再使用错误 success envelope。
- HTTP status 是传输真相；业务码使用稳定字符串，如 `AUTH_TOKEN_EXPIRED`、`RECORD_ALREADY_EXISTS`。
- 领域可恢复失败统一使用项目入口导出的 `neverthrow` `Result`/`ResultAsync`，失败类型命名为 `DomainFailure`。
- HTTP 层使用 `ProblemDetails` mapper；不使用第三方 NestJS Result interceptor。
- 预期失败 Result，未预期故障 throw 到边界；没有静默 catch 或无语义 fallback。

## 阶段一：跨端 Problem Details 契约

1. 在 Lucent 定义 Problem Details 类型、稳定字符串业务码、问题 URI 和安全的 validation `errors` 结构。
2. 改造全局异常 filter：已知领域失败映射 HTTP status/Problem Details，未知异常记录 OTel 后映射安全的 5xx Problem Details。
3. 移除成功 envelope interceptor 和显式成功包装；为健康检查、普通 JSON、集合分页、异步任务和空成功响应补齐对应 OpenAPI schema。
4. 为 SSE 定义 `event: error` 结构，明确事件中的 `status` 仅表示流终止原因。
5. 实现 `retryAfter`/`Retry-After` 语义和幂等方法约束；不得因为错误体存在而自动重试写操作。
6. 导出 OpenAPI，添加 validation/auth/conflict/not-found/dependency/internal 的合同测试。

## 阶段二：neverthrow 领域边界

1. 固定 `neverthrow` 版本并建立 `src/common/result` 项目入口；业务代码不得从第三方包路径散装导入。
2. 定义 `DomainFailure` 联合类型和唯一的 `DomainFailure -> ProblemDetails` mapper。
3. 将所有 repository/application 的预期可恢复失败改为 `ResultAsync<T, DomainFailure>`；基础设施 adapter 在边界将已知故障映射为领域失败。
4. 将 controller 统一折叠 Result，禁止把 Result 原样交给 Nest，也禁止返回 `{ ok: false }` 的 HTTP 200。
5. 处理并测试所有裸 `throw error`、无日志 catch、默认空数组/null fallback；每个保留的降级路径必须有 OTel event/metric、结构化日志和行为测试。
6. 使用 `eslint-plugin-neverthrow` 或等价 CI 检查保证 Result 被显式消费，但不把 lint 当作错误政策的唯一实现。

## 硬切删除清单

- 旧的普通 HTTP 错误 envelope 和对应客户端 fallback；
- 业务用途的 `HHHSSS` 数值错误码；
- `api-errors.ts` 中仅为业务流程服务的 throw helper；
- 未分类的业务 `throw error`；
- 无日志、无契约说明的静默 catch 和默认值降级；
- `@backendkit-labs/result/nestjs` 等第三方 HTTP 适配器（不得引入）。

保留：编程错误、不变量、配置错误、取消、SSE 断流和未分类基础设施异常的 throw 边界；它们必须经过 OTel 和最终 filter。

## 跨仓库发布顺序

1. Luminous 增加 Problem Details 解析、HTTP status 重试判定和 `LucentFailure`，并完成合同测试。
2. Lucent 切换 filter、错误 DTO、OpenAPI 和 SSE error event。
3. 在 Luminous 运行生成客户端同步脚本并更新 mapper。
4. 两端完成 repository/provider 的 Result 硬切和测试。
5. 删除旧错误 fallback、旧类型和旧错误码，完成全量门禁。

## 验收

- 2xx JSON 必须符合 endpoint 的资源 schema，`204` 必须无 body；4xx/5xx 必为 `application/problem+json`。
- Problem Details 不含 `statusCode`、`requestId`、堆栈或内部敏感信息。
- 客户端只按 HTTP status、稳定业务码、幂等性和 Retry-After 决定重试。
- 每类代表性错误均有 Lucent contract/e2e 测试和 Luminous mapper/provider 测试。
- 所有保留的降级路径可在日志、OTel trace/event/metric 中定位。
- 旧规则删除；仓库内只剩一套当前错误处理规范。

## 不做的事

- 不使用 `@backendkit-labs/result`、`@sapphire/result` 或 `antithrow`。
- 不使用 `@backendkit-labs/result/nestjs`、ResultInterceptor、ResultModule 或 `@AsResult()`。
- 不把 SSE 强行伪装成普通 HTTP Problem Details。
- 不把编程错误和取消伪装成 `DomainFailure`。
