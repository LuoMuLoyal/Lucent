# ADR-0005: Write-Time Meal Analysis With Imported Food Composition Data

- **Status**: accepted
- **Date**: 2026-06-17
- **Deciders**: LuoMuLoyal

## Context

Meal-image understanding needs to be deterministic, auditable, and bounded by estimate status.
Doing recognition and composition lookup at read time makes downstream results inconsistent,
increases retrieval cost, and makes it harder to show users why a given estimate is partial or
unconfirmed. A write-time pipeline stores the current structured result inside the Meal Record so
Today, Report, and Assistant read paths consume the same server-owned result.

## Decision

Lucent will treat meal-image understanding as an asynchronous write-time Meal Analysis pipeline
instead of an on-demand assistant retrieval feature. The pipeline:

1. Imports a purchased China food-composition workbook into durable PostgreSQL tables
   (`food_composition_imports`, `food_composition_categories`, `food_composition_items`).
2. Stores the current analysis result in a server-owned `payload` JSONB namespace (`mealAnalysis`,
   `mealAnalysisLastConfirmed`) while keeping user-editable input in a separate `mealInput` branch.
3. Mirrors hot read/query fields (`mealAnalysisStatus`, `mealAnalysisCoverage`,
   `mealAnalysisUpdatedAt`, `mealAnalysisFailureReason`, `mealSourceRevision`) into
   `user_daily_records` columns so list and report queries avoid wide JSONB scans.
4. Runs analysis asynchronously via BullMQ with jobs keyed by `recordId:sourceRevision` to prevent
   stale writes from overwriting newer edits or replacement images.
5. Preserves the last confirmed snapshot during a recompute so a failed recompute does not erase
   the only accepted result.
6. Applies a lightweight safety filter to persisted vision output: length limits,
   HTML/control-character stripping, and rejection of medical/diagnosis-style text before the
   result is stored.
7. Exposes a shared read-rule matrix so Today, Report, and Assistant agree on how status and
   coverage affect summaries and aggregation.

## Options Considered

| Option                                             | Pros                                                                                                                                      | Cons                                                                                                                                  |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Write-time analysis pipeline（本方案）**         | Deterministic results; all consumers read the same stored result; status/coverage visible to all; async pipeline doesn't block user input | Requires BullMQ infrastructure; first result delayed until async job completes; JSONB payload may need normalization later            |
| Read-time analysis (on-demand assistant retrieval) | Always fresh; no stored payload to sync                                                                                                   | Results inconsistent across consumers; higher retrieval cost; cannot show why an estimate is partial or unconfirmed; blocks read path |
| Synchronous analysis (inline in record creation)   | Simplest pipeline; result immediately available                                                                                           | Blocks HTTP request on LLM call; high latency; no retry/queue semantics                                                               |

## Consequences

- Today, Report, and Assistant consume the same stored result, so wording and aggregation stay
  consistent.
- The first-phase result lives in JSONB rather than a separate normalized nutrition aggregate,
  reducing integration cost now and leaving a clear migration path if the contract stabilizes.
- Downstream consumers must respect the shared read-rule matrix instead of inferring meaning from
  raw payload fields.
- Partial estimates are first-class; downstream UI and prompts must label them as estimated rather
  than factual.

## Shared read-rule matrix

- `analyzing`
  - Today: Ignore; show the plain record without meal-analysis claims.
  - Report: Ignore; do not count toward meal estimate days.
  - Assistant: Treat as unavailable; do not cite meal content.
- `unconfirmed`
  - Today: May reference as a conservative estimate; phrase cautiously.
  - Report: May include only when explicitly labeled "estimated".
  - Assistant: Surface as an estimate; mention it may be incomplete.
- `confirmed`
  - Today: May reference as the accepted current result.
  - Report: Prefer over `unconfirmed`; use as the primary meal source.
  - Assistant: Surface as the accepted current result.
- `coverage: partial`
  - Today: Treat as low-confidence partial context regardless of status.
  - Report: Treat as incomplete estimated context; label as "partial".
  - Assistant: Explicitly mention incompleteness when citing the meal.
- `analysis_failed`
  - Today: Mention only as missing meal-analysis data, not as confirmed absence of food.
  - Report: Exclude from any nutrition conclusion.
  - Assistant: Treat as unavailable evidence rather than silent omission.

All three consumers must also avoid diagnosing, prescribing, or presenting medication risk
judgments based on meal data.
