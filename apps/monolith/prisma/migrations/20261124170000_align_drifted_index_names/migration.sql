-- 索引名与 Prisma schema 对齐（既有漂移）。
--
-- 这几条不是本次改名引入的：`prisma migrate diff --from-config-datasource` 一直报
-- RenameIndex，说明历史迁移里手写的索引名与 Prisma 从 schema 推导的名字不一致——
-- 原因是 Postgres 的 63 字符标识符上限，两边截断的位置不同
-- （库里的落到 `_k` / `_d` / `_id`，Prisma 期望 `_key` / `_idx`）。
--
-- ## 幂等
--
-- `20261124150000` 已经顺手把 `dose_logs` 的两条对齐；在那种库上再跑这份脚本时
-- 旧名不存在，平铺的 `ALTER INDEX` 会 `42P01` 中断整批。所以先查存在性再改。
--
-- 只改名字：键、唯一性与谓词都不变。
--
-- ## 不改的漂移
--
-- `migrate diff` 之后仍会报 trgm 索引与 checkpoint 表：那是扩展索引与 Prisma
-- 之外建的表，schema 表达不了，属预期漂移。

DO $$
DECLARE
  renaming CONSTANT text[][] := ARRAY[
    ['dose_logs_user_medicine_day_time_idx',
     'dose_logs_user_id_current_medicine_id_scheduled_for_schedul_idx'],
    ['dose_logs_user_reminder_day_idx',
     'dose_logs_user_id_reminder_id_scheduled_for_idx'],
    ['drugbank_external_identifiers_drugbank_id_resource_identifier_k',
     'drugbank_external_identifiers_drugbank_id_resource_identifi_key'],
    ['user_suggestion_baseline_observations_user_id_dimension_local_d',
     'user_suggestion_baseline_observations_user_id_dimension_loc_key'],
    ['user_suggestion_feedbacks_user_id_suggestion_type_expires_at_id',
     'user_suggestion_feedbacks_user_id_suggestion_type_expires_a_idx']
  ];
  pair text[];
BEGIN
  FOREACH pair SLICE 1 IN ARRAY renaming LOOP
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public' AND c.relkind = 'i' AND c.relname = pair[1])
       AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                       WHERE n.nspname = 'public' AND c.relkind = 'i' AND c.relname = pair[2])
    THEN
      EXECUTE format('ALTER INDEX public.%I RENAME TO %I', pair[1], pair[2]);
    END IF;
  END LOOP;
END $$;