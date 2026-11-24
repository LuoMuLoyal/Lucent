/**
 * Per-medicine daily notification ledger for half-life aware missed-dose hints.
 *
 * ## Why this is a port in `suggestion`
 *
 * The rule that decides "should this be hinted" is this context's, and so is the
 * "at most once per day" ceiling. Another module owning the table would split
 * one rule across two contexts and leave neither able to state it.
 *
 * ## Why it exists at all
 *
 * `evaluateHalfLifeGap` takes a `lastNotifiedAt`, but nothing stored it — the
 * parameter existed and the value did not, so the daily ceiling could never fire.
 * Keeping it in process memory would reset on every restart, and a recompute
 * (which happens far more often than a hint) would re-notify the same day.
 *
 * ## `claimMark` is the arbiter, `findMark` is only a fast path
 *
 * Read-then-write is a race: two concurrent recomputes both read "no mark", both
 * decide to hint, and both write — one insert wins, but *both* callers already
 * emitted. So the ceiling is enforced by **whoever's insert actually lands**,
 * which is what a unique key can answer and a pre-read cannot.
 *
 * Callers must therefore treat `claimMark === false` as "someone else already
 * hinted this medicine today" and emit nothing.
 *
 * ## Day boundary
 *
 * The key is a **local calendar day** (`YYYY-MM-DD`) supplied by the caller from
 * the user's own calendar date. Using a timestamp instead would split one day
 * into two across a timezone boundary, and a rolling 24-hour window would fire
 * twice in a calendar day and again right after midnight.
 */

/** DI token; a string so a Nest resolution error names the port readably. */
export const NOTIFY_LEDGER = 'NOTIFY_LEDGER';

/** One recorded hint. */
export interface NotifyMark {
  readonly currentMedicineId: string;
  /** Local calendar day the hint belongs to (`YYYY-MM-DD`). */
  readonly notifyDate: string;
  readonly notifiedAt: Date;
}

/** What the rule needs from the ledger. */
export abstract class NotifyLedgerPort {
  /**
   * The hint already recorded for this medicine on this local day, or `null`.
   *
   * Used to answer "when did we last hint this medicine" so the domain rule can
   * apply its own throttle. **Not** a guard against double-emitting — that is
   * {@link claimMark}'s job.
   */
  abstract findMark(
    userId: string,
    currentMedicineId: string,
    notifyDate: string,
  ): Promise<NotifyMark | null>;

  /**
   * Atomically claims today's hint slot for this medicine.
   *
   * @returns `true` when this caller created the record — it is the one allowed
   *   to emit the hint. `false` when the slot was already taken, in which case
   *   the caller must emit nothing: another run already did.
   *
   * Implementations must make this a single atomic write (insert-if-absent) and
   * derive the answer from whether *their* row landed, never from a preceding
   * read. Calling it twice for the same day is safe: the second call reports
   * `false` and the stored record is unchanged.
   */
  abstract claimMark(
    userId: string,
    currentMedicineId: string,
    notifyDate: string,
  ): Promise<boolean>;
}
