/**
 * Baseline vocabulary of the Daily Guidance context (ADR-0024 `domain/`).
 *
 * A **baseline** answers "do we know this user well enough yet to say anything
 * about this dimension?". Rules consult it before firing
 * (`isBaselineRequired` + `baselineDimensions`) so the engine does not
 * pronounce on a dimension it has barely observed — a suggestion built on two
 * days of data reads as knowledge the system does not have.
 *
 * It is domain language, not a read model: the dimension ladder is what the
 * rules and the lifecycle policy agree on.
 */

/** Dimensions for cold-start baseline tracking. */
export enum BaselineDimension {
  WATER_INTAKE = 'water_intake',
  SLEEP_DURATION = 'sleep_duration',
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
