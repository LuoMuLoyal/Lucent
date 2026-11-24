-- 表名、索引名与外键约束名跟随模块短名。
--
-- 这些表在表名里保留了旧模块名（`user_daily_records` / `user_medicine_reminders`
-- / `data_export_requests` 等）。模块目录已改短，持久化层随之对齐。
--
-- ## 为什么写成幂等
--
-- 最初这版是「假定每个索引/约束都存在」的平铺 `ALTER`。问题在于 dev 与 test
-- 两个库的索引集本来就不同：test 库没有
-- `user_medicine_dose_logs_user_id_reminder_id_scheduled_for_idx`，于是它在第三条
-- 语句就报 `42P01`，表改名成功、其后所有改名全部跳空——留下一个半改的库。
--
-- 迁移必须在「同一个 commit 之前建过的任何库」上都能收敛，包括那些历史索引名
-- 略有出入的库。所以每一步都先查存在性再改：
--   - 旧名不存在 → 跳过（这个库本来就没有，或是更早的短名形态）；
--   - 新名已存在 → 跳过（这一步已经做过了）；
--   - 两者都在 → 冲突，让 `ALTER` 自己报错，不静默吞掉。
--
-- 表名同理：`to_regclass` 为 NULL 说明已改过。
--
-- ## 只动名字
--
-- 列、键、唯一性、谓词、级联行为都不变。
--
-- ## 不改的表
--
-- `user_profiles` / `user_sessions` / `user_allergies` / `user_current_medicines`
-- 里的 `user_` 表示「这一行属于某个用户」，不是模块名。
-- `medicine_*` 属于 `medicines` 模块（本次未改名）。

-- ---------------------------------------------------------------- 表
DO $$
DECLARE
  renaming CONSTANT text[][] := ARRAY[
    ['user_daily_records',                     'records'],
    ['user_daily_record_attachments',          'record_attachments'],
    ['user_medicine_reminders',                'reminders'],
    ['user_medicine_dose_logs',                'dose_logs'],
    ['user_reminder_deliveries',               'reminder_deliveries'],
    ['user_notification_preferences',          'notification_preferences'],
    ['user_product_events',                    'product_events'],
    ['user_today_analysis_materializations',   'analysis_materializations'],
    ['legal_documents',                        'legal'],
    ['data_export_requests',                   'export_requests']
  ];
  pair text[];
BEGIN
  FOREACH pair SLICE 1 IN ARRAY renaming LOOP
    IF to_regclass(format('public.%I', pair[1])) IS NOT NULL
       AND to_regclass(format('public.%I', pair[2])) IS NULL
    THEN
      EXECUTE format('ALTER TABLE public.%I RENAME TO %I', pair[1], pair[2]);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------- 索引
