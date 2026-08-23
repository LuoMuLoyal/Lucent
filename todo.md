# Lucent neverthrow 迁移 TODO

本文件记录迁移过程中发现的非阻塞性遗留问题，供 Phase C 统一收尾或后续任务处理。

## Task 4 遗留（已记录，非阻塞）

1. **e2e 断言漂移：`test/e2e/auth/auth.e2e-spec.ts`**
   - `should reject wrong password` / `should reject non-existent email`：期望 `AUTH_REQUIRED`，实际为 `AUTH_WRONG_PASSWORD`（状态码仍为 401，code 变更）。
   - `should reject duplicate email`：期望 `409 CONFLICT`，实际为 `401 AUTH_WRONG_PASSWORD`（反枚举设计变更）。
   - 处理时机：Task 11 全量验收 `pnpm test:e2e:ci` 时统一更新；不应回退业务行为。

2. **契约文档未同步错误响应**：
   - `docs:check` 的 `docs-openapi` 规则提示 `docs/01-reference/contracts/*.md` 未同步 auth/account 新增错误响应。
   - 处理时机：Task 11 导出 openapi 后统一更新契约文档，或在 Task 5 session/token 完成后一并处理。

3. **客户端错误文案核对**：
   - 旧版定向提示（如「OAuth 账号请用 set-password/验证码删除」）被统一 catalog 文案替代，前端 UX 需核对可操作指引。
   - 处理时机：跨仓合同统一任务，导出 openapi 后同步 Luminous。

4. **注册并发同邮箱竞态**：
   - 查重与 `userService.create` 非原子，并发同邮箱时后到者触发 Prisma P2002，当前经 `lift` rethrow 为 500。
   - 处理时机：UserService.create 迁移时映射 P2002 到 `RESOURCE_CONFLICT` 或反枚举 `AUTH_WRONG_PASSWORD`。

## 通用后续

- 删除 `plans/2026-08-23-neverthrow-migration-order.md` 并从 `plans/README.md` 移除索引（Task 11 Step 6）。
- 旧 i18n key 清理：`auth.login_rate_limited`、`auth.verification_code_*` 等已无源码引用（Task 11 清理）。
