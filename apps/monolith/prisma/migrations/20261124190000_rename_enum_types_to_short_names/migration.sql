-- Prisma 模型名与枚举名去掉旧模块前缀（enum 类型名部分）。
--
-- ## 为什么需要这条迁移
--
-- 模型改名不影响物理表（每个 model 都有 `@@map` 指向真实表名），但 **enum 类型名
-- 是 Postgres 里的独立对象**，`ALTER TABLE ... RENAME` 不会带上它。schema 改成新名
-- 后，`migrate diff` 会试图 `CREATE TYPE` 新名 + 改列，而不是重命名——那会在已有
-- 数据的库上失败或丢数据。正确做法是先 `ALTER TYPE ... RENAME TO`。
--
-- ## 只改类型名
--
-- 枚举取值（wire 值）一个都不动，列的默认值、索引与约束都不受影响。

ALTER TYPE "DailyRecordKind" RENAME TO "RecordKind";
ALTER TYPE "DailyRecordAttachmentKind" RENAME TO "RecordAttachmentKind";
ALTER TYPE "ProductEventName" RENAME TO "ProductEventLogName";
ALTER TYPE "ProductEventSurface" RENAME TO "ProductEventLogSurface";
ALTER TYPE "ProductEventResult" RENAME TO "ProductEventLogResult";
ALTER TYPE "TodayAnalysisMaterializationStatus" RENAME TO "AnalysisMaterializationStatus";