DO $$
DECLARE
  renaming CONSTANT text[][] := ARRAY[
    ['user_daily_records_pkey',                                   'records_pkey'],
    ['user_daily_records_user_id_occurred_at_occurred_time_idx',  'records_user_id_occurred_at_occurred_time_idx'],
    ['user_daily_records_user_id_kind_idx',                       'records_user_id_kind_idx'],
    ['user_daily_records_user_id_meal_analysis_status_idx',       'records_user_id_meal_analysis_status_idx'],
    ['user_daily_records_user_id_meal_analysis_updated_at_idx',   'records_user_id_meal_analysis_updated_at_idx'],
    ['user_daily_records_user_id_deleted_at_idx',                 'records_user_id_deleted_at_idx'],
    ['user_daily_records_user_id_health_event_id_idx',            'records_user_id_health_event_id_idx'],

    ['user_daily_record_attachments_pkey',                        'record_attachments_pkey'],
    ['user_daily_record_attachments_user_id_record_id_idx',       'record_attachments_user_id_record_id_idx'],

    ['user_medicine_reminders_pkey',                              'reminders_pkey'],
    ['user_medicine_reminders_active_idx',                        'reminders_active_idx'],
    ['user_medicine_reminders_user_id_current_medicine_id_idx',   'reminders_user_id_current_medicine_id_idx'],
    ['user_medicine_reminders_user_id_deleted_at_idx',            'reminders_user_id_deleted_at_idx'],
    ['user_medicine_reminders_user_id_start_date_end_date_idx',   'reminders_user_id_start_date_end_date_idx'],

    ['user_medicine_dose_logs_pkey',                              'dose_logs_pkey'],
    ['user_medicine_dose_logs_user_id_scheduled_for_idx',         'dose_logs_user_id_scheduled_for_idx'],
    ['user_medicine_dose_logs_user_id_deleted_at_idx',            'dose_logs_user_id_deleted_at_idx'],
    ['user_medicine_dose_logs_user_id_health_event_id_idx',       'dose_logs_user_id_health_event_id_idx'],
    -- 槽位部分唯一索引（`20261124120000` 建的那条）。它不随表改名自动跟过来，
    -- 而 `PrismaDoseLogs` 按索引名识别 P2002，名字不改等于让槽位冲突退化成 409。
    ['user_medicine_dose_logs_slot_uniq',                         'dose_logs_slot_uniq'],
    -- 这两条的旧名在两个库里不同：dev 是长名，test 是更早的短名。
    -- 两个旧名各自映射到同一个新名，缺失的那条自然跳过。
    ['user_medicine_dose_logs_user_id_reminder_id_scheduled_for_idx',
                                                                  'dose_logs_user_id_reminder_id_scheduled_for_idx'],
    ['dose_logs_user_reminder_day_idx',                           'dose_logs_user_id_reminder_id_scheduled_for_idx'],
    ['user_medicine_dose_logs_user_id_current_medicine_id_scheduled_for_scheduled_time_idx',
                                                                  'dose_logs_user_id_current_medicine_id_scheduled_for_schedul_idx'],
    ['dose_logs_user_medicine_day_time_idx',                      'dose_logs_user_id_current_medicine_id_scheduled_for_schedul_idx'],

    ['user_reminder_deliveries_pkey',                             'reminder_deliveries_pkey'],
    ['user_reminder_deliveries_user_id_scheduled_for_idx',        'reminder_deliveries_user_id_scheduled_for_idx'],
    ['user_reminder_deliveries_user_id_reminder_id_idx',          'reminder_deliveries_user_id_reminder_id_idx'],
    ['user_reminder_deliveries_user_id_channel_status_idx',       'reminder_deliveries_user_id_channel_status_idx'],
    ['user_reminder_deliveries_user_id_reminder_id_scheduled_for__key',
                                                                  'reminder_deliveries_user_id_reminder_id_scheduled_for_chann_key'],
    ['user_reminder_deliveries_scheduled_for_idx',                'reminder_deliveries_scheduled_for_idx'],

    ['user_notification_preferences_pkey',                        'notification_preferences_pkey'],

    ['user_product_events_pkey',                                  'product_events_pkey'],
    ['user_product_events_occurred_at_idx',                       'product_events_occurred_at_idx'],
    ['user_product_events_user_id_occurred_at_idx',               'product_events_user_id_occurred_at_idx'],
    ['user_product_events_user_id_client_event_id_key',           'product_events_user_id_client_event_id_key'],

    ['user_today_analysis_materializations_pkey',                  'analysis_materializations_pkey'],
    ['user_today_analysis_materializations_user_id_local_date_key','analysis_materializations_user_id_local_date_key'],
    ['user_today_analysis_materializations_user_id_status_idx',   'analysis_materializations_user_id_status_idx'],

    ['legal_documents_pkey',                                      'legal_pkey'],
    ['legal_documents_doc_type_key',                              'legal_doc_type_key'],
    ['legal_documents_is_active_idx',                             'legal_is_active_idx'],

    ['data_export_requests_pkey',                                 'export_requests_pkey'],
    ['data_export_requests_user_id_created_at_idx',               'export_requests_user_id_created_at_idx'],
    ['data_export_requests_user_id_kind_created_at_idx',          'export_requests_user_id_kind_created_at_idx']
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

-- ---------------------------------------------------------------- 外键约束
DO $$
DECLARE
  renaming CONSTANT text[][] := ARRAY[
    ['records',                   'user_daily_records_user_id_fkey',                     'records_user_id_fkey'],
    ['records',                   'user_daily_records_health_event_id_fkey',            'records_health_event_id_fkey'],
    ['record_attachments',        'user_daily_record_attachments_user_id_fkey',         'record_attachments_user_id_fkey'],
    ['record_attachments',        'user_daily_record_attachments_record_id_fkey',       'record_attachments_record_id_fkey'],
    ['reminders',                 'user_medicine_reminders_user_id_fkey',               'reminders_user_id_fkey'],
    ['reminders',                 'user_medicine_reminders_current_medicine_id_fkey',   'reminders_current_medicine_id_fkey'],
    ['dose_logs',                 'user_medicine_dose_logs_user_id_fkey',               'dose_logs_user_id_fkey'],
    ['dose_logs',                 'user_medicine_dose_logs_current_medicine_id_fkey',   'dose_logs_current_medicine_id_fkey'],
    ['dose_logs',                 'user_medicine_dose_logs_reminder_id_fkey',           'dose_logs_reminder_id_fkey'],
    ['dose_logs',                 'user_medicine_dose_logs_health_event_id_fkey',       'dose_logs_health_event_id_fkey'],
    ['reminder_deliveries',       'user_reminder_deliveries_user_id_fkey',              'reminder_deliveries_user_id_fkey'],
    ['reminder_deliveries',       'user_reminder_deliveries_reminder_id_fkey',          'reminder_deliveries_reminder_id_fkey'],
    ['notification_preferences',  'user_notification_preferences_user_id_fkey',         'notification_preferences_user_id_fkey'],
    ['product_events',            'user_product_events_user_id_fkey',                   'product_events_user_id_fkey'],
    ['analysis_materializations', 'user_today_analysis_materializations_user_id_fkey',  'analysis_materializations_user_id_fkey'],
    ['export_requests',           'data_export_requests_user_id_fkey',                  'export_requests_user_id_fkey']
  ];
  pair text[];
BEGIN
  FOREACH pair SLICE 1 IN ARRAY renaming LOOP
    IF to_regclass(format('public.%I', pair[1])) IS NOT NULL
       AND EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = pair[2] AND conrelid = to_regclass(format('public.%I', pair[1])))
       AND NOT EXISTS (SELECT 1 FROM pg_constraint
                       WHERE conname = pair[3] AND conrelid = to_regclass(format('public.%I', pair[1])))
    THEN
      EXECUTE format('ALTER TABLE public.%I RENAME CONSTRAINT %I TO %I',
                     pair[1], pair[2], pair[3]);
    END IF;
  END LOOP;
END $$;