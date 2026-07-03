# Lucent Current State

Last updated: 2026-07-03

This file records current backend implementation facts only. Historical changes belong in `docs/migration-log/`; deferred follow-up belongs in `docs/TODO.md`; public assistant/source boundaries belong in `docs/public/*.md`.

## Assistant Runtime

- Assistant retrieval is source-split across Chinese leaflet RAG, assistant-only filtered medical QA, and entity-scoped DrugBank scientific retrieval.
- Assistant runtime now carries bounded retrieval-loop state (`loopCount`, `selectedTools`, `retrievalEvidence`, `stopReason`) and keeps tool use server-owned.
- Assistant tool surface now also includes structured Chinese product search/detail (`search_cn_medicine_products`, `get_cn_medicine_detail`) and structured DrugBank detail reads (`get_drugbank_detail`) in addition to the retrieval-only tools.
- Explicit CN product-style assistant questions now prefer a source-owned CN chain: `search_cn_medicine_products` -> `get_cn_medicine_detail` -> `search_medicine_leaflets` for leaflet-style follow-up questions, instead of pulling DrugBank or medical-QA retrieval into the same first-pass plan.
- Assistant retrieval misses do not fall back to keyword guessing once a vector-backed retrieval path is selected.
- Medical QA retrieval remains assistant-only reference material and is not a frontend linear medication-flow evidence source.
- `search_medicine_leaflets` now resolves a product by aggregating vector chunk scores over `leaflet_embeddings` before retrieving chunks, and returns the resolved product in `result.resolvedProduct`. It still returns vector-page metadata (`limit`, `offset`, `hasMore`, `nextCursor`) and supports metadata-filtered retrieval without switching back to SQL keyword fallback.
- Assistant tool execution now carries resolved CN `productId` forward into downstream leaflet retrieval by rewriting the leaflet tool payload with `filters.productId` when one structured CN detail record was already resolved safely.

## Medicine Data / RAG

- Chinese leaflet assistant retrieval uses Lucent-owned `medicine_leaflet_chunks` plus a dedicated leaflet vector store.
- Structured assistant medicine lookup now reuses the source-owned medicine services instead of inventing a merged assistant-only medicine table: Chinese detail stays on `cn_medicine_products`, and DrugBank detail stays on `drugbank_drugs`.
- Leaflet embedding metadata now carries `chunkId`, `leafletId`, `productIds`, `productNames`, `sourceField`, and `chunkIndex` for assistant-side cursor/filter usage.
- DrugBank assistant retrieval is split into entity resolution (`resolve_drugbank_entity`) and scoped passage search (`search_drugbank_passages`) rather than open-ended whole-corpus passage search.
- DrugBank RAG passages are built from approved narrative scientific fields (`description`, `indication`, `mechanism_of_action`, `pharmacodynamics`, `toxicity`, `metabolism`, `absorption`, `half_life`, `clearance`), chunked into `drugbank_passage_chunks`, and embedded into `drugbank_passage_embeddings`.
- Medical QA assistant retrieval is stored in `medical_qa_chunks` and embedded into `medical_qa_embeddings`; it remains a separate corpus with independent safety filtering and disclaimer handling.
- Local development database currently has populated `medicine_leaflet_chunks`, `drugbank_passage_chunks`, and `medical_qa_chunks`, but assistant vector-store bootstrap is still blocked until the database runtime provides the `pgvector` extension itself.
- The locked CN master source currently has no usable built-in CN -> DrugBank bridge: the reviewed `ProductsEnriched.drugbank_ids` column exists in the local V2 workbook snapshot but has 0 populated rows, so cross-source mapping remains a future reviewed enrichment task rather than a runtime assumption.
- Lucent currently does not expose an assistant runtime CN -> DrugBank bridge tool. Cross-source mapping is intentionally left unresolved at runtime rather than maintained with a partial handwritten alias table.

## Public Support Resources

- `GET /api/v1/public/support-resources` now only serves `help` / `about` reference entries.
- Campus-scoped support resources have been removed from the active public contract because the project does not have a reliable school-specific data source.

## Toolchain / Contract

- Local backend toolchain baseline is Node.js `24.x` plus pnpm `11.x`; CI and Corepack docs pin the recommended baseline to `11.9.0`.
- `docs/openapi.json` remains the exported backend contract artifact that Luminous regenerates its `packages/lucent_openapi/` client from.
- The current exported contract now includes meal-analysis read hot fields on `DailyRecordItemDto`: status, coverage, updated-at, failure-reason, short-description, and top-foods.
- Lucent CI now re-exports `docs/openapi.json` and fails if the committed contract artifact drifts from current backend code.
- The OpenAPI committed-artifact gate is now semantic JSON comparison rather than raw text diff, so formatting-only reflow in `docs/openapi.json` does not block unit/e2e stages.
- Lucent CI PostgreSQL now runs on `pgvector/pgvector:pg18`, matching the documented extension-capable local baseline instead of validating against plain Postgres.
- `pnpm typecheck:tools` now type-checks `scripts/` and `deploy/` under the same decorator-capable baseline as the Nest app, so tool imports of Nest services no longer fail on stripped decorator settings.

