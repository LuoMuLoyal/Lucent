/**
 * Read-only port for other contexts that need dose-log facts (ADR-0009).
 *
 * ## Why this is separate from `DoseLogs`
 *
 * `DoseLogs` is the write-side repository: it hands out whole rows so the
 * aggregate can decide something. Downstream consumers (reports, today-analysis,
 * today-suggestion) do not decide — they project. Handing them `DoseLogs` would
 * expose write methods they must not call and a row shape far wider than they
 * need.
 *
 * This port therefore exposes five fields and a hard row cap. It is implemented
 * by the same Prisma adapter, so no extra query path is introduced.
 *
 * ## The cap is part of the contract
 *
 * `listFactsInRange` is capped (`MAX_READER_FACTS`): an unbounded context query
 * would slow the AI pipeline as a user's history grows. Callers that need exact
 * totals use `countFactsInRange`, and callers that need "when was the last one"
 * use `findLatestScheduledForInRange` — both are cheap and unbounded-safe.
 */

import type { DoseLogStatus } from '#generated/prisma/client.js';

/** Lean dose-log shape for cross-context readers. */
export interface DoseLogFact {
  currentMedicineId: string | null;
  reminderId: string | null;
  status: DoseLogStatus;
  scheduledTime: string | null;
  scheduledFor: Date;
}

/**
 * Cross-context reader port.
 *
 * ## The published name is kept
 *
 * The historical name `MedicineDoseLogReaderPort` is retained: three other
 * contexts (the reports dashboard, reports event-review, and today-analysis)
 * already inject it by that token. Renaming a port other contexts depend on is
 * a cross-module breaking change with no behavioural upside; ADR-0024's naming
 * rules govern *internal* structure, and this is a published boundary.
 */
export abstract class MedicineDoseLogReaderPort {
  /**
   * Non-deleted logs with `scheduledFor` in `[from, to]`, ordered
   * `scheduledFor asc`, capped at `MAX_READER_FACTS`.
   */
  abstract listFactsInRange(
    userId: string,
    from: Date,
    to: Date,
  ): Promise<DoseLogFact[]>;

  /** Exact count of non-deleted logs with `scheduledFor` in `[from, to]`. */
  abstract countFactsInRange(
    userId: string,
    from: Date,
    to: Date,
  ): Promise<number>;

  /** Latest `scheduledFor` in `[from, to]`, or `null` when none exists. */
  abstract findLatestScheduledForInRange(
    userId: string,
    from: Date,
    to: Date,
  ): Promise<Date | null>;
}
