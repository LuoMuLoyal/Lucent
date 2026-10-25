/**
 * Scheduling constants for the suggestion lifecycle job.
 *
 * The lifecycle **durations** (how long a card stays `active`, how long it
 * fades) are not here: they are part of the lifecycle rule and live in
 * `domain/suggestion/daily-suggestion.ts`, next to the state ladder and the
 * thresholds derived from them. Only the cron cadence and the copy cache TTL
 * remain, because both are operational tuning rather than domain rules.
 *
 * ## What each state actually does today
 *
 * The transitions are defined in `domain/suggestion/daily-suggestion.ts`; this
 * is the user-visible consequence of each, as the code stands:
 *
 * - `active`  — the only state the Today page renders (`getActiveSuggestions`
 *               filters on it).
 * - `fading`  — **not shown on the Today page.** It marks "this card is past its
 *               display window but not yet archived"; it is visible only in
 *               history. An earlier version of this comment claimed fading
 *               cards were "still visible but de-emphasised", which no code
 *               ever implemented — treating that as the intent would have led
 *               straight into the `dismiss` guard, which only accepts `active`.
 * - `expired` — hidden from Today, visible in history.
 *
 * `generated` is declared by the Prisma enum but never written: rows are
 * created directly as `active`, so the schema's `@default(generated)` is
 * unreachable. It is not modelled in the domain.
 */

/** Cron interval for the lifecycle refresh job. */
export const LIFECYCLE_REFRESH_CRON = '*/5 * * * *'; // every 5 minutes

/** Copy generation cache TTL (1 hour) — copy doesn't change often. */
export const COPY_CACHE_TTL_MS = 60 * 60 * 1000;
