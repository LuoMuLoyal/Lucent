-- 表名词根统一 + DomainEvent 补 created_at。
--
-- 1) medical_qa_chunks → medicine_qa_chunks：与同族 medicine_leaflet_chunks 词根一致。
--    这是 RENAME，不是 DROP + CREATE。
-- 2) domain_events 补 created_at：该表是追加型 outbox 日志，此前只有 occurred_at
--    （记录「事实何时发生」，由生产方写入）。created_at 记录「行何时写入」。
--
--    回填策略：用 occurred_at 作为历史行的 created_at。二者对存量行语义上等价
--    （生产方在与写事务同一次调用里 append，没有延迟写入的历史），不是用 now()
--    伪造时间戳。domain_events 在迁移前实测为空表，回填是保护性写法。

-- 1) 表重命名
ALTER TABLE "medical_qa_chunks" RENAME TO "medicine_qa_chunks";
ALTER INDEX "medical_qa_chunks_pkey" RENAME TO "medicine_qa_chunks_pkey";
ALTER INDEX "medical_qa_chunks_qa_id_key" RENAME TO "medicine_qa_chunks_qa_id_key";
ALTER INDEX "medical_qa_chunks_safety_label_idx" RENAME TO "medicine_qa_chunks_safety_label_idx";

-- 2) domain_events.created_at：先加可空列，用 occurred_at 回填，再转 NOT NULL。
ALTER TABLE "domain_events" ADD COLUMN "created_at" TIMESTAMPTZ(3);

UPDATE "domain_events" SET "created_at" = "occurred_at" WHERE "created_at" IS NULL;

ALTER TABLE "domain_events" ALTER COLUMN "created_at" SET NOT NULL;
ALTER TABLE "domain_events" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
