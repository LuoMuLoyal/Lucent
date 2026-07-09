/** Dimensions for cold-start baseline tracking. */
export enum BaselineDimension {
  WATER_INTAKE = 'water_intake',
  SLEEP_DURATION = 'sleep_duration',
  CAFFEINE_INTAKE = 'caffeine_intake',
  SYMPTOM_SEVERITY = 'symptom_severity',
  MEDICATION_ADHERENCE = 'medication_adherence',
  MOOD = 'mood',
}

/** A stored baseline record for one user + dimension. */
export interface BaselineRecord {
  userId: string;
  dimension: BaselineDimension;
  daysCollected: number;
  baselineValue: number | null;
  establishedAt: Date | null;
}

/** Minimum consecutive recording days to establish a baseline. */
export const BASELINE_MIN_DAYS = 3;
