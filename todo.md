# Lucent neverthrow 迁移 TODO

本文件记录迁移过程中发现的非阻塞性遗留问题。

## 保留项（独立任务）

1. **P2-F：medicines 模块 ResultAsync 迁移**：
   - Task 11 仅将 `api-errors.ts` 的旧 helper 内联为等价 Nest 异常，该模块尚未按 ResultAsync 边界迁移。
   - 涉及 5 处直接抛异常 + repository 层改造，需作为独立任务处理。
