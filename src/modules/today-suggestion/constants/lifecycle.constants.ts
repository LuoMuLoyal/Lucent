/**
 * Suggestion lifecycle duration constants (milliseconds).
 *
 * State flow: generated → active → fading → expired | dismissed
 *
 * - ACTIVE:  a freshly generated card shown on the Today page.
 * - FADING:  the card is still visible but de-emphasised (e.g., dimmed).
 * - EXPIRED: the card is hidden from the Today page and only visible in history.
 */

/** How long a suggestion stays ACTIVE before transitioning to FADING. */
export const SUGGESTION_ACTIVE_DURATION_MS = 8 * 60 * 60 * 1000; // 8 hours

/** How long a suggestion stays FADING before transitioning to EXPIRED. */
export const SUGGESTION_FADING_DURATION_MS = 4 * 60 * 60 * 1000; // 4 hours

/** Cron interval for the lifecycle refresh job. */
export const LIFECYCLE_REFRESH_CRON = '*/5 * * * *'; // every 5 minutes

/** Copy generation cache TTL (1 hour) — copy doesn't change often. */
export const COPY_CACHE_TTL_MS = 60 * 60 * 1000;
