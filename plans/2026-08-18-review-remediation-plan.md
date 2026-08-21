# Lucent 8-18 审查整改计划（确定性）

Created: 2026-08-18
Status: active

> 来源：`plans/lucent-review-2026-08-18.md`（审查报告，已对照 HEAD `590de431` 实际代码复核改写；复核结论优先，审查报告中的误报不返工）。
> 权威决策：[`ADR-0012`](../docs/01-reference/adr/0012-error-contract-and-result-boundary.md)。
> 关联计划：[`2026-08-18-error-contract-and-neverthrow-migration-plan.md`](2026-08-18-error-contract-and-neverthrow-migration-plan.md)。
> 本计划的「日志 + OTel + 安全化」整改与 ADR-0012 方向一致，但**不依赖**该计划的门禁：本计划执行期间不切换 HTTP 错误媒体类型，Problem Details 与资源响应契约按独立契约迁移计划实施。

## 一、目标与范围

目标：把 8-18 审查报告的逐条意见落到确定性结论——真实问题修复、已修复项复核关闭、误报项记录原因；全部修复不改变 API 合同。

范围（均在本仓）：

- `src/modules/today-analysis/services/analysis.service.ts`
- `src/modules/assistant/`：`agent/runtime.service.ts`、`services/core.service.ts`、`services/conversation.service.ts`、`services/memory.service.ts`、`tools/tool.service.ts`、`repositories/conversation.repository.ts`、`assistant.controller.ts`
- 缓存无日志扫尾：`rate-limit`、`medicines/cache/store.service.ts`、`medicines/cache/admin.service.ts`、`today-analysis/context.service.ts`、`user-settings`、`suggestion-cache`、`verification-code`、`delivery-receipts`、`lifecycle/manager.service.ts`、`reports/dashboard/dashboard.service.ts`

不涉及：API 合同变更（预期无 OpenAPI diff）、neverthrow/Result 迁移、模块结构重构、相邻代码重构。

## 二、条目处置表（审查 → 复核 → 决定）

