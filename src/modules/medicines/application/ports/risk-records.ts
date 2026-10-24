/**
 * Medicine risk-check persistence contract (`application/ports`).
 *
 * Reads and writes the `medicine_risk_check_record` rows plus the user health
 * snapshot (allergies / conditions / current medicines) and medicine reminder
 * rows the risk-check use case needs. Implemented against Prisma in
 * `infrastructure/persistence/risk-records.ts`.
 */

export const MEDICINE_RISK_RECORDS = 'MEDICINE_RISK_RECORDS';

export type MedicineRiskCheckType = 'static' | 'llm';

export interface MedicineRiskCheckRecordRow {
  checkType: MedicineRiskCheckType;
  result: unknown;
  riskScore: number;
  riskLevel: string;
  stale: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserAllergyRow {
  label: string;
  reaction: string | null;
  severity: string | null;
  isActive: boolean;
}

export interface UserConditionRow {
  label: string;
  status: string;
}

export interface CurrentMedicineRow {
  id: string;
  source: string;
  sourceRefId: string | null;
  displayName: string;
  startedAt: Date | null;
}

export interface UserHealthContext {
  allergies: UserAllergyRow[];
  conditions: UserConditionRow[];
  currentMedicines: CurrentMedicineRow[];
}

export interface MedicineReminderRow {
  /** `null` when the reminder is not attached to a box medicine. */
  currentMedicineId: string | null;
  scheduledHour: number;
  scheduledMinute: number;
  daysOfWeek: unknown;
  startDate: Date | null;
  endDate: Date | null;
}

export interface MedicineRiskRecordsPort {
  listRecords(userId: string): Promise<MedicineRiskCheckRecordRow[]>;

  upsertRecord(
    userId: string,
    checkType: MedicineRiskCheckType,
    payload: { result: unknown; riskScore: number; riskLevel: string },
  ): Promise<MedicineRiskCheckRecordRow>;

  markAllStale(userId: string): Promise<void>;

  /**
   * User health snapshot for risk evaluation. `limit` bounds the fetched
   * related-record count per list (allergies, conditions, medicines) so
   * extreme data volumes cannot blow up query latency.
   */
  loadHealthContext(
    userId: string,
    limit: number,
  ): Promise<UserHealthContext | null>;

  /** Active medicine reminders ordered by scheduled time. */
  listReminders(userId: string): Promise<MedicineReminderRow[]>;
}
