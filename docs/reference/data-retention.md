---
status: active
owner: backend
quadrant: reference
updated: 2026-08-31
---

# Data Retention — 数据保留与账户删除语义

数据保留由 `DataRetentionService`（`src/modules/data-retention/services/data-retention.service.ts`）统一执行；
本文件是服务端持久化数据保留行为的唯一事实清单（客户端本地数据保留见 Luminous 侧文档）。

## 每日清理管道（03:00 UTC）

`DATA_RETENTION_CRON = '0 3 * * *'`（BullMQ 定时任务，队列 `lucent-cron`），
`cleanupExpiredData()` 顺序执行五类清理；单类失败只记日志、不阻断后续类别：

| 数据                              | 保留期   | 判定依据                                | 执行                    |
| --------------------------------- | -------- | --------------------------------------- | ----------------------- |
| 用户会话 `UserSession`            | 过期即删 | `expiresAt < now`                       | `deleteMany`            |
| 已读通知 `UserNotification`       | 30 天    | `isRead && readAt < now-30d`            | `deleteMany`            |
| 反馈抑制 `UserSuggestionFeedback` | 过期即删 | `expiresAt < now`                       | `deleteMany`            |
| 原始产品事件 `UserProductEvent`   | 90 天    | `occurredAt < now-90d`                  | `deleteMany`            |
| 软删除账户 `User`                 | 30 天    | `deletedAt < now-30d && status=deleted` | `deleteMany`（FK 级联） |

## 产品事件保留（90 天，按 occurredAt）

- 原始事件 `UserProductEvent` 保留 **90 天**，按 `occurredAt`（事件发生时间，客户端上报时间）判定，
  不是服务端接收时间——离线缓冲上报不延长保留期。
- `occurredAt` 未来偏移上限 24h（`MAX_PRODUCT_EVENT_FUTURE_SKEW_MS`）：无限未来的时间戳永远不会命中清理，
  该上限保护隐私硬保证。
- 索引 `[occurredAt]` 供清理扫描；`[userId, occurredAt]` 供账户删除级联与日聚合查询。
- 事件载荷只含白名单枚举与固定属性，**无 metadata JSON 列**——保留面没有健康内容可泄漏。
- 写入面防护：`POST /product-events` 在全局限流（100 req/min）之上叠加专属限流（10 req/min，
  单批 ≤50 事件），高频小批量无法放大数据库写入压力，保留/清理管道不被滥用压垮。

## 账户删除与级联

- 账户删除为「软删除（`status=deleted` + `deletedAt`）→ 30 天后 cron 硬删除」两段式。
- 硬删除走 `prisma.user.deleteMany`，以下表以 FK `onDelete: Cascade` 即时级联清除，
  **不等待各自保留期**：
  - `UserProductEvent.userId` — 该用户全部原始事件
  - `UserClinicSummaryShare.userId` — 该用户全部分享记录（含已撤销/已过期记录）
- 级联只影响原始事件与分享记录；漏斗没有持久化聚合，无 userId 维度残留。

## 漏斗与保留窗口的关系

- `GET /api/v1/user/product-events/funnel` **不持久化聚合**，每次按窗口实时读原始事件——
  查询窗口只能覆盖仍处于 90 天保留期的事件；更早的窗口会因原始事件已清除而**静默低估**。
- 窗口另有 `MAX_FUNNEL_RANGE_DAYS = 30`（包含日）上限与缺省「最近 30 个包含日」约束，
  正常管理视图远小于保留窗口，低估仅在显式查询 90 天前窗口时发生。

## 就诊摘要分享保留（7 天 TTL + 可撤销）

- 分享记录 `UserClinicSummaryShare`：`expiresAt = createdAt + 7 天`（`DEFAULT_SHARE_TTL_DAYS`）。
- 只存 `tokenHash`（sha256），明文 token 创建时返回一次；token 不进日志、错误消息或 query string。
- 撤销（`DELETE /shares/:shareId`）后公开 GET/PDF 一律 404（与未知/过期 token 同语义）。
- 已过期/已撤销的记录**不删除**（属主分享管理列表仍显示，含 `revokedAt` 标记），
  随账户硬删除级联清除。
- 公开读取每次原子记录 `accessCount`/`lastAccessedAt`（首次记 `firstAccessedAt`）；
  无逐次访问明细、无访问者身份信息。
- 分享过期判定与生命周期时间戳统一取自公共时间源 `now()`（含 legacy cache-only 分享路径
  `ClinicSummaryService.createShareLink`/`getSharedSummary`），与 `ShareService` 一致。
