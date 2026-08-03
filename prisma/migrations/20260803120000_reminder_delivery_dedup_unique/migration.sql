-- Reminder 调度去重原子化：先清理历史重复投递记录（保留最早一条），
-- 再为 (userId, reminderId, scheduledFor) 添加唯一约束，作为重叠 tick 的
-- 原子兜底（scheduler 使用 createMany skipDuplicates，见 ADR-0011）。
DELETE FROM "user_reminder_deliveries" a
USING "user_reminder_deliveries" b
WHERE a."created_at" > b."created_at"
  AND a."user_id" = b."user_id"
  AND a."reminder_id" = b."reminder_id"
  AND a."scheduled_for" = b."scheduled_for";

CREATE UNIQUE INDEX "user_reminder_deliveries_user_id_reminder_id_scheduled_for_key"
ON "user_reminder_deliveries"("user_id", "reminder_id", "scheduled_for");
