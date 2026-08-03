# ADR-0011: Reminder 投递去重的至少一次语义

- **Status**: accepted
- **Date**: 2026-08-03
- **Deciders**: LuoMuLoyal

## Context

`ReminderSchedulerService` 每分钟经 BullMQ Repeatable Job 扫描到期用药提醒并投递
in-app 通知。投递记录（`user_reminder_deliveries`）用于去重：同一
`(reminderId, scheduledFor)` 只投递一次。

2026-08-01 队列加固审查发现两个问题：

1. **无唯一约束**：`user_reminder_deliveries` 只有普通索引，scheduler 注释声称
   「DB 唯一 delivery 记录去重」与实际不符；重叠 tick（多实例或单 tick 超过 60s）
   可产生重复投递记录与重复通知。
2. **原方案不成立**：`createMany({ skipDuplicates: true })` 依赖唯一约束才生效，
   需先加 `@@unique` 并出 migration；且「先发通知、后写记录」的顺序下，重叠 tick
   会先各自发出通知，createMany 只能去重记录、无法去重发送。

## Decision

采用**至少一次投递（at-least-once）**语义，保持「先发通知、后写记录」不变：

- schema 增加 `@@unique([userId, reminderId, scheduledFor])`；
  migration 先清理历史重复记录（保留最早一条）再建唯一索引。
- `dispatchSingle` 保留 `findFirst` 快速路径；记录写入改为
  `createMany({ skipDuplicates: true })`，重叠 tick 的重复 insert 被原子跳过
  （不再抛 P2002）。
- 通知失败时不写投递记录，下个 tick 重试（原语义保留）。
- 接受代价：**真正的多实例并发重叠下，通知可能被投递两次**（两个 tick 都通过
  findFirst 并先后发出通知，只有记录写入被去重）。

之所以不选 claim-first 严格去重（先插 pending 占位 → 发通知 → 置 delivered，
失败删 claim 并清理崩溃残留）：

- 单实例部署下 BullMQ 单 worker 顺序消费，tick 不会真并发，at-least-once 的
  重复窗口在实际中几乎不可达；
- claim-first 引入 stale-claim 清理复杂度，收益与当前部署形态不匹配。

## Options Considered

| Option                             | Pros                                       | Cons                                                  |
| ---------------------------------- | ------------------------------------------ | ----------------------------------------------------- |
| at-least-once + 唯一约束（本 ADR） | 简单、与现设计一致；记录不重复，失败可重试 | 多实例真并发下通知可能重复投递                        |
| claim-first 严格去重               | 多实例下通知也不重复                       | 需 pending 状态机 + 崩溃残留清理，复杂度显著上升      |
| 维持现状（findFirst + create）     | 零改动                                     | 无兜底：重叠 tick 产生重复记录 + P2002 噪音，注释失实 |

## Consequences

- `user_reminder_deliveries` 获得 `(userId, reminderId, scheduledFor)` 唯一约束，
  重复记录在 DB 层被禁止。
- scheduler 注释与实现一致：去重 = findFirst 快速路径 + 唯一约束原子兜底。
- 若未来上线多实例且要求通知严格去重，需升级为 claim-first 方案并评估
  stale-claim 清理策略。
