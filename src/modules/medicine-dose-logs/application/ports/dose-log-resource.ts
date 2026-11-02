/**
 * The dose-log resource as the application layer knows it (ADR-0024 D2).
 *
 * The HTTP adapter's zod schemas are pinned to these types with
 * `satisfies z.ZodType<...>`, so the wire contract cannot drift from what the
 * application produces while the dependency only ever points inward.
 */

/** One dose log as returned by the API. */
export interface DoseLogResource {
  id: string;
  healthEventId: string | null;
  currentMedicineId: string | null;
  reminderId: string | null;
  status: string;
  scheduledFor: string;
  scheduledTime: string | null;
  doseText: string | null;
  note: string | null;
  source: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One page of dose logs for a date. */
export interface DoseLogListResource {
  items: DoseLogResource[];
  total: number;
}

/**
 * Create command (`POST /medicine-dose-logs`).
 *
 * Keys admit explicit `undefined` because the request body is zod-inferred and
 * `exactOptionalPropertyTypes` treats `T | undefined` and an absent key as
 * different types; both mean "not supplied" here.
 */
export interface CreateDoseLogCommand {
  currentMedicineId?: string | undefined;
  reminderId?: string | undefined;
  healthEventId?: string | null | undefined;
  status: string;
  scheduledFor: string;
  scheduledTime?: string | undefined;
  doseText?: string | undefined;
  note?: string | undefined;
}

/** Idempotent mark command (`POST /medicine-dose-logs/mark`). */
export interface MarkDoseLogCommand {
  currentMedicineId?: string | undefined;
  reminderId?: string | undefined;
  healthEventId?: string | null | undefined;
  status: string;
  scheduledFor: string;
  scheduledTime?: string | undefined;
  doseText?: string | null | undefined;
  note?: string | null | undefined;
}

/** Update command (`PATCH /medicine-dose-logs/:id`). */
export interface UpdateDoseLogCommand {
  status?: string | undefined;
  doseText?: string | null | undefined;
  note?: string | null | undefined;
}
