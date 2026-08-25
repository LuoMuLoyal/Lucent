# Lucent neverthrow 迁移 TODO

本文件记录迁移过程中发现的非阻塞性遗留问题。

## 保留项（跨仓 / 独立任务）

1. **客户端错误文案核对**：
   - 旧版定向提示（如「OAuth 账号请用 set-password/验证码删除」）被统一 catalog 文案替代，前端 UX 需核对可操作指引。
   - 跨仓任务，需 Luminous 端配合。

2. **P2-F：medicines 模块 ResultAsync 迁移**：
   - Task 11 仅将 `api-errors.ts` 的旧 helper 内联为等价 Nest 异常，该模块尚未按 ResultAsync 边界迁移。
   - 涉及 5 处直接抛异常 + repository 层改造，需作为独立任务处理。

3. **Luminous 后续收尾**：
   - 见 `plans/2026-08-25-error-handling-and-l10n-remediation-plan.md`。
