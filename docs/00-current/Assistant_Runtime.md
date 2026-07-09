# Assistant Runtime

Last updated: 2026-07-09

- Assistant retrieval is source-split across Chinese leaflet RAG, assistant-only filtered medical
  QA, and entity-scoped DrugBank scientific retrieval.
- Assistant runtime now carries bounded retrieval-loop state (`loopCount`, `selectedTools`,
  `retrievalEvidence`, `stopReason`) and keeps tool use server-owned.
- Assistant tool surface now also includes structured Chinese product search/detail
  (`search_cn_medicine_products`, `get_cn_medicine_detail`) and structured DrugBank detail reads
  (`get_drugbank_detail`) in addition to the retrieval-only tools.
- Explicit CN product-style assistant questions now prefer a source-owned CN chain:
  `search_cn_medicine_products` -> `get_cn_medicine_detail` -> `search_medicine_leaflets` for
  leaflet-style follow-up questions, instead of pulling DrugBank or medical-QA retrieval into the
  same first-pass plan.
- Assistant retrieval misses do not fall back to keyword guessing once a vector-backed retrieval
  path is selected.
- Medical QA retrieval remains assistant-only reference material and is not a frontend linear
  medication-flow evidence source.
- `search_medicine_leaflets` now resolves a product by aggregating vector chunk scores over
  `leaflet_embeddings` before retrieving chunks, and returns the resolved product in
  `result.resolvedProduct`. It still returns vector-page metadata (`limit`, `offset`, `hasMore`,
  `nextCursor`) and supports metadata-filtered retrieval without switching back to SQL keyword
  fallback.
- Assistant tool execution now carries resolved CN `productId` forward into downstream leaflet
  retrieval by rewriting the leaflet tool payload with `filters.productId` when one structured CN
  detail record was already resolved safely.
- Today analysis now produces two notification types in addition to persisting
  `assistant_summary_histories`: `ai_today_summary` and `ai_proactive_suggestion`. Both carry
  `actionPayload.date` and `actionPayload.source=today-analysis` for frontend attribution.
- When today analysis is regenerated on the same day, the two notification types are overwritten
  by `type + source + date` scoped replace, cleaning up old duplicates to avoid polluting the
  notification page and report page suggestion history.
