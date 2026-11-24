-- `user_medicine_notify_marks` 跟随模块短名：表、索引与外键约束一并去掉 `user_` 前缀。
--
-- 这张表由 `20261124130000` 创建，命名沿用了当时 `today-suggestion` 的
-- `user_*` 风格；模块已改短名，表名随之对齐。
--
-- 只改名字：列、唯一键语义、级联行为都不变。

ALTER TABLE "user_medicine_notify_marks" RENAME TO "medicine_notify_marks";

ALTER INDEX "user_medicine_notify_marks_pkey"
  RENAME TO "medicine_notify_marks_pkey";
ALTER INDEX "user_medicine_notify_marks_user_id_current_medicine_id_notify_date_key"
  RENAME TO "medicine_notify_marks_user_id_current_medicine_id_notify_da_key";
ALTER INDEX "user_medicine_notify_marks_user_id_notify_date_idx"
  RENAME TO "medicine_notify_marks_user_id_notify_date_idx";

ALTER TABLE "medicine_notify_marks"
  RENAME CONSTRAINT "user_medicine_notify_marks_user_id_fkey"
  TO "medicine_notify_marks_user_id_fkey";
ALTER TABLE "medicine_notify_marks"
  RENAME CONSTRAINT "user_medicine_notify_marks_current_medicine_id_fkey"
  TO "medicine_notify_marks_current_medicine_id_fkey";