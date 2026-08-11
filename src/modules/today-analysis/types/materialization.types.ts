export const TODAY_ANALYSIS_MAX_GENERATIONS_PER_DATE = 3;
export const TODAY_ANALYSIS_REFRESH_COOLDOWN_MS = 5 * 60 * 1000;
export const TODAY_ANALYSIS_CLAIM_TIMEOUT_MS = 15 * 60 * 1000;

export const TODAY_ANALYSIS_REASON_CODES = [
  'symptom_check_in',
  'health_event_changed',
  'dose_log_changed',
  'suggestion_materialization_changed',
  'manual_refresh',
] as const;

export type TodayAnalysisReasonCode =
  (typeof TODAY_ANALYSIS_REASON_CODES)[number];

export type PersistedTodayAnalysisStatus =
  | 'pending'
  | 'ready'
  | 'failed'
  | 'capped';

export type TodayAnalysisStatus =
  | 'pending'
  | 'ready'
  | 'failed'
  | 'stale'
  | 'empty';

export interface TodayAnalysisMaterializationRow {
  id: string;
  userId: string;
  localDate: Date;
  sourceVersion: number;
  computedVersion: number;
  status: PersistedTodayAnalysisStatus;
  reasonCodes: string[];
  generationCount: number;
  activeVersion: number | null;
  activeAt: Date | null;
  lastManualAt: Date | null;
  lastTriggerKey?: string | null;
  lastErrorCode: string | null;
  queuedAt: Date | null;
  computedAt: Date | null;
  updatedAt: Date;
}

export interface TodayAnalysisMaterializationView extends Omit<
  TodayAnalysisMaterializationRow,
  'status'
> {
  status: TodayAnalysisStatus;
}

export interface MarkTodayAnalysisPendingInput {
  userId: string;
  localDate: string;
  reasonCode: TodayAnalysisReasonCode;
  requestedSourceVersion?: number;
  triggerKey?: string;
  manual?: boolean;
}

export interface MarkTodayAnalysisReadyInput {
  userId: string;
  localDate: string;
  sourceVersion: number;
  activeVersion: number;
}

export interface MarkTodayAnalysisFailedInput extends MarkTodayAnalysisReadyInput {
  errorCode: string;
}
