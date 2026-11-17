-- 提醒投递记录三通道落库：唯一键加入 channel 维度（ADR-0013）。
--
-- 同一提醒事件 (userId, reminderId, scheduledFor) 允许 in_app/local/push
-- 各一行审计记录；同一通道同一事件最多一行。历史行 channel 均为 'in_app'
-- 且 (userId, reminderId, scheduledFor) 已唯一，无重复可去重，直接 DROP 旧
-- 唯一索引并建立四列唯一索引。
--
-- 索引名由 Prisma 按 63 字符截断规则生成（..._scheduled_for__key）。

-- DropIndex
DROP INDEX "user_reminder_deliveries_user_id_reminder_id_scheduled_for_key";

-- CreateIndex
CREATE UNIQUE INDEX "user_reminder_deliveries_user_id_reminder_id_scheduled_for__key" ON "user_reminder_deliveries"("user_id", "reminder_id", "scheduled_for", "channel");
