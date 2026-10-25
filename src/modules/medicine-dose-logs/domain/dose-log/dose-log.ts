/**
 * `DoseLog` aggregate vocabulary (ADR-0024, Medication Tracking context).
 *
 * ## What this context actually decides
 *
 * A dose log answers one question — "did the user take this medicine at this
 * slot?" — and every rule here is about **slot identity**: which existing row a
 * `mark` may upsert, and when a payload identifies no slot at all. Everything
 * else (ownership, reminders, health events) is a lookup, not a decision.
 *
 * ## Why `planned` is not a status the domain reasons about
 *
 * `DoseLogStatus` has `planned` / `taken` / `skipped`, but nothing in this
 * context *creates* a `planned` row: logs are written when the user acts, so a
 * new row is always `taken` or `skipped`. `planned` rows can only arrive from
 * another writer, and this module treats them as just another existing row. The
 * domain therefore models only the transition it performs: "this slot is now
 * `taken`/`skipped` at time T".
 */

/** Status a user can assert about a dose slot. */
export type DoseLogOutcome = 'taken' | 'skipped';

/**
 * The identity of a reminder-backed slot: one reminder, one date, one time.
 *
 * `scheduledTime` participates even though it is also a column: two logs for the
 * same reminder and date at different times are *different* slots (a reminder can
 * be edited, and the old row must not be silently merged), so time is identity,
 * not decoration.
 */
export interface DoseSlotIdentity {
  reminderId: string;
  scheduledFor: Date;
  scheduledTime: string | null;
}

/**
 * Resolved write target for a create/mark call.
 *
 * `reminderId === null` means a *temporary* log (a dose the user records without
 * a reminder). Temporary logs have no stable slot identity, so they are never
 * merged — each `mark` creates its own row. That is deliberate: merging by
 * medicine+date+time would silently collapse two separate doses of the same
 * medicine taken on the same day.
 */
export interface DoseTarget {
  currentMedicineId: string | null;
  reminderId: string | null;
  scheduledFor: Date;
  scheduledTime: string | null;
}

/**
 * The lookup identity used to find an existing row to update on `mark`.
 *
 * Returns `null` for a temporary log — "never merge" is expressed as "there is no
 * lookup key", not as a special case at every call site.
 */
export function slotIdentityOf(target: DoseTarget): DoseSlotIdentity | null {
  if (target.reminderId === null) {
    return null;
  }
  return {
    reminderId: target.reminderId,
    scheduledFor: target.scheduledFor,
    scheduledTime: target.scheduledTime,
  };
}

/**
 * Whether a `mark` payload identifies any target at all.
 *
 * A payload with neither a reminder nor a current medicine cannot be attached to
 * anything; it is reported under its own code
 * (`DOSE_LOG_TARGET_UNRESOLVED`) rather than the generic `VALIDATION_FAILED`,
 * because the client's sync queue uses that code to decide "this payload's
 * identity is wrong, retrying byte-identically will never succeed".
 */
export function hasResolvableTarget(
  reminderId: string | null,
  currentMedicineId: string | null,
): boolean {
  return reminderId !== null || currentMedicineId !== null;
}

/**
 * Whether an explicit medicine id contradicts the reminder's own medicine.
 *
 * Both sides present and different means the caller is attaching the dose to a
 * medicine the reminder does not describe — the same unresolvable-target case,
 * not a validation error about the request body.
 */
export function contradictsReminderMedicine(
  requestedMedicineId: string | null,
  reminderMedicineId: string | null,
): boolean {
  return (
    requestedMedicineId !== null &&
    reminderMedicineId !== null &&
    requestedMedicineId !== reminderMedicineId
  );
}

/**
 * The medicine a write should link, given what the caller sent and what the
 * reminder says.
 *
 * The caller's value wins; the reminder is the fallback so a slot-aware `mark`
 * does not have to repeat the medicine. `null` means "not linked to a current
 * medicine" — a legitimate state for a historical record whose medicine was
 * deleted from the box.
 */
export function resolveMedicineId(
  requested: string | null,
  reminderMedicineId: string | null,
): string | null {
  return requested ?? reminderMedicineId;
}

/**
 * The time a write should store for a slot.
 *
 * An explicit time wins (the client may be correcting a reminder's slot), and the
 * reminder's schedule is the fallback so the row lands on the slot the reminder
 * describes. Temporary logs have no reminder and therefore no time.
 */
export function resolveScheduledTime(
  requestedTime: string | null,
  reminderSchedule: { hour: number; minute: number } | null,
): string | null {
  if (requestedTime !== null) {
    return requestedTime;
  }
  if (reminderSchedule === null) {
    return null;
  }
  return `${pad2(reminderSchedule.hour)}:${pad2(reminderSchedule.minute)}`;
}

/**
 * When a dose was taken.
 *
 * `takenAt` is set only for `taken`, and cleared for `skipped`: the column means
 * "the instant this was actually taken", so leaving a stale timestamp on a
 * skipped row would make the reports count a dose that was refused.
 */
export function takenAtFor(outcome: DoseLogOutcome, at: Date): Date | null {
  return outcome === 'taken' ? at : null;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}
