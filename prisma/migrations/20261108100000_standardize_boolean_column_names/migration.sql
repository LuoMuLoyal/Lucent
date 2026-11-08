-- 布尔列命名标准化：12 列补 is_ / has_ 前缀。
--
-- 这些全部是 RENAME COLUMN，不是 DROP + ADD。Prisma 的自动 diff 会把重命名
-- 识别成「删列 + 加列」，那会清空这些列的全部存量数据——本文件是人工手写的，
-- 不要用 `prisma migrate dev` 重新生成覆盖它。

-- drugbank_manufacturers: generic → is_generic
ALTER TABLE "drugbank_manufacturers" RENAME COLUMN "generic" TO "is_generic";

-- drugbank_patents: pediatric_extension → has_pediatric_extension
ALTER TABLE "drugbank_patents" RENAME COLUMN "pediatric_extension" TO "has_pediatric_extension";

-- drugbank_products: generic / over_the_counter / approved
ALTER TABLE "drugbank_products" RENAME COLUMN "generic" TO "is_generic";
ALTER TABLE "drugbank_products" RENAME COLUMN "over_the_counter" TO "is_over_the_counter";
ALTER TABLE "drugbank_products" RENAME COLUMN "approved" TO "is_approved";

-- medicine_risk_check_records: stale → is_stale
ALTER TABLE "medicine_risk_check_records" RENAME COLUMN "stale" TO "is_stale";

-- user_notification_preferences: 4 个开关
ALTER TABLE "user_notification_preferences" RENAME COLUMN "health_alerts_enabled" TO "is_health_alerts_enabled";
ALTER TABLE "user_notification_preferences" RENAME COLUMN "weekly_insight_enabled" TO "is_weekly_insight_enabled";
ALTER TABLE "user_notification_preferences" RENAME COLUMN "water_reminders_enabled" TO "is_water_reminders_enabled";
ALTER TABLE "user_notification_preferences" RENAME COLUMN "sleep_reminder_enabled" TO "is_sleep_reminder_enabled";

-- user_suggestions: notification_eligible → is_notification_eligible
ALTER TABLE "user_suggestions" RENAME COLUMN "notification_eligible" TO "is_notification_eligible";

-- users: email_verified → is_email_verified
ALTER TABLE "users" RENAME COLUMN "email_verified" TO "is_email_verified";
