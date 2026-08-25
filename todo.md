# Lucent neverthrow 迁移 TODO

本文件记录迁移过程中发现的非阻塞性遗留问题，供 Phase C 统一收尾或后续任务处理。

## Task 4 遗留（已记录，非阻塞）

1. **e2e 断言漂移：`test/e2e/auth/auth.e2e-spec.ts`**
   - `should reject wrong password` / `should reject non-existent email`：期望 `AUTH_REQUIRED`，实际为 `AUTH_WRONG_PASSWORD`（状态码仍为 401，code 变更）。
   - `should reject duplicate email`：期望 `409 CONFLICT`，实际为 `401 AUTH_WRONG_PASSWORD`（反枚举设计变更）。
   - 处理时机：Task 11 未修复，已转为 **P2-A** 保留；后续统一同步 e2e 断言，不应回退业务行为。

2. **契约文档未同步错误响应**：
   - `docs:check` 的 `docs-openapi` 规则提示 `docs/01-reference/contracts/*.md` 未同步 auth/account 新增错误响应。
   - 处理时机：Task 11 导出 openapi 后统一更新契约文档，或在 Task 5 session/token 完成后一并处理。

3. **客户端错误文案核对**：
   - 旧版定向提示（如「OAuth 账号请用 set-password/验证码删除」）被统一 catalog 文案替代，前端 UX 需核对可操作指引。
   - 处理时机：跨仓合同统一任务，导出 openapi 后同步 Luminous。

4. **注册并发同邮箱竞态**：
   - 查重与 `userService.create` 非原子，并发同邮箱时后到者触发 Prisma P2002，当前经 `lift` rethrow 为 500。
   - 处理时机：UserService.create 迁移时映射 P2002 到 `RESOURCE_CONFLICT` 或反枚举 `AUTH_WRONG_PASSWORD`。

## Task 11 遗留（P2）

Task 11 最终门禁已通过，以下问题非阻塞，列为后续 P2：

- **P2-A：e2e 断言同步。** `pnpm test:e2e:ci` 仍有 48 个失败，全部为 Task 8–10 引入的既有断言漂移（典型如 owner 不匹配期望 404 实际返回 403 `FORBIDDEN`）。失败文件集合与数量已写入迁移日志，需在非冻结窗口统一修复。
- **P2-B：controller 层 `unwrapResult` 失败折叠路径单测不足。** assistant/today/reports 各 controller 仅有成功路径覆盖，失败折叠未在单测中断言。
- **P2-C：`runtime.service` 基础设施失败码评审。** 当前 `getStateHistory` 读取 checkpoint 失败映射为 `VALIDATION_FAILED`（迁移前为 `BadRequestException`），是否应改为 `INTERNAL_ERROR` 待后续决策。
- **P2-D：SSE 客户端取消帧。** 当前 `SseConnectionRegistry` 仅关闭连接，不发送 `cancelled` 帧；是否补充需后续 UX/性能评估。
- **P2-E：环境文档断链。** `docs/01-reference/environment.md:12` 的 wikilink `env-yaml-evaluation-research` 仍断裂，为既有问题，与错误迁移无关。
- **P2-F：medicines 模块 ResultAsync 迁移。** Task 11 仅将 `api-errors.ts` 的旧 helper 内联为等价 Nest 异常，该模块尚未按 ResultAsync 边界迁移。

## 错误处理总计划进度

Lucent `plans/2026-08-18-error-contract-and-neverthrow-migration-plan.md` 与 Luminous `plans/2026-08-17-error-handling-reform-plan.md` 均已完成并删除。

### Lucent（后端）

- [x] 跨端 Problem Details 契约：RFC 9457 `application/problem+json`、稳定字符串 code、`retryAfter`/`Retry-After`、contract 测试。
- [x] neverthrow 项目入口与 `DomainFailure` 边界：`src/common/result/index.ts` 为唯一入口；repository/application 返回 `ResultAsync<T, DomainFailure>`；controller 使用 `unwrapResult` 折叠；SSE 使用 `SseProblemDetailsMapper`。
- [x] 硬切删除清单：`api-errors.ts` 旧 helper 已删除；业务代码无直接 `neverthrow` 导入；无 `preserveThrow`、无 `{ ok: false }`、无默认空值隐藏失败。
- [x] OpenAPI 与合同：`docs/openapi.json` 已同步（127 paths / 268 schemas），`test:contract` 通过。
- [x] 最终门禁：lint/format/typecheck/build/test:ci/docs:verify 全通过；`test:e2e:ci` 48 个失败为既有断言漂移，非回归。
- [ ] 未竟：e2e 断言同步、controller 失败折叠单测、medicines 模块 ResultAsync 迁移、runtime 失败码评审。

### Luminous（前端）

- [x] `fpdart: ^1.2.0` 已引入，`core/errors/lucent_failure.dart` 已定义 `LucentFailure` / `LucentFailureKind`。
- [x] `LucentFailure.fromProblemDetails` / `fromSseProblemDetails` 已按 Lucent 字段解析 `type/title/detail/code/errors/retryable/retryAfter/traceId/status`。
- [x] 所有 domain repository 已迁移到 `TaskEither<LucentFailure, T>`；`api_exception.dart`、`runGuarded`、旧 `Result<T>` / `Success` / `Failure`、`AppError` 已全部删除。
- [x] 阶段 0–4 全部完成；旧类型、旧 helper、旧错误码 fallback 无生产引用。
- [ ] 后续收尾见 `plans/2026-08-25-error-handling-and-l10n-remediation-plan.md`。

**结论：Lucent 后端与 Luminous 前端的错误契约硬切均已主体完成。**

## 通用后续

- [x] 删除 `plans/2026-08-23-neverthrow-migration-order.md` 并从 `plans/README.md` 移除索引（Task 11 已完成）。
- [ ] 旧 i18n key 清理：`auth.login_rate_limited` 已无源码引用；`auth.verification_code_*` 中 `auth.verification_code_sent` 仍在 `credential.service.ts` 使用，需核对该 key 是否仍需要，其余无引用 key 可清理。
