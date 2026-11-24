-- 剂量日志槽位唯一性：`mark` 的幂等此前只是「通常成立」。
--
-- ## 问题
--
-- `POST /medicine-dose-logs/mark` 的契约是「同一槽位幂等」，实现是
-- find-then-create（先 findBySlot，命中则 update，否则 create），表上没有任何
-- 覆盖槽位的唯一约束。两个并发请求都读不到行，于是都 insert —— 同一槽位两行。
--
-- ## 索引形状
--
-- 只约束 **reminder_id 非空且未软删** 的行，两个条件都是业务要求，不是收窄：
--
-- 1. `reminder_id IS NULL` 是**临时日志**（没有提醒槽位）。领域规则明确「临时日志
--    永不合并」——同一天同一药可以有多次独立服用，按 medicine+date+time 合并会把
--    两次剂量吞成一次。所以这类行必须允许重复。
-- 2. `deleted_at IS NULL`：软删后重新标记同一槽位必须能插入新行。约束把已删行排除
--    在外，这正是「软删不可复活」那条规则在存储层的落点。
--
-- ## 关于 scheduled_time 为 NULL
--
-- Postgres 在唯一索引里把 NULL 视作互不相等，所以 `(…, scheduled_time)` 含 NULL 时
-- 不参与约束。对一个**有 reminder 但没定具体时刻**的槽位，这意味着仍可能重复。
-- 这类槽位在业务上罕见（提醒自带 scheduledHour/Minute，mark 会带上 time），为它
-- 单独建 COALESCE 表达式索引会把「没时刻」折叠成同一个值，反而把两个合法槽位判成
-- 重复。选择接受这个边角，并在 mark 路径上保证有 reminder 时写入 time。

CREATE UNIQUE INDEX "user_medicine_dose_logs_slot_uniq"
  ON "user_medicine_dose_logs" ("user_id", "reminder_id", "scheduled_for", "scheduled_time")
  WHERE "deleted_at" IS NULL AND "reminder_id" IS NOT NULL;