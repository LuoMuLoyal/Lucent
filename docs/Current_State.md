# Lucent Current State

Last updated: 2026-07-01

This file records current backend implementation facts only. Historical changes belong in `docs/migration-log/`; deferred follow-up belongs in `docs/TODO.md`; public assistant/source boundaries belong in `docs/public/*.md`.

## Assistant Runtime

- Assistant retrieval is source-split across Chinese leaflet RAG, assistant-only filtered medical QA, and entity-scoped DrugBank scientific retrieval.
- Assistant runtime now carries bounded retrieval-loop state (`loopCount`, `selectedTools`, `retrievalEvidence`, `stopReason`) and keeps tool use server-owned.
- Assistant retrieval misses do not fall back to keyword guessing once a vector-backed retrieval path is selected.
- Medical QA retrieval remains assistant-only reference material and is not a frontend linear medication-flow evidence source.
- `search_medicine_leaflets` now returns vector-page metadata (`limit`, `offset`, `hasMore`, `nextCursor`) and supports metadata-filtered retrieval without switching back to SQL keyword fallback.

## Medicine Data / RAG

- Chinese leaflet assistant retrieval uses Lucent-owned `medicine_leaflet_chunks` plus a dedicated leaflet vector store.
- Leaflet embedding metadata now carries `chunkId`, `leafletId`, `productIds`, `productNames`, `sourceField`, and `chunkIndex` for assistant-side cursor/filter usage.
- DrugBank assistant retrieval is split into entity resolution and scoped passage search rather than open-ended whole-corpus passage search.
- Medical QA assistant retrieval remains a separate corpus with independent storage and disclaimer/safety handling.
- Local development database currently has populated `medicine_leaflet_chunks`, but assistant vector-store bootstrap is still blocked until the database runtime provides the `pgvector` extension itself.

## Toolchain / Contract

- Local backend toolchain baseline is Node.js `24.x` plus pnpm `11.x`; CI and Corepack docs pin the recommended baseline to `11.9.0`.
- `docs/openapi.json` remains the exported backend contract artifact that Luminous regenerates its `packages/lucent_openapi/` client from.
- Lucent CI now re-exports `docs/openapi.json` and fails if the committed contract artifact drifts from current backend code.

## Meal Analysis

- Meal records now use a server-owned payload boundary: client updates can edit the user meal-input branch, but cannot overwrite stored meal-analysis branches directly.
- Daily-record list reads now keep meal payloads lightweight by omitting the heavy meal-analysis JSON while still exposing summary hot fields.
- Meal records now carry first-phase meal-analysis hot fields in `user_daily_records`: status, coverage, updated-at, failure-reason, and source-revision.
- Single-image meal record writes now mark the meal analysis as queued and enqueue an async meal-analysis background job keyed by record id plus source revision.
- The meal-analysis worker now reads trusted meal images through Lucent-signed COS GET URLs and writes successful first-phase results back as `unconfirmed` meal-analysis payload plus hot fields.
- Today analysis now reads stored `unconfirmed` / `confirmed` meal-analysis results conservatively in recent-record context, while leaving `analyzing` meals as plain records.
- Reports now derive `mealEstimateSeries` and `mealEstimateTrackedDays` from stored `confirmed` / `unconfirmed` meal-analysis results instead of inferring meal availability from raw image records.
- Assistant daily-record query now exposes meal estimate status/coverage as explicit tags and hot fields alongside the stored meal payload.
- Lucent now has a durable food-composition import structure (`food_composition_imports`, `food_composition_categories`, `food_composition_items`) plus import scripts under `scripts/import/food/`.
