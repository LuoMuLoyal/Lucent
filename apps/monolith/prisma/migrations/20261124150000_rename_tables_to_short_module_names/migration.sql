-- 表名与索引名跟随模块短名。
--
-- 这些表在表名里保留了旧模块名（`user_daily_records` / `user_medicine_reminders`
-- / `data_export_requests` 等）。模块目录已改短，持久化层随之对齐。
--
-- ## 只动名字，不动语义
--
-- 全部是 `RENAME`：列、约束、外键行为、数据都不变。`ALTER TABLE ... RENAME`
-- 会连带更新引用该表的内部登记，但**不会**改索引名，因此索引逐条改名——
-- 索引名同样出现在慢日志、`EXPLAIN` 与锁等待输出里。
--
-- 新名由 Prisma schema 推导（`prisma migrate diff --from-empty --to-schema prisma`），
-- 注意它对超过 63 字符的名字做了截断，本文件用的是截断后的真实名。
--
-- ## 不改的表
--
-- `user_profiles` / `user_sessions` / `user_allergies` / `user_current_medicines`
-- 里的 `user_` 表示「这一行属于某个用户」，不是模块名。
-- `medicine_*` 属于 `medicines` 模块（本次未改名）。

ALTER TABLE "user_daily_records" RENAME TO "records";
ALTER INDEX "user_daily_records_pkey" RENAME TO "records_pkey";
ALTER INDEX "user_daily_records_user_id_occurred_at_occurred_time_idx"
  RENAME TO "records_user_id_occurred_at_occurred_time_idx";
ALTER INDEX "user_daily_records_user_id_kind_idx" RENAME TO "records_user_id_kind_idx";
ALTER INDEX "user_daily_records_user_id_meal_analysis_status_idx"
  RENAME TO "records_user_id_meal_analysis_status_idx";
ALTER INDEX "user_daily_records_user_id_meal_analysis_updated_at_idx"
  RENAME TO "records_user_id_meal_analysis_updated_at_idx";
ALTER INDEX "user_daily_records_user_id_deleted_at_idx"
  RENAME TO "records_user_id_deleted_at_idx";
ALTER INDEX "user_daily_records_user_id_health_event_id_idx"
  RENAME TO "records_user_id_health_event_id_idx";

ALTER TABLE "user_daily_record_attachments" RENAME TO "record_attachments";
ALTER INDEX "user_daily_record_attachments_pkey" RENAME TO "record_attachments_pkey";
ALTER INDEX "user_daily_record_attachments_user_id_record_id_idx"
  RENAME TO "record_attachments_user_id_record_id_idx";

ALTER TABLE "user_medicine_reminders" RENAME TO "reminders";
ALTER INDEX "user_medicine_reminders_pkey" RENAME TO "reminders_pkey";
ALTER INDEX "user_medicine_reminders_active_idx" RENAME TO "reminders_active_idx";
ALTER INDEX "user_medicine_reminders_user_id_current_medicine_id_idx"
  RENAME TO "reminders_user_id_current_medicine_id_idx";
ALTER INDEX "user_medicine_reminders_user_id_deleted_at_idx"
  RENAME TO "reminders_user_id_deleted_at_idx";
ALTER INDEX "user_medicine_reminders_user_id_start_date_end_date_idx"
  RENAME TO "reminders_user_id_start_date_end_date_idx";

-- 部分唯一索引由 20261124120000 建，那里已用新名 `dose_logs_slot_uniq`。
ALTER TABLE "user_medicine_dose_logs" RENAME TO "dose_logs";
ALTER INDEX "user_medicine_dose_logs_pkey" RENAME TO "dose_logs_pkey";
ALTER INDEX "user_medicine_dose_logs_user_id_scheduled_for_idx"
  RENAME TO "dose_logs_user_id_scheduled_for_idx";
ALTER INDEX "user_medicine_dose_logs_user_id_reminder_id_scheduled_for_idx"
  RENAME TO "dose_logs_user_id_reminder_id_scheduled_for_idx";
ALTER INDEX "user_medicine_dose_logs_user_id_current_medicine_id_scheduled_for_scheduled_time_idx"
  RENAME TO "dose_logs_user_id_current_medicine_id_scheduled_for_schedul_idx";
ALTER INDEX "user_medicine_dose_logs_user_id_deleted_at_idx"
  RENAME TO "dose_logs_user_id_deleted_at_idx";
ALTER INDEX "user_medicine_dose_logs_user_id_health_event_id_idx"
  RENAME TO "dose_logs_user_id_health_event_id_idx";

ALTER TABLE "user_reminder_deliveries" RENAME TO "reminder_deliveries";
ALTER INDEX "user_reminder_deliveries_pkey" RENAME TO "reminder_deliveries_pkey";
ALTER INDEX "user_reminder_deliveries_user_id_scheduled_for_idx"
  RENAME TO "reminder_deliveries_user_id_scheduled_for_idx";
ALTER INDEX "user_reminder_deliveries_user_id_reminder_id_idx"
  RENAME TO "reminder_deliveries_user_id_reminder_id_idx";
ALTER INDEX "user_reminder_deliveries_user_id_channel_status_idx"
  RENAME TO "reminder_deliveries_user_id_channel_status_idx";
