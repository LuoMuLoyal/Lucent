-- 删除自研记忆表（assistant_memories）。
--
-- 记忆存储已切到 Mem0 sidecar（见 `application/services/memory.ts` 与
-- `infrastructure/memory/mem0-client.ts`）：抽取、去重、召回全部由 sidecar 承担，
-- Prisma 侧的 `AssistantMemory` 行已无任何读写方。
--
-- 为什么现在直接 DROP 而不是先迁数据：`MEM0_ENABLED` 一直为 false（sidecar 从未
-- 在生产启用），所以这张表里不存在「用户真实记忆」，只有本轮重构前测试环境写过的
-- 行。把一批无法验证归属的推断行导进 Mem0，正是 WeKnora 场景里要避免的
-- 「静默断言错误猜测」。若将来需要保留历史，应从备份恢复，而不是让一张无主的表
-- 长期躺在迁移域外。
--
-- 外键单向依赖 assistant_conversations：删表不会影响会话与消息本身。

DROP TABLE IF EXISTS "assistant_memories";