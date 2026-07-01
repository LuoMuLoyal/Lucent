# Plan: Meal Analysis With Food Composition Data

_Locked via grill-with-docs — by Codex + user. Terms per CONTEXT.md._

## Goal

Add an asynchronous write-time Meal Analysis flow that turns one Meal Record image into a stored visual description, Food Items, Nutrition Estimate, and Meal Commentary, backed by an imported durable Food Composition Source. Today analysis, report summaries, and assistant read paths should consume the stored result directly instead of re-running food lookup or retrieval at read time.

## Approach

1. Import the purchased China food composition workbook into Lucent-owned durable tables.
   - Parse `DrugDataBase/中国食物成分表/中国食物成分表.xlsx` into normalized food-item and food-category tables.
   - Keep the workbook outside runtime and Git; runtime lookups use PostgreSQL only.
   - Add import metadata, normalized search fields, alias-ready columns, and idempotent re-import behavior for deterministic matching.
   - Mirror the existing medicine import traceability contract: source version, file hash, imported-row counts, rejected-row counts, and sample rejection reasons.

2. Extend Meal Record storage and API contracts around one structured JSONB payload namespace plus mirrored hot fields.
   - Keep `UserDailyRecord` as the primary durable entity with `kind = meal`.
   - Store the current Meal Analysis result in a server-owned branch of `payload` JSONB with explicit sub-objects for `analysisStatus`, `mealDescription`, `foodItems`, `nutritionEstimate`, `mealCommentary`, `matchDiagnostics`, and audit fields such as `analyzedAt` and `confirmedAt`.
   - Separate user-editable meal fields from server-owned analysis fields so create/update APIs use whitelist merge semantics instead of whole-payload replacement.
   - Mirror hot read/query fields such as `analysisStatus`, `analysisUpdatedAt`, and coverage/completeness into dedicated columns so list reads, polling, and report queries avoid wide JSONB scans.
   - Keep one current result only; first phase does not preserve multi-version history.

3. Add an asynchronous Meal Analysis backend pipeline backed by BullMQ.
   - Support retry from `analysis_failed` without creating a second Meal Record.
   - Bind jobs to `recordId + sourceRevision` so stale tasks cannot overwrite newer edits, replacement images, or recomputed analysis.

4. Define an explicit Meal Analysis state machine.
   - Planned states remain `analyzing`, `unconfirmed`, `confirmed`, and `analysis_failed`.
   - Define allowed transitions, retry semantics, and explicit confirm/recompute actions instead of burying confirmation meaning inside generic payload updates.
   - Preserve the last confirmed snapshot until a newer run succeeds so a failed recompute does not erase the only accepted result.

5. Split responsibility between the vision model and deterministic backend matching.
   - Backend matching owns normalization, alias expansion, class-aware conservative fuzzy matching, and no-match handling.
   - Persisted vision output must pass schema validation, length limits, and a lightweight safety filter before storage.

6. Generate Nutrition Estimate and Meal Commentary through rule-based backend logic.
   - Allow partial estimates when some Food Items are unmatched; unmatched or low-confidence items remain visible but do not force a guessed nutrition total.

7. Expose lightweight list reads and heavier detail/edit reads.
   - Record list surfaces only lightweight Meal Record fields such as `analysisStatus`, top recognized foods, and a short description.
   - Record list and summary reads also expose `analysisUpdatedAt` plus a display-safe failure reason when relevant so the client can distinguish analyzing from failed.
   - Detail and edit reads fetch the full Meal Analysis payload on demand.
   - Frontend editing can adjust Food Items or portions and mark the result `confirmed`.

8. Bound how downstream AI and summaries consume Meal Analysis.
   - Document one shared read-rule table so Today, Report, and Assistant agree on how `analyzing`, `unconfirmed`, `confirmed`, `analysis_failed`, and `partial` coverage affect summaries, aggregation, and confidence wording.
   - First-phase consumer matrix:
     - `Today`: may reference `unconfirmed` and `confirmed`; ignores `analyzing`; may mention `analysis_failed` only as missing meal-analysis data; treats `partial` as low-confidence estimated context.
     - `Report`: prefers `confirmed`; may include `unconfirmed` only when explicitly labeled estimated; ignores `analyzing`; excludes `analysis_failed` from nutrition aggregation; treats `partial` as incomplete estimated context.
     - `Assistant`: may read `unconfirmed` and `confirmed`; must surface estimate status and incompleteness explicitly; treats `analysis_failed` as unavailable evidence rather than silent omission.
   - Unconfirmed Meal Analysis can inform daily suggestions but should be phrased conservatively.
   - Longer-range summaries should prefer Confirmed Meal Analysis and mark any use of unconfirmed estimates as estimated rather than factual.

9. Keep first-phase scope intentionally narrow.
   - No food RAG.
   - No vector search for food-item matching.
   - No direct agent query of the Food Composition Source.
   - No push/system notification when analysis finishes; app-visible state plus polling/refresh only.
   - No multi-image meal analysis; phase 1 uses exactly one trusted image attachment per Meal Record.
   - No individualized nutrition targets or diagnosis-like nutrition judgments.

## Key Decisions & Tradeoffs

- Use a write-time Meal Analysis pipeline instead of read-time agent lookup so Today, Report, and Assistant can consume the same deterministic stored result.
- Keep the first-phase result inside a server-owned Meal Record `payload` JSONB namespace instead of introducing a separate nutrition-analysis aggregate with multiple relational tables. This reduces integration cost now and can be migrated later if the contract stabilizes.
- Treat the purchased workbook as a durable backend import source, not as a runtime file or a retrieval corpus.
- Keep the vision model limited to recognition and normalized naming while backend logic owns composition-table matching and nutrition commentary.
- Lock the first-phase async mechanism to BullMQ so retries, dedupe, and stale-write protection are part of the design rather than deferred implementation details.
- Prefer partial estimates over guessed completeness when food matching is weak.
- Defer analysis-finished notifications because current infrastructure does not justify promoting unconfirmed meal estimates to system-level alerts.
- Constrain phase 1 to a single trusted image attachment and preserve the last confirmed snapshot during recompute, even though broader analysis history remains out of scope.
- Reference ADR: [ADR-0005](../docs/adr/0005-meal-analysis-write-time-pipeline.md)

## Risks / Open Questions

- Portion estimation from images may still be noisy even when food naming is acceptable; thresholds and UI wording must stay conservative.
- Mixed dishes and restaurant-specific foods may frequently fall into partial-estimate mode until alias dictionaries improve.
- The first-phase JSONB payload contract needs careful validation so Lucent and Luminous do not drift.
- Canonical alias coverage may need several rounds of expansion after real-meal testing.
- Product docs such as `Luminous/docs/Product_Vision.md` still describe older rough-diet assumptions and must be updated when implementation begins.
- Mirroring hot fields into columns adds some schema duplication, but keeps list polling and report aggregation practical.

## Out Of Scope

- Food RAG or food vector stores
- Agent-owned direct lookup of the food composition dataset
- System or push notifications for analysis completion
- Nutrition history versioning beyond the current payload state
- Individualized nutrition plans, diagnosis, treatment advice, or precise calorie-tracking claims