ALTER INDEX "user_reminder_deliveries_user_id_reminder_id_scheduled_for__key"
  RENAME TO "reminder_deliveries_user_id_reminder_id_scheduled_for_chann_key";
ALTER INDEX "user_reminder_deliveries_scheduled_for_idx"
  RENAME TO "reminder_deliveries_scheduled_for_idx";

ALTER TABLE "user_notification_preferences" RENAME TO "notification_preferences";
ALTER INDEX "user_notification_preferences_pkey"
  RENAME TO "notification_preferences_pkey";

ALTER TABLE "user_product_events" RENAME TO "product_events";
ALTER INDEX "user_product_events_pkey" RENAME TO "product_events_pkey";
ALTER INDEX "user_product_events_occurred_at_idx" RENAME TO "product_events_occurred_at_idx";
ALTER INDEX "user_product_events_user_id_occurred_at_idx"
  RENAME TO "product_events_user_id_occurred_at_idx";
ALTER INDEX "user_product_events_user_id_client_event_id_key"
  RENAME TO "product_events_user_id_client_event_id_key";

ALTER TABLE "user_today_analysis_materializations" RENAME TO "analysis_materializations";
ALTER INDEX "user_today_analysis_materializations_pkey"
  RENAME TO "analysis_materializations_pkey";
ALTER INDEX "user_today_analysis_materializations_user_id_local_date_key"
  RENAME TO "analysis_materializations_user_id_local_date_key";
ALTER INDEX "user_today_analysis_materializations_user_id_status_idx"
  RENAME TO "analysis_materializations_user_id_status_idx";

ALTER TABLE "legal_documents" RENAME TO "legal";
ALTER INDEX "legal_documents_pkey" RENAME TO "legal_pkey";
ALTER INDEX "legal_documents_doc_type_key" RENAME TO "legal_doc_type_key";
ALTER INDEX "legal_documents_is_active_idx" RENAME TO "legal_is_active_idx";

ALTER TABLE "data_export_requests" RENAME TO "export_requests";
ALTER INDEX "data_export_requests_pkey" RENAME TO "export_requests_pkey";
ALTER INDEX "data_export_requests_user_id_created_at_idx"
  RENAME TO "export_requests_user_id_created_at_idx";
ALTER INDEX "data_export_requests_user_id_kind_created_at_idx"
  RENAME TO "export_requests_user_id_kind_created_at_idx";

-- 外键约束名同样带旧表名，一并改（否则 `\d dose_logs` 会打印旧名）。
ALTER TABLE "records" RENAME CONSTRAINT "user_daily_records_user_id_fkey" TO "records_user_id_fkey";
ALTER TABLE "records" RENAME CONSTRAINT "user_daily_records_health_event_id_fkey" TO "records_health_event_id_fkey";
ALTER TABLE "record_attachments" RENAME CONSTRAINT "user_daily_record_attachments_user_id_fkey" TO "record_attachments_user_id_fkey";
ALTER TABLE "record_attachments" RENAME CONSTRAINT "user_daily_record_attachments_record_id_fkey" TO "record_attachments_record_id_fkey";
ALTER TABLE "reminders" RENAME CONSTRAINT "user_medicine_reminders_user_id_fkey" TO "reminders_user_id_fkey";
ALTER TABLE "reminders" RENAME CONSTRAINT "user_medicine_reminders_current_medicine_id_fkey" TO "reminders_current_medicine_id_fkey";
ALTER TABLE "dose_logs" RENAME CONSTRAINT "user_medicine_dose_logs_user_id_fkey" TO "dose_logs_user_id_fkey";
ALTER TABLE "dose_logs" RENAME CONSTRAINT "user_medicine_dose_logs_current_medicine_id_fkey" TO "dose_logs_current_medicine_id_fkey";
ALTER TABLE "dose_logs" RENAME CONSTRAINT "user_medicine_dose_logs_reminder_id_fkey" TO "dose_logs_reminder_id_fkey";
ALTER TABLE "dose_logs" RENAME CONSTRAINT "user_medicine_dose_logs_health_event_id_fkey" TO "dose_logs_health_event_id_fkey";
ALTER TABLE "reminder_deliveries" RENAME CONSTRAINT "user_reminder_deliveries_user_id_fkey" TO "reminder_deliveries_user_id_fkey";
ALTER TABLE "reminder_deliveries" RENAME CONSTRAINT "user_reminder_deliveries_reminder_id_fkey" TO "reminder_deliveries_reminder_id_fkey";
ALTER TABLE "notification_preferences" RENAME CONSTRAINT "user_notification_preferences_user_id_fkey" TO "notification_preferences_user_id_fkey";
ALTER TABLE "product_events" RENAME CONSTRAINT "user_product_events_user_id_fkey" TO "product_events_user_id_fkey";
ALTER TABLE "analysis_materializations" RENAME CONSTRAINT "user_today_analysis_materializations_user_id_fkey" TO "analysis_materializations_user_id_fkey";
ALTER TABLE "export_requests" RENAME CONSTRAINT "data_export_requests_user_id_fkey" TO "export_requests_user_id_fkey";