| #   | 审查条目                                                              | 复核结论（HEAD `590de431`）                                                                                                                                                                        | 处置                                                                                                                                                                                                                   |
| --- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `analysis.service.ts` 裸 `throw` 暴露内部状态                         | 误报细节：基类 `generate`/`generateStream` 无 catch；实际是 `generateForVersion`/`generateStreamForVersion` 在失败落库后重抛原错误（170/251 行），属基础设施失败重抛，当前 catch 无任何日志        | 修复：重抛前补 `Logger.error`（含原始错误）+ OTel `recordException`，保留落库与重抛语义                                                                                                                                |
| 2   | `runtime.service.ts` 再生无内容裸 `Error`                             | 属实：`replayFromCheckpoint` 574 行 `throw new Error('Assistant regeneration ended without any content.')`                                                                                         | 修复：记录 OTel 事件 + `Logger.error` 原错误，改抛 `InternalServerErrorException`（稳定业务码字符串 + 安全文案，如 `ASSISTANT_REGENERATION_NO_CONTENT`；先例 `analysis.service.ts:132–134`），补 spec                  |
| 3   | `buildToolDetails` 运行时类型检查脆弱                                 | 属实：`core.service.ts` 472–525 行 `typeof` + `as` 断言                                                                                                                                            | 修复：新建 `src/modules/assistant/schemas/tool-detail.schema.ts`（Zod strict schema；先例 `src/common/validators/jsonb-schemas.ts`，zod 4.4.3 已在依赖中），`safeParse` 失败记 warn 并按「无详情」降级；补畸形数据测试 |
| 4   | `enrichTitleWithLlm` 失败完全静默                                     | 部分属实：catch 有 debug 级日志（380–385 行），级别过低不可观测                                                                                                                                    | 修复：提升为 `Logger.warn` + OTel event；补失败分支测试                                                                                                                                                                |
| 5   | 工具并行执行共享超时、单个超时拖垮整批                                | 误报：`tool.service.ts` 96–101 行是 per-tool `Promise.race` 超时，单工具超时不拖垮整批；迟到结算被 `execution.catch(() => undefined)` 静默吞掉                                                     | 修复：迟到结算补 warn 日志（工具名 + 耗时）；补「单工具超时其余结果保留、超时项带 `{ timeout: true }`」测试                                                                                                            |
| 6   | 记忆提取 debounce 无超时保护                                          | 属实：`memory.service.ts` 139–161 行仅靠模型级 `AI_MODEL_TIMEOUT_MS`                                                                                                                               | 修复：提取调用外包独立超时 race（`MEMORY_EXTRACTION_TIMEOUT_MS`，取值大于模型超时），超时记 warn + OTel event，不影响下次调度；补测试                                                                                  |
| 7   | `clearMemory` 端点无审计                                              | 属实：`assistant.controller.ts` 165–174 行；审计设施已存在（`src/modules/audit-log/` → `audit_logs` 表，`account.controller.ts` 有先例），assistant 模块未用                                       | 修复：删除成功后经 `AuditLogService.logFireAndForget` 记录（用户、动作 `assistant.memory.clear`、删除条数）；补测试                                                                                                    |
| 8   | `appendAssistantMessage` 事务无超时                                   | 属实：`conversation.repository.ts` 246/266/309 行三处交互事务均无 `maxWait`/`timeout`；全仓无先例                                                                                                  | 修复：三处补 `{ maxWait: 5000, timeout: 10000 }`（毫秒）；补事务选项断言测试                                                                                                                                           |
| 9   | `AssistantToolDetailDto` vs `AssistantToolExecutionResult` 命名不对称 | 复核：`AssistantToolDetailDto`（`stream-response.dto.ts` 4–64 行，SSE 合同面）与 `AssistantToolExecutionResult`（`types/assistant.types.ts` 204–214 行，运行时面）职责不同；DTO 后缀按命名规则保留 | 关闭：为两者补 JSDoc 说明职责差异，不改名                                                                                                                                                                              |
| 10  | `RegenerationRecordInput` 缺文档                                      | 已有一行 JSDoc（51 行）                                                                                                                                                                            | 轻量补齐字段说明，不改名                                                                                                                                                                                               |
| 11  | reports share 回滚静默吞异常                                          | 已修复：`reports.controller.ts` 394–404 行 `logger.error` + 重抛原缓存错误                                                                                                                         | 关闭，不返工                                                                                                                                                                                                           |
| 12  | recompute 内联去重静默吞异常                                          | 已修复：`today-suggestion/services/recompute/queue.service.ts` 97–116 行有 warn 日志                                                                                                               | 关闭，不返工                                                                                                                                                                                                           |
| 13  | 缓存操作无日志（7 处）                                                | 部分修复：`tool.service.ts`、`runtime.service.ts`、legal-documents、risk-check、base-async-queue、oauth state 已补；仍剩约 10 处                                                                   | 修复：逐处失败路径补 `logger.warn`（见步骤 1.4 清单）                                                                                                                                                                  |

## 三、执行步骤

### 步骤 1：低风险增补（不改变行为）

1. **事务超时（#8）**：`conversation.repository.ts` 三处交互事务补 `{ maxWait: 5000, timeout: 10000 }`。
2. **审计（#7）**：`clearMemory` 成功删除后 `AuditLogService.logFireAndForget`；失败路径不审计（异常已有全局过滤与日志）。
3. **JSDoc（#9/#10）**：两个类型补职责说明与字段说明。
4. **缓存日志（#13）**：以下失败路径补 `logger.warn`（成功路径可 debug，不强制）：
   - `rate-limit.service.ts`（需补 `Logger` import）
   - `medicines/cache/store.service.ts`、`medicines/cache/admin.service.ts`
   - `today-analysis/context.service.ts`（需补 `Logger` import）
   - `user-settings.service.ts`、`suggestion-cache.service.ts`
   - `verification-code.service.ts`、`delivery-receipts.service.ts`
   - `lifecycle/manager.service.ts`（356 行附近）、`reports/dashboard/dashboard.service.ts`（31 行附近）

