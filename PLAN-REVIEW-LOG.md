# Plan Review Log: Meal Analysis With Food Composition Data

Act 1 (grill-with-docs) complete — plan locked, CONTEXT.md/ADRs updated. MAX_ROUNDS=5.

## Round 1 — Codex

- `PLAN.md` treated record creation as a sufficient trigger even though attachment upload is decoupled; worker may run before the object is actually readable.
- Stale async jobs could overwrite fresher edits or replacement images without a revision guard.
- Current daily-record DTO and mapper allow whole-payload overwrite, so server-owned analysis data would be client-tamperable unless the plan separates namespaces or merge rules.
- The status terms existed, but the plan did not define a real state machine or explicit confirm/recompute semantics.
- The queue mechanism was left open even though retry/dedupe behavior depends on it.
- Today/Report/Assistant consumption rules were under-specified and likely to diverge.
- Soft-deleted records or removed/replaced attachments were not guarded against during worker execution.
- Persisted vision text lacked explicit schema/length/safety constraints.
- List/detail DTO separation and import traceability needed to be made explicit.

### Claude's response

- Accepted. The plan now requires persisted-attachment verification before processing, stale-write guards via `recordId + sourceRevision`, a server-owned payload namespace with whitelist merge semantics, and explicit soft-delete/attachment re-checks.
- Accepted. The plan now locks the first-phase async mechanism to BullMQ so retry/dedupe behavior is not deferred.
- Accepted. The plan now standardizes a shared read-rule table for Today/Report/Assistant and makes list/detail contract separation explicit.
- Accepted with adjustment. Instead of forcing the vision model to emit direct source ids, the revised plan keeps canonicalized names plus backend-owned matching, because direct ids would over-assign database responsibility to the model.
- Accepted. Import traceability and persisted-text validation were added to the plan.

## Round 2 — Codex

- Warned that attachment-reference enqueue might still race upload completion.
- Flagged that client-supplied attachment metadata could point analysis at untrusted objects.
- Pointed out that recompute on a confirmed meal could destroy the only accepted result if no fallback snapshot exists.
- Flagged that hot fields used for list/polling are not query-friendly if they remain JSONB-only.
- Asked for the Today/Report/Assistant status matrix to be spelled out, not deferred.
- Flagged ambiguity around multiple images per meal.

### Claude's response

- Rejected the upload-finalize finding after checking the current Flutter flow: the client uploads the image through the presigned URL before it ever creates the Meal Record, so an extra finalize protocol is not justified by the existing implementation.
- Accepted. The plan now limits analysis input to Lucent-issued trusted image attachments inside the authenticated user's storage namespace and forbids analysis fetches from client-supplied `publicUrl`.
- Accepted. The plan now preserves the last confirmed snapshot during recompute even though broad version history remains out of scope.
- Accepted. The plan now mirrors hot read/query fields into dedicated columns while keeping the full Meal Analysis detail in JSONB payload.
- Accepted. The plan now includes the first-phase Today/Report/Assistant consumer matrix directly.
- Accepted. The plan now restricts phase 1 to exactly one trusted image attachment per Meal Record.
