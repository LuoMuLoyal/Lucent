/**
 * The assembled Today Analysis input, as the pipeline consumes it.
 *
 * Owned by the application layer because the use case, the LLM generator and
 * the prompt builder all read it; leaving it in dapters/acl/ would force
 * infrastructure/ to import an adapter (ddd-infrastructure-no-adapters).
 * The ACL produces it, it does not own the vocabulary.
 */

import type { ObservedMetric } from '../../../../common/index.js';

export interface TodayAnalysisContext {
  date: string;
  water: {
    completedCount: number;
    targetCount: number;
    remainingCount: number;
    observedMetric?: ObservedMetric<number>;
  };
  medication: {
    medicineCount: number;
    pendingCount: number;
    nextDoseTimeLabel: string;
    nextMedicineName: string | null;
    currentMedicineNames: string[];
  };
  recordSummary: Array<{
    kind: string;
    count: number;
  }>;
  recentRecords: Array<{
    kind: string;
    title: string | null;
    value: string | null;
    unit: string | null;
    note: string | null;
    createdAt: string;
  }>;
  sleep: {
    status: 'ok' | 'insufficient_data';
    durationMinutes: number | null;
    quality: string | null;
    startedAt: string | null;
    endedAt: string | null;
    deepMinutes: number | null;
    lightMinutes: number | null;
    remMinutes: number | null;
  };
  lowRiskContext: {
    activeAllergyCount: number;
    currentMedicineCount: number;
  };
}