## Auth / Security PIN

- The optional TOTP 2FA system has been replaced with an in-app 6-digit Security PIN.
- `User` carries `securityPinEnabled`, `securityPinHash`, `securityPinChangedAt`, and `securityElevationVersion` instead of the old `twoFactor*` columns.
- PIN management endpoints live under `/api/v1/settings/security-pin/*`: enable, verify, change, disable.
- A successful verify returns a short-lived signed elevation JWT (`scope: security_elevation`, 15 minutes) carried in the `x-security-elevation` header.
- Elevation tokens are invalidated when the PIN is enabled, changed, or disabled because `securityElevationVersion` is bumped.
- Sensitive routes (`POST /account/password`, `POST /account/email`, `DELETE /account/identities/:identityId`, `POST /user/data-export-requests`, `GET /user/data-export-requests/latest`) are protected by `SecurityElevationGuard` and `@RequireSecurityElevation()`.
- Credential login no longer returns 2FA challenge fields (`requiresTwoFactor`, `tempToken`).

## Meal Analysis

- Meal records now use a server-owned payload boundary: client updates can edit the user meal-input branch, but cannot overwrite stored meal-analysis branches directly.
- Daily-record list reads now keep meal payloads lightweight by omitting the heavy meal-analysis JSON while still exposing summary hot fields.
- Meal records now carry first-phase meal-analysis hot fields in `user_daily_records`: status, coverage, updated-at, failure-reason, and source-revision.
- Single-image meal record writes now mark the meal analysis as queued and enqueue an async meal-analysis background job keyed by record id plus source revision.
- `MealAnalysisVisionService` now invokes the configured `vision` model with multimodal image input and expects conservative JSON-only meal recognition output.
- The meal-analysis worker now reads trusted meal images through Lucent-signed COS GET URLs and writes successful first-phase results back as `unconfirmed` meal-analysis payload plus hot fields.
- First-phase meal analysis now includes deterministic food-table matching against `food_composition_items`, conservative portion heuristics, aggregated nutrition estimates, and fixed-rule meal commentary.
- Meal analysis now persists a second-phase layered payload: `recognizedDishes`, `resolvedIngredients`, and `compositionMatches`, while keeping legacy `mealAnalysis.foodItems` as a compatibility mirror for existing consumers.
- Mixed-dish handling now uses a three-stage backend flow: vision dish recognition, Lucent-owned dish-template or model-based dish decomposition, and conservative ingredient grounding into `food_composition_items`.
- Meal dish edits in `mealInput` now trigger a fresh async recomputation when the trusted meal image is unchanged, instead of silently leaving stale server-side nutrition results in place.
- Confirming a meal analysis now has server-owned semantics: the backend stamps `confirmedAt`, snapshots `mealAnalysisLastConfirmed`, and learns only grounded dish-to-ingredient templates into `meal_dish_templates` / `meal_dish_template_ingredients`.
- Today analysis now reads stored `unconfirmed` / `confirmed` meal-analysis results conservatively in recent-record context, while leaving `analyzing` meals as plain records.
- Reports now derive `mealEstimateSeries` and `mealEstimateTrackedDays` from stored `confirmed` / `unconfirmed` meal-analysis results instead of inferring meal availability from raw image records.
- Assistant daily-record query now exposes meal estimate status/coverage as explicit tags and hot fields alongside the stored meal payload.
- Lucent now has a durable food-composition import structure (`food_composition_imports`, `food_composition_categories`, `food_composition_items`) plus import scripts under `scripts/import/food/`.
- Lucent now also has a durable meal-dish template layer (`meal_dish_templates`, `meal_dish_template_ingredients`) for conservative mixed-dish grounding without introducing recipe RAG or vector food lookup.
- Meal-analysis code-quality audit completed: duplicated local utilities consolidated into shared common utils, fuzzy ingredient lookup now filters candidates with an indexed prefix predicate, silent JSON-parse failures are logged, and hard-coded thresholds/constants are named and marked for future configuration.
- `MealAnalysisVisionService` now applies a lightweight safety filter before storing vision output: length limits, script/style/HTML block removal, control-character removal, and rejection of items matching the shared AI safety policy.
- Today analysis now follows the shared read-rule matrix: `analyzing` meals are left as plain records, `analysis_failed` meals are shown as missing meal-analysis data, and `unconfirmed`/`partial` meals are labeled as estimates.
- Report dashboard context now provides a `mealEstimateBreakdown` (confirmed, estimated, partial, analyzing, failed days) alongside the existing `mealEstimateSeries`, so the AI summary can prefer confirmed analysis and label estimated/partial data explicitly.
- Assistant system prompt now requires explicit estimate-status wording when citing unconfirmed or partial meal records and treats `analysis_failed` as unavailable evidence rather than silent omission.
- ADR-0005 documents the meal-analysis write-time pipeline, the downstream read-rule matrix, and the vision safety filter decision.
