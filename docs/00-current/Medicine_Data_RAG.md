# Medicine Data / RAG

Last updated: 2026-07-20

- Chinese leaflet assistant retrieval uses Lucent-owned `medicine_leaflet_chunks` plus a dedicated
  leaflet vector store.
- Structured assistant medicine lookup now reuses the source-owned medicine services instead of
  inventing a merged assistant-only medicine table: Chinese detail stays on
  `cn_medicine_products`, and DrugBank detail stays on `drugbank_drugs`.
- Leaflet embedding metadata now carries `chunkId`, `leafletId`, `productIds`, `productNames`,
  `sourceField`, and `chunkIndex` for assistant-side cursor/filter usage.
- DrugBank assistant retrieval is split into entity resolution (`resolve_drugbank_entity`) and
  scoped passage search (`search_drugbank_passages`) rather than open-ended whole-corpus passage
  search.
- DrugBank RAG passages are built from approved narrative scientific fields (`description`,
  `indication`, `mechanism_of_action`, `pharmacodynamics`, `toxicity`, `metabolism`, `absorption`,
  `half_life`, `clearance`), chunked into `drugbank_passage_chunks`, and embedded into
  `drugbank_passage_embeddings`.
- Medical QA assistant retrieval is stored in `medical_qa_chunks` and embedded into
  `medical_qa_embeddings`; it remains a separate corpus with independent safety filtering and
  disclaimer handling.
- Local development database currently has populated `medicine_leaflet_chunks`,
  `drugbank_passage_chunks`, and `medical_qa_chunks`, but assistant vector-store bootstrap is
  still blocked until the database runtime provides the `pgvector` extension itself.
- Lucent does not maintain a runtime CN → DrugBank mapping bridge or alias table. Cross-source
  questions are handled by the assistant's source-split structured lookup tools, which return
  separate CN and DrugBank evidence without asserting a single merged entity. This decision is
  formalized in [ADR-0008](../adr/0008-no-cn-drugbank-medicine-mapping.md): no CN↔DrugBank
  mapping will be built — the `drugbank_ids` field has been removed from `cn_medicine_products`.
- Medicine dose logs now have a slot-aware contract: a single dose log can carry `reminderId` +
  `scheduledTime` to distinguish multiple reminder slots for the same medicine on the same day.
  A new idempotent `POST /api/v1/user/medicine-dose-logs/mark` endpoint matches by
  `reminderId + scheduledFor` (preferred), falling back to `currentMedicineId + scheduledFor +
scheduledTime`, then to `currentMedicineId + scheduledFor`.
- Today analysis water target is now read from the `user_settings` DB table (`waterTargetCount`,
  range 1-30) instead of a hardcoded constant, allowing per-user personalization.
- **药品提醒调度器**：`ReminderSchedulerService`（`@Cron('* * * * *')`）每分钟扫描活跃提醒，
  按用户时区匹配 `scheduledHour:Minute` + `daysOfWeek` + 日期窗口，创建 `UserReminderDelivery`
  记录并发送站内通知 + 推送通知（best-effort）。
- **nonDeleted 迁移**：`reminder.repository.ts` 和 `dose-log.repository.ts` 的软删除查询
  已从手动 `deletedAt: null` 迁移到 `prisma.nonDeleted` API。
