# Medicine Data / RAG

Last updated: 2026-07-09

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
- The locked CN master source currently has no usable built-in CN -> DrugBank bridge table or alias
  map: the reviewed `ProductsEnriched.drugbank_ids` column exists in the local V2 workbook
  snapshot but has 0 populated rows, so it is not treated as a runtime bridge.
- Lucent does not maintain a runtime CN -> DrugBank mapping bridge or alias table. Cross-source
  questions are handled by the assistant's source-split structured lookup tools, which return
  separate CN and DrugBank evidence without asserting a single merged entity.
- Medicine dose logs now have a slot-aware contract: a single dose log can carry `reminderId` +
  `scheduledTime` to distinguish multiple reminder slots for the same medicine on the same day.
  A new idempotent `POST /api/v1/user/medicine-dose-logs/mark` endpoint matches by
  `reminderId + scheduledFor` (preferred), falling back to `currentMedicineId + scheduledFor +
  scheduledTime`, then to `currentMedicineId + scheduledFor`.
- Today analysis water target is now read from the `user_settings` DB table (`waterTargetCount`,
  range 1-30) instead of a hardcoded constant, allowing per-user personalization.
