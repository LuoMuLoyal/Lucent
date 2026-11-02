/**
 * Repository port for the `DoseLog` aggregate (ADR-0024, Medication Tracking).
 *
 * ## Why the port speaks whole rows, not raw Prisma filters
 *
 * The previous port (`MedicineDoseLogRepositoryPort`) exposed
 * `Prisma.UserMedicineDoseLogWhereInput` / `OrderBy` / `UncheckedCreateInput` to
 * the application layer. That made every caller speak Prisma, so the layer
 * boundary existed only on paper and the service could not be tested without
 * Prisma shapes. This port names the three queries the context actually runs
 * (`listByDate`, `findBySlot`, `findOwnership`) and the two writes, so the
 * aggregate can be exercised with hand-built records.
 *
 * ## Failure semantics
 *
 * Reads return `null`/`[]` for "absent" — that is a value, not an error. Writes
 * return a plain promise and reject with a `DomainFailure` for mapped storage
 * outcomes (`RESOURCE_CONFLICT` on a unique race, `RESOURCE_NOT_FOUND` on a
 * missing row); anything else propagates untouched.
 */

import type { DomainFailure } from '../../../../common/result/index.js';

/** A dose-log row as the context reads and returns it. */
export interface DoseLogRecord {
  id: string;
  userId: string;
  healthEventId: string | null;
  currentMedicineId: string | null;
  reminderId: string | null;
  status: string;
  scheduledFor: Date;
  scheduledTime: string | null;
  doseText: string | null;
  note: string | null;
  source: string | null;
  takenAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Fields a create needs; everything else the database supplies. */
export interface NewDoseLog {
  userId: string;
  healthEventId: string | null;
  currentMedicineId: string | null;
  reminderId: string | null;
  status: string;
  scheduledFor: Date;
  scheduledTime: string | null;
  takenAt: Date | null;
  doseText: string | null;
  note: string | null;
}

/**
 * Fields an update may change.
 *
 * `undefined` means "leave as is"; `null` is a real value (clearing a column).
 * This distinction is the whole reason the update is modelled as a partial rather
 * than a full record: `PATCH { doseText: null }` clears the text, while omitting
 * the key must not.
 */
export interface DoseLogPatch {
  status?: string;
  scheduledTime?: string | null;
  takenAt?: Date | null;
  doseText?: string | null;
  note?: string | null;
  healthEventId?: string | null;
  currentMedicineId?: string | null;
  reminderId?: string | null;
}

/** What a reminder says about the slot a dose is being logged against. */
export interface ReminderSchedule {
  userId: string;
  currentMedicineId: string | null;
  scheduledHour: number;
  scheduledMinute: number;
}

/** Minimal ownership probe result for a current medicine. */
export interface OwnedCurrentMedicine {
  userId: string;
}

export abstract class DoseLogs {
  /** Non-deleted logs for one calendar date, ordered by slot then recency. */
  abstract listByDate(
    userId: string,
    date: Date,
    pagination: { page: number; pageSize: number },
  ): Promise<{ items: DoseLogRecord[]; total: number }>;

  /**
   * The live row for a slot, or `null`.
   *
   * "Live" means not soft-deleted: a deleted row must never be resurrected by a
   * later `mark`, otherwise deleting a mistakenly-logged dose and re-marking the
   * slot silently rewrites the deleted record.
   */
  abstract findBySlot(
    userId: string,
    slot: {
      reminderId: string;
      scheduledFor: Date;
      scheduledTime: string | null;
    },
  ): Promise<DoseLogRecord | null>;

  /** Non-deleted row by id, used to prove ownership before update/delete. */
  abstract findOwned(
    userId: string,
    id: string,
  ): Promise<{ userId: string; scheduledFor: Date } | null>;

  abstract create(input: NewDoseLog): Promise<DoseLogRecord>;

  abstract update(id: string, patch: DoseLogPatch): Promise<DoseLogRecord>;

  /** Soft-deletes by stamping `deletedAt`; never hard-deletes. */
  abstract softDelete(id: string, at: Date): Promise<void>;

  /** Reminder schedule for slot resolution, or `null` when not owned/found. */
  abstract findReminder(
    userId: string,
    reminderId: string,
  ): Promise<ReminderSchedule | null>;

  /** Ownership probe for a current medicine. */
  abstract findOwnedCurrentMedicine(
    userId: string,
    currentMedicineId: string,
  ): Promise<OwnedCurrentMedicine | null>;
}

/** Re-exported so adapters can name the failure type without importing common. */
export type { DomainFailure };
