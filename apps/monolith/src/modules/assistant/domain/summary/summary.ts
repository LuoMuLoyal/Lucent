/**
 * `Summary` aggregate (ADR-0024 §4) — generated health summaries.
 *
 * Two kinds share one aggregate because they share the lifecycle that matters: a
 * summary is **derived from another context's data** (today records, reports) and
 * is stored as a versioned projection, never as a source of truth.
 *
 * 1. **A summary never edits the data it summarizes.** Regenerating produces a
 *    new version; the underlying records are read only.
 *
 * 2. **A newer source version wins.** The records a "today" summary was built
 *    from change during the day (a user logs water after the summary was
 *    generated). A stored summary carries the `sourceVersion` it was built from;
 *    a write whose version is **older or equal** to the stored one is discarded.
 *    Without this, a slow in-flight generation could overwrite a newer summary
 *    with a stale one, and the user would see yesterday's advice on today's data.
 *
 * 3. **Report summaries are keyed by range.** `last_7_days` / `last_30_days` /
 *    `custom`(start+end) name different artifacts; a "custom" range must carry
 *    both bounds or it is not addressable.
 *
 * ## What is *not* here
 *
 * Generating the text (models, prompts, coverage computation) is an application
 * concern; the row shape is persistence. This file decides only "may this
 * summary replace that one".
 *
 * Layer purity (ADR-0024 rule D1): no imports outside `domain/`.
 */

/** Which pipeline produced the summary. */
export type SummaryKind = 'today' | 'report';

/** Range selectors accepted by the reports context. */
export type ReportRange = 'last_7_days' | 'last_30_days' | 'custom';

/** Stored identity of a summary: what it covers. */
export interface SummaryScope {
  kind: SummaryKind;
  /** Date the summary describes (`kind='today'`). */
  date?: string | null;
  /** Range selector (`kind='report'`). */
  rangeKey?: ReportRange | null;
  startDate?: string | null;
  endDate?: string | null;
}

/**
 * Rule 3: is this summary scope addressable?
 *
 * `custom` needs both bounds — a custom range with one end is not a range, and
 * storing it under a key that only says "custom" would silently merge every
 * one-sided request into one row.
 */
export function isAddressableScope(scope: SummaryScope): boolean {
  if (scope.kind === 'today') {
    return (scope.date ?? '').trim().length > 0;
  }
  if (scope.rangeKey == null) {
    return false;
  }
  if (scope.rangeKey !== 'custom') {
    return true;
  }
  return (
    (scope.startDate ?? '').trim().length > 0 &&
    (scope.endDate ?? '').trim().length > 0
  );
}

/**
 * Rule 2: may `incoming` replace `stored`?
 *
 * - No stored version (first write, or a legacy unversioned row) -> yes: there is
 *   no fence to compare against, and refusing would strand the row forever.
 * - Incoming has no version -> no: an unversioned write cannot prove it is newer,
 *   and the fence exists precisely to stop it.
 * - Otherwise incoming must be **strictly newer**. Equal versions are refused on
 *   purpose: two generations at the same version carry the same source data, so
 *   replacing one with the other only churns the row.
 */
export function mayReplaceSummary(input: {
  storedSourceVersion: number | null;
  incomingSourceVersion: number | null;
}): boolean {
  if (input.storedSourceVersion == null) {
    return true;
  }
  if (input.incomingSourceVersion == null) {
    return false;
  }
  return input.incomingSourceVersion > input.storedSourceVersion;
}

/**
 * Stable key for a summary scope.
 *
 * Persistence stores one row per `(userId, scopeKey)`; the key must therefore be a
 * pure function of the scope and must distinguish every addressable scope. An
 * unaddressable scope yields `null` so callers cannot invent a key that collides
 * with a real one.
 */
export function scopeKeyOf(scope: SummaryScope): string | null {
  if (!isAddressableScope(scope)) {
    return null;
  }
  if (scope.kind === 'today') {
    return `today:${scope.date ?? ''}`;
  }
  if (scope.rangeKey !== 'custom') {
    return `report:${scope.rangeKey ?? ''}`;
  }
  return `report:custom:${scope.startDate ?? ''}:${scope.endDate ?? ''}`;
}
