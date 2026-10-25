/**
 * Medicine risk-check **read** contract (`application/ports`).
 *
 * Reads the `medicine_risk_check_record` rows plus the user health snapshot
 * (allergies / conditions / current medicines) and medicine reminder rows the
 * risk-check use case needs. Implemented against Prisma in
 * `infrastructure/persistence/risk-records.ts`.
 *
 * ## Read-only by design
 *
 * This port used to carry `upsertRecord`. Writes now go through the
 * `RiskAssessment` aggregate's own store (`domain/safety/risk-assessments.ts`,
 * implemented by `infrastructure/persistence/risk-assessments.ts`) — ADR-0024
 * §4: a repository serves the write side of its aggregate, a read-model port
 * serves queries. Keeping a second write method here meant two write paths
 * could coexist; removing it makes "one write path" true by type rather than
 * by convention.
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
  /**
   * 关联的健康事件 id。
   *
   * 是**数组**：`HealthEventMedicine` 是 `@@unique([eventId, currentMedicineId])`，
   * 一个药可以同时挂在多条病程下。用药全景用它区分「同一个病程里开的」与
   * 「不同时期自己加的」——后者更值得提示，因为没有任何一个医生在统筹。
   */
  healthEventIds: string[];
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