### 步骤 2：行为修复

5. **#2**：`runtime.service.ts` 574 行改为 OTel 记录 + `Logger.error` + `InternalServerErrorException`（稳定业务码字符串 + 安全文案，如 `ASSISTANT_REGENERATION_NO_CONTENT`，不含内部细节）。
6. **#3**：新建 `src/modules/assistant/schemas/tool-detail.schema.ts`（Zod strict）；`buildToolDetails` 改用 `safeParse`，失败 warn 并按「无详情」降级（不抛、不崩溃）。
7. **#6**：`memory.service.ts` 提取调用外包独立超时 race，超时 warn + OTel，不把超时当业务失败抛出。
8. **#5**：`tool.service.ts` 迟到结算处补 warn 日志（工具名 + 实际耗时）。
9. **#1**：`analysis.service.ts` 两个重抛点核对 catch 日志，缺失则补 `Logger.error` + OTel `recordException` 后重抛。

### 步骤 3：测试与验证

10. 为每个行为修复补 spec：
    - `runtime.service.spec.ts`：再生无内容 → 500 安全错误 + 日志断言
    - `core.service.spec.ts`：`buildToolDetails` 畸形数据 → 降级 undefined + warn
    - `memory.service.spec.ts`：提取超时 → 记日志且不抛给调用方
    - `tool.service.spec.ts`：单工具超时 → 其余结果保留、超时项 `{ timeout: true }`、迟到结算有日志
    - `conversation.repository.spec.ts`：`$transaction` 收到 `{ maxWait, timeout }` 选项
    - `assistant.controller.spec.ts`：`clearMemory` 触发 `AuditLogService`
11. 全量验证：`pnpm lint:check`、`pnpm typecheck`、`pnpm build`、`pnpm test:ci`、`pnpm docs:check`；`pnpm export:openapi` 后确认 OpenAPI 语义 diff 为空（仅防回归）。
12. 收尾：追加 `docs/02-logs/migration-log/2026-08-18.md`（描述范围与验证结论，不写需持续同步的精确数字）；删除本计划文件（实施完毕文件已删；审查报告 `plans/lucent-review-2026-08-18.md` 已随本次改写删除）；确认 `plans/README.md` 已更新。

## 四、硬规则

- 任何保留的 `throw` 必须伴随结构化日志与 OTel 记录；禁止无日志 catch 与无语义 fallback。
- 不引入第三方 Result 库；不提前使用 `application/problem+json`（归门禁计划）。
- 不改 API 合同、不扩大事务边界、不重构相邻代码、不放宽 lint/TS 规则。
- 每个行为修复必须有对应 spec；纯日志/文档增补以 lint + typecheck + 现有测试为验证。

## 五、验收标准

- 处置表 13 项全部关闭（修复 / 复核关闭 / 记录原因）。
- `pnpm lint:check`、`pnpm typecheck`、`pnpm build`、`pnpm test:ci`、`pnpm docs:check` 全绿。
- `pnpm export:openapi` 语义 diff 为空；在本计划执行范围内不改变响应形状。目标响应契约以 ADR-0012 为准。
- grep 复核：无剩余「cache 失败静默」点（失败路径均有 warn 级日志）。

## 六、不做的事

- 不启动 neverthrow / Problem Details 硬切（`2026-08-18-error-contract-and-neverthrow-migration-plan.md` 负责，本计划不为其预埋半成品）。
- 本计划不修改 SSE 事件结构或响应契约；成功资源与 Problem Details 的目标形状以 ADR-0012 为准。
- 不为「命名对称」做大规模重命名（#9 已记录原因关闭）。
- 不处理 in-process 记忆注册表重启丢失（已文档化，另行评估）。
