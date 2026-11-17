/** Tunables are shared with tests that assert the retry/poll contract. */

/** Poll frequency for the outbox publisher (5s keeps cross-context lag low). */
export const OUTBOX_POLL_INTERVAL_MS = 5_000;

/** Rows at/above this attempt count are parked until a manual fix. */
export const OUTBOX_MAX_ATTEMPTS = 5;
