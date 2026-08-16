# ADR-0013: 提醒投递记录三通道落库（in_app / local / push）

- **Status**: accepted
- **Date**: 2026-08-16
- **Deciders**: LuoMuLoyal

> 本 ADR **修订 [ADR-0011](0011-reminder-delivery-at-least-once.md) 中
> `(userId, reminderId, scheduledFor)` 唯一约束部分**：唯一键加入 `channel`
> 维度。ADR-0011 关于「先发通知、后写记录」与 at-least-once 的语义对
> in_app 通道仍然成立。

## Context

提醒投递此前只有 `channel='in_app'` 一种审计行：调度器每分钟 tick 写
in_app 行并发送站内通知，push 发送（JPush）与本地通知展示（客户端本地
调度）均不落投递行，投递历史无法反映真实的三条通道，也无法区分
「本地已送达」与「后台推送兜底」。

设计目标（F-4 三通道落库，含 F-2 本地回执、F-3 push 结果记录）：

- **一个提醒事件最多一次打扰**：前台仅应用内提示；后台本地通知优先，
  失败或不可达才 JPush；站内信只保留记录、不再额外弹出。
- 三通道各自落审计行，投递历史诚实反映每条通道的送达/失败情况。
- 本地通知展示后由客户端幂等回写；push 发送结果按 delivered/failed 落库。

## Decision

### 1. 唯一约束加入 channel 维度

`UserReminderDelivery` 唯一约束由 `(userId, reminderId, scheduledFor)`
改为 `(userId, reminderId, scheduledFor, channel)`：同一提醒事件允许
in_app / local / push 各一行，同一通道同一事件最多一行。历史行
channel 全为 `'in_app'` 且旧唯一约束保证无重复，migration 直接 DROP 旧
唯一索引并建立四列唯一索引，无需数据清理。

### 2. 三通道语义

- **in_app（站内通知）**：调度器每 tick 始终写入（作为通知中心记录），
  沿用 ADR-0011 的 findFirst 快速路径 + `createMany({ skipDuplicates: true })`
  at-least-once 语义。
- **local（本地通知）**：由客户端展示后通过
  `POST /api/v1/user/reminder-deliveries/receipts` 幂等回写
  `status='delivered'`。`scheduledFor` 由墙钟日期+时间按用户 profile 时区
  换算为 UTC 并截断到分钟（与调度器同一算法）。
- **push（JPush）**：仅当本地能力为 `unconfirmed`（能力未知）或
  `unavailable`（本地不可达）时作为后台回退发送；`active`（本地可达）或
  `disabled`（用户关闭）时完全不发。发送结果按
  `delivered`/`failed`（含 `errorMessage`）落 push 审计行，`skipDuplicates`
  保证重叠 tick 幂等。

### 3. 本地调度能力状态机

客户端通过 `PUT /api/v1/user/reminder-deliveries/local-capability` 上报，
写入缓存 `reminder:local-capability:{userId}`，TTL 14 天：

| 状态          | 含义                                  | push 兜底 |
| ------------- | ------------------------------------- | --------- |
| `unconfirmed` | 未上报/缓存缺失（首次下发前能力未知） | 发送      |
| `unavailable` | 本地通知不可达（权限被拒等）          | 发送      |
| `active`      | 本地通知可达                          | 不发送    |
| `disabled`    | 用户关闭本地通知且不希望收到推送打扰  | 不发送    |

### 4. 投递语义与取舍

- **at-least-once 按通道保持**：in_app 由调度器重试保证；local 由客户端
  展示后回写保证；push 为 best-effort 附加通道。
- **push 失败不重试**：push 失败仅落 failed 审计行，不阻塞后续 tick 的
  in_app 投递，也不引入独立重试队列——推送是本地失败的降级兜底，
  重复打扰收益小于成本。
- **已知假设：设备时区 ≈ 用户 profile 时区**。回执的墙钟时间按 profile
  时区换算；若设备时区与 profile 不一致，`scheduledFor` 可能偏移数小时，
  导致 local 行与调度器写入的 in_app 行不在同一分钟。客户端上报时应使用
  与调度器一致的用户时区语义（后续如需严格对齐，可在回执中携带
  设备时区标识并做差异校准）。

## Options Considered

| Option                         | Pros                           | Cons                                         |
| ------------------------------ | ------------------------------ | -------------------------------------------- |
| 唯一键加 channel（本 ADR）     | 三通道各一行、语义诚实；改动小 | 同一事件 in_app+local 两行并存，去重需按通道 |
| 保持单一通道行、channel 覆盖写 | 表最小                         | 丢失通道级审计，无法追溯 push 失败           |
| 独立投递事件表 + 通道子表      | 关系模型最规范                 | 过度设计，收益与当前查询模式不匹配           |
| push 失败重试（队列化）        | 提高推送到达率                 | 复杂度显著上升；推送仅作本地失败兜底，收益低 |

## Consequences

- `user_reminder_deliveries` 唯一键变为
  `(userId, reminderId, scheduledFor, channel)`，同一事件最多三条审计行
  （in_app/local/push 各一）。
- 调度器 dispatch 流程扩展为：in_app 去重 → 站内通知 → in_app 行 →
  local 行检查 → 能力门控 → push 发送 → push 行（delivered/failed）。
- `PushDeliveryService.sendToUser` 返回 `{ sent, errorMessage? }` 而非
  void，调用方（调度器）据此落审计行；未配置时返回 `{ sent: false }`。
- 新增投递写入接口：`POST .../receipts`（本地回执，幂等）与
  `PUT .../local-capability`（能力上报）。
- ADR-0011 的 in_app at-least-once 语义不受影响；其唯一约束表述由本 ADR
  修订。
