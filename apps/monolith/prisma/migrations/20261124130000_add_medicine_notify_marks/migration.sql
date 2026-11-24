-- 半衰期感知漏服的每日上限载体。
--
-- 「每药每日已提示」需要一条落库事实，理由有两条：
--
-- 1. `half-life-gap.ts` 的 `evaluateHalfLifeGap` 接受 `lastNotifiedAt`，但此前
--    没有任何地方存它——参数存在、值不存在，规则永远按「今天没提示过」跑。
-- 2. 重算远比提示频繁（每次记录变更都可能触发重算）。把「已提示」放在进程内存里，
--    一次重启就清零，用户当天会再被提示一遍。
--
-- 唯一键 `(user_id, current_medicine_id, notify_date)` 是这里的关键：
--   它是「每天最多一次」在存储层的落点，并发写也只会留下一条。
--   `notify_date` 存本地自然日字符串（YYYY-MM-DD），与规则里的
--   `isSameLocalDay` 同口径——用时间戳做键会在时区边界上分裂成两天。

CREATE TABLE "user_medicine_notify_marks" (
  "id"                  TEXT        NOT NULL,
  "user_id"             TEXT        NOT NULL,
  "current_medicine_id" TEXT        NOT NULL,
  "notify_date"         TEXT        NOT NULL,
  "notified_at"         TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "user_medicine_notify_marks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_medicine_notify_marks_user_id_current_medicine_id_notify_date_key"
  ON "user_medicine_notify_marks" ("user_id", "current_medicine_id", "notify_date");

CREATE INDEX "user_medicine_notify_marks_user_id_notify_date_idx"
  ON "user_medicine_notify_marks" ("user_id", "notify_date");

ALTER TABLE "user_medicine_notify_marks"
  ADD CONSTRAINT "user_medicine_notify_marks_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_medicine_notify_marks"
  ADD CONSTRAINT "user_medicine_notify_marks_current_medicine_id_fkey"
  FOREIGN KEY ("current_medicine_id") REFERENCES "user_current_medicines"("id") ON DELETE CASCADE ON UPDATE CASCADE;