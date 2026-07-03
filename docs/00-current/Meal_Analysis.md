# Meal Analysis

Last updated: 2026-07-03

- Meal records now use a server-owned payload boundary: client updates can edit the user meal-input
  branch, but cannot overwrite stored meal-analysis branches directly.
- Daily-record list reads now keep meal payloads lightweight by omitting the heavy meal-analysis
  JSON while still exposing summary hot fields.
- Meal records now carry first-phase meal-analysis hot fields in `user_daily_records`: status,
  coverage, updated-at, failure-reason, and source-revision.
- Single-image meal record writes now mark the meal analysis as queued and enqueue an async
  meal-analysis background job keyed by record id plus source revision.
- `MealAnalysisVisionService` now invokes the configured `vision` model with multimodal image input
  and expects conservative JSON-only meal recognition output.
- The meal-analysis worker now reads trusted meal images through Lucent-signed COS GET URLs and
  writes successful first-phase results back as `unconfirmed` meal-analysis payload plus hot
  fields.
- First-phase meal analysis now includes deterministic food-table matching against
  `food_composition_items`, conservative portion heuristics, aggregated nutrition estimates, and
  fixed-rule meal commentary.
- Meal analysis now persists a second-phase layered payload: `recognizedDishes`,
  `resolvedIngredients`, and `compositionMatches`, while keeping legacy `mealAnalysis.foodItems`
  as a compatibility mirror for existing consumers.
- Mixed-dish handling now uses a three-stage backend flow: vision dish recognition, Lucent-owned
  dish-template or model-based dish decomposition, and conservative ingredient grounding into
  `food_composition_items`.
- Meal dish edits in `mealInput` now trigger a fresh async recomputation when the trusted meal
  image is unchanged, instead of silently leaving stale server-side nutrition results in place.
- Confirming a meal analysis now has server-owned semantics: the backend stamps `confirmedAt`,
  snapshots `mealAnalysisLastConfirmed`, and learns only grounded dish-to-ingredient templates
  into `meal_dish_templates` / `meal_dish_template_ingredients`.
- Today analysis now reads stored `unconfirmed` / `confirmed` meal-analysis results conservatively
  in recent-record context, while leaving `analyzing` meals as plain records.
- Reports now derive `mealEstimateSeries` and `mealEstimateTrackedDays` from stored `confirmed` /
  `unconfirmed` meal-analysis results instead of inferring meal availability from raw image
  records.
- Assistant daily-record query now exposes meal estimate status/coverage as explicit tags and hot
  fields alongside the stored meal payload.
- Lucent now has a durable food-composition import structure (`food_composition_imports`,
  `food_composition_categories`, `food_composition_items`) plus import scripts under
  `scripts/import/food/`.
- Lucent now also has a durable meal-dish template layer (`meal_dish_templates`,
  `meal_dish_template_ingredients`) for conservative mixed-dish grounding without introducing
  recipe RAG or vector food lookup.
- Meal-analysis code-quality audit completed: duplicated local utilities consolidated into shared
  common utils, fuzzy ingredient lookup now filters candidates with an indexed prefix predicate,
  silent JSON-parse failures are logged, and hard-coded thresholds/constants are named and marked
  for future configuration.
- `MealAnalysisVisionService` now applies a lightweight safety filter before storing vision output:
  length limits, script/style/HTML block removal, control-character removal, and rejection of
  items matching the shared AI safety policy.
- Today analysis now follows the shared read-rule matrix: `analyzing` meals are left as plain
  records, `analysis_failed` meals are shown as missing meal-analysis data, and
  `unconfirmed`/`partial` meals are labeled as estimates.
- Report dashboard context now provides a `mealEstimateBreakdown` (confirmed, estimated, partial,
  analyzing, failed days) alongside the existing `mealEstimateSeries`, so the AI summary can
  prefer confirmed analysis and label estimated/partial data explicitly.
- Assistant system prompt now requires explicit estimate-status wording when citing unconfirmed or
  partial meal records and treats `analysis_failed` as unavailable evidence rather than silent
  omission.
- ADR-0005 documents the meal-analysis write-time pipeline, the downstream read-rule matrix, and
  the vision safety filter decision.
