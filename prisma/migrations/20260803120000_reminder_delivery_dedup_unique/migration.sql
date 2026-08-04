-- Reminder 调度去重原子化：先清理历史重复投递记录（保留最早一条），
-- 再为 (userId, reminderId, scheduledFor) 添加唯一约束，作为重叠 tick 的
-- 原子兜底（scheduler 使用 createMany skipDuplicates，见 ADR-0011）。

-- 使用 ctid + ROW_NUMBER 按 created_at 去重，避免 O(n²) 自连接导致大表迁移超时或锁表。
WITH duplicates AS (
  SELECT ctid
  FROM (
    SELECT
      ctid,
      ROW_NUMBER() OVER (
        PARTITION BY "user_id", "reminder_id", "scheduled_for"
        ORDER BY "created_at" ASC, ctid ASC
      ) AS rn
    FROM "user_reminder_deliveries"
  ) ranked
  WHERE rn > 1
)
DELETE FROM "user_reminder_deliveries"
WHERE ctid IN (SELECT ctid FROM duplicates);

CREATE UNIQUE INDEX "user_reminder_deliveries_user_id_reminder_id_scheduled_for_key"
ON "user_reminder_deliveries"("user_id", "reminder_id", "scheduled_for");
