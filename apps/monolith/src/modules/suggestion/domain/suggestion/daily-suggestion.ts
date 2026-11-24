/**
 * `DailySuggestion` aggregate vocabulary — the suggestion card's lifecycle
 * (ADR-0024, Daily Guidance context).
 *
 * ## Four states, not five
 *
 * The Prisma enum declares five (`generated` first), but **nothing ever writes
 * `generated`**: `persistActive` creates rows directly as `active`, so the
 * schema's `@default(generated)` is unreachable. Modelling it here would invite
 * code paths for a state that cannot occur, so the aggregate declares the four
 * that are actually reachable.
 *
 * ## Time is a parameter, never `now()` inside
 *
 * Every transition needs a clock to compare against (`fadingThreshold`), and a
 * domain function that reads the clock is neither pure nor testable. So the
 * caller passes `at`, and the thresholds are exported as pure functions. This
 * is what makes "a card active for 9 hours should fade" assertable with a
 * hand-built timestamp instead of fake timers.
 *
 * ## Why thresholds are exported rather than inlined in the SQL
 *
 * The two batch transitions run as `updateMany` (they are idempotent and safe
 * to run concurrently, which a load-modify-save loop would have to re-earn).
 * Their `WHERE` clauses therefore need the same 8h/12h boundaries this module
 * defines. Exporting `fadingThreshold` / `fadeExpiryThreshold` means the SQL
 * predicates **derive from** the domain rule instead of restating it — one
 * definition, one materialisation. Two independent statements of the same rule
 * would drift.
 */

/** Where a card sits in its lifecycle. All four are persisted. */
export type SuggestionLifecycleState =
  | 'active'
  | 'fading'
  | 'expired'
  | 'dismissed';

// ── Time units ─────────────────────────────────────────────────────────────
//
// The durations below are built from named units so the intent reads as
// "eight hours" rather than a bare millisecond count, and so the two durations
// cannot drift into different unit conventions.

const SECONDS_PER_MINUTE = 60;
const MILLIS_PER_SECOND = 1000;
const MINUTES_PER_HOUR = 60;
const MS_PER_MINUTE = SECONDS_PER_MINUTE * MILLIS_PER_SECOND;
const MS_PER_HOUR = MINUTES_PER_HOUR * MS_PER_MINUTE;

/** Hours a card stays `active` before it starts fading. */
const ACTIVE_HOURS = 8;

/** Hours a card stays `fading` before it expires. */
const FADING_HOURS = 4;

/**
 * How long a card stays `active` before it starts fading.
 *
 * Named here (not in `constants/`) because it is part of the lifecycle rule,
 * not module-wide tuning.
 */
export const SUGGESTION_ACTIVE_DURATION_MS = ACTIVE_HOURS * MS_PER_HOUR;

/** How long a card stays `fading` before it expires. */
export const SUGGESTION_FADING_DURATION_MS = FADING_HOURS * MS_PER_HOUR;

/** Activation time at or before which an `active` card should start fading. */
export function fadingThreshold(at: Date): Date {
  return new Date(at.getTime() - SUGGESTION_ACTIVE_DURATION_MS);
}

/** Activation time at or before which a `fading` card should expire. */
export function fadeExpiryThreshold(at: Date): Date {
  return new Date(
    at.getTime() -
      SUGGESTION_ACTIVE_DURATION_MS -
      SUGGESTION_FADING_DURATION_MS,
  );
}

/**
 * `true` when an activation timestamp is old enough for the card to fade.
 *
 * Mirrors the batch predicate (`activatedAt < fadingThreshold(at)`), including
 * its strictness: a card activated at exactly the boundary has not faded yet.
 */
export function canFade(activatedAt: Date, at: Date): boolean {
  return activatedAt.getTime() < fadingThreshold(at).getTime();
}

/** `true` when a fading card is old enough to expire. */
export function canExpireAfterFading(activatedAt: Date, at: Date): boolean {
  return activatedAt.getTime() < fadeExpiryThreshold(at).getTime();
}

/**
 * How "current" a state is, when history is deduplicated by `ruleId + subtype`.
 *
 * Higher wins. `expired` scores lowest because a card that ran its course is
 * the least current thing we can show; `dismissed` outranks it because the user
 * still made a decision about it.
 *
 * This is a domain judgement about the states, not a storage detail — which is
 * why it lives here rather than as a `private static` on the persistence-side
 * service it was extracted from.
 */
const RANK_ACTIVE = 3;
const RANK_FADING = 2;
const RANK_DISMISSED = 1;
const RANK_EXPIRED = 0;

export function lifecycleRank(state: SuggestionLifecycleState): number {
  switch (state) {
    case 'active':
      return RANK_ACTIVE;
    case 'fading':
      return RANK_FADING;
    case 'dismissed':
      return RANK_DISMISSED;
    case 'expired':
      return RANK_EXPIRED;
  }
}
