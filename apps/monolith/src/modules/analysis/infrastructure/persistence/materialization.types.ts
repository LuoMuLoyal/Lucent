export {
  TODAY_ANALYSIS_MAX_GENERATIONS_PER_DATE,
  TODAY_ANALYSIS_REFRESH_COOLDOWN_MS,
  TODAY_ANALYSIS_CLAIM_TIMEOUT_MS,
  TODAY_ANALYSIS_REASON_CODES,
  type AnalysisReasonCode,
  type PersistedTodayAnalysisStatus,
  type AnalysisStatus,
} from '../../domain/analysis/materialization-vocabulary.js';

import type {
  PersistedTodayAnalysisStatus,
  AnalysisReasonCode,
  AnalysisStatus,
} from '../../domain/analysis/materialization-vocabulary.js';

export interface AnalysisMaterializationRow {
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

export interface AnalysisMaterializationView extends Omit<
  AnalysisMaterializationRow,
  'status'
> {
  status: AnalysisStatus;
}

export interface MarkTodayAnalysisPendingInput {
  userId: string;
  localDate: string;
  reasonCode: AnalysisReasonCode;
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
