# Plan: Meal Analysis With Food Composition Data

_Locked via grill-with-docs — by Codex + user. Terms per CONTEXT.md._

## Goal

Add an asynchronous write-time Meal Analysis flow that turns one Meal Record image into a stored visual description, Food Items, Nutrition Estimate, and Meal Commentary, backed by an imported durable Food Composition Source. Today analysis, report summaries, and assistant read paths should consume the stored result directly instead of re-running food lookup or retrieval at read time.

## Approach

1. Import the purchased China food composition workbook into Lucent-owned durable tables with the same traceability pattern already used for medicine imports.
   - Persist source version, file hash, row counts, rejection samples, and idempotent re-import metadata.
   - Add normalized search keys and alias-ready fields for deterministic matching.
2. Extend Meal Record storage and API contracts around one server-owned structured JSONB payload namespace plus a few mirrored hot fields.
   - Keep `UserDailyRecord` as the primary durable entity with `kind = meal`.
   - Store Meal Analysis under a dedicated server-owned payload branch instead of allowing arbitrary client overwrite of the whole payload blob.
   - Split user-editable meal fields from server-owned analysis fields so updates use whitelist merge semantics rather than whole-payload replacement.
   - Mirror hot query fields such as `analysisStatus`, `analysisUpdatedAt`, and a compact coverage/completeness flag into dedicated columns so list reads, polling, and summary queries do not depend on full JSONB scans.
3. Add an asynchronous Meal Analysis backend pipeline backed by BullMQ over Lucent's Redis runtime.
   - Trigger enqueue only when a Meal Record has exactly one persisted trusted image attachment reference produced by Lucent's authenticated upload flow.
   - The worker must re-verify record existence, attachment presence, single-image constraint, soft-delete state, and object readability before processing and before final write-back.
   - Only Lucent-issued attachment metadata inside the authenticated user's storage namespace is trusted as analysis input; never fetch by client-supplied `publicUrl`.
   - Use job dedupe keys plus a `sourceRevision` / timestamp guard so stale jobs cannot overwrite fresher user edits or re-analyses.
4. Define an explicit Meal Analysis state machine.
   - Planned states remain `analyzing`, `unconfirmed`, `confirmed`, and `analysis_failed`.
   - Define allowed transitions, retry semantics, and the distinct meaning of user confirm versus recompute versus manual edit.
   - When a previously confirmed meal is re-analyzed, preserve the last confirmed snapshot until a newer analysis succeeds, so a failed recompute cannot destroy the only accepted result.
5. Limit the vision model to structured recognition, not source matching or health judgment.
   - Vision output is constrained to `mealDescription`, canonicalized food-name candidates, coarse portions, and confidence.
   - The prompt may include a small curated list of canonical food-name examples, but not database row ids or full table schema.
   - Persisted vision text must pass schema validation, length limits, and a lightweight safety filter before storage.
6. Keep composition matching and meal commentary deterministic in backend code.
   - Backend matching owns normalization, alias expansion, category-aware conservative fuzzy matching, and no-match handling.
   - Nutrition Estimate and Meal Commentary are derived from fixed conservative thresholds, not model free-form nutrition judgments and not personalized targets.
   - Partial estimates are first-class results; unmatched items remain visible without being forced into guessed totals.
7. Expose separate read contracts for lightweight list reads and heavier detail/edit reads.
   - Record list and summary reads return lightweight meal fields only, such as `analysisStatus`, brief meal description, top recognized foods, `analysisUpdatedAt`, and optional display-safe failure reason.
   - Detail and edit reads return the full Meal Analysis payload plus coverage and match diagnostics appropriate for user correction.
8. Standardize downstream read rules before implementation.
   - Today, Report, and Assistant must share one documented rule table for how `analyzing`, `unconfirmed`, `confirmed`, `analysis_failed`, and `partial` coverage affect summaries and confidence wording.
   - The first-phase consumer matrix is:
     - `Today`: may reference `unconfirmed` and `confirmed`; ignores `analyzing`; may mention `analysis_failed` only as missing data; treats `partial` as low-confidence estimated context.
     - `Report`: prefers `confirmed`; may include `unconfirmed` only when explicitly labeled estimated; ignores `analyzing`; excludes `analysis_failed` from nutrition aggregation; treats `partial` as incomplete estimated context.
     - `Assistant`: may read `unconfirmed` and `confirmed`; must surface estimate status and incompleteness explicitly; treats `analysis_failed` as unavailable evidence rather than silent omission.
   - Short-horizon suggestions may reference unconfirmed estimates conservatively; longer-range summaries should prefer confirmed data and mark estimated inputs clearly.
9. Keep first-phase scope intentionally narrow.
   - No food RAG.
   - No vector search for food-item matching.
   - No direct agent lookup of the Food Composition Source.
   - No ingredient decomposition for mixed dishes.
   - No push/system notification when analysis completes; app-visible state plus polling/refresh only.
   - No individualized nutrition targeting or diagnosis-like nutrition conclusions.

## Key Decisions & Tradeoffs

- Meal analysis is write-time and asynchronous, not read-time assistant retrieval.
- The purchased workbook becomes a durable backend import source in PostgreSQL, not a runtime file dependency.
- First-phase Meal Analysis lives in a server-owned Meal Record `payload` JSONB namespace instead of a separate relational nutrition aggregate.
- Vision output stops at normalized food names plus coarse portions; backend code performs the actual source matching and nutrition derivation.
- BullMQ is the first-phase background job mechanism so retries, dedupe, and failure semantics are explicit instead of deferred.
- Partial estimates are acceptable and preferred over guessed completeness.
- Unconfirmed Meal Analysis can inform short-horizon suggestions, but longer-horizon summaries should prefer Confirmed Meal Analysis.
- Phase 1 is single-image only for each Meal Record; multiple images would create ambiguous vision scope and are deferred.

## Risks / Open Questions

- Portion estimation remains noisy and must stay conservative in UI wording and downstream AI prompts.
- Mixed dishes may often remain partially estimated until alias dictionaries improve.
- Canonical food-name alias coverage may need iterative expansion once real meal photos are tested.
- Existing product docs still describe older rough-diet assumptions and need refresh during implementation.
- The narrow confirmed-snapshot fallback during recompute adds a small amount of extra state even though general analysis version history remains out of scope.

## Out of scope

- Food RAG or vector search
- Agent direct lookup of the Food Composition Source
- Ingredient decomposition for mixed dishes
- Analysis-complete push/system notifications
- Multi-version analysis history
- Individualized nutrition plans or diagnosis-like conclusions
