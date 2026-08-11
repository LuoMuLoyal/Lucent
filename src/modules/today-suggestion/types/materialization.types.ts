export const MATERIALIZATION_REASON_CODES = [
  'daily_record_changed',
  'dose_log_changed',
  'reminder_changed',
  'health_context_changed',
  'settings_changed',
  'health_event_changed',
] as const;

export type MaterializationReasonCode =
  (typeof MATERIALIZATION_REASON_CODES)[number];

export type PersistedMaterializationStatus = 'pending' | 'ready' | 'failed';

export type MaterializationStatus =
  | PersistedMaterializationStatus
  | 'stale'
  | 'empty';

export interface MaterializationRow {
  id: string;
  userId: string;
  localDate: Date;
  sourceVersion: number;
  computedVersion: number;
  status: PersistedMaterializationStatus;
  reasonCodes: MaterializationReasonCode[];
  lastErrorCode: string | null;
  queuedAt: Date | null;
  computedAt: Date | null;
  updatedAt: Date;
}

export interface MaterializationStatusView extends Omit<
  MaterializationRow,
  'status'
> {
  status: MaterializationStatus;
}

export interface MarkPendingInput {
  userId: string;
  localDate: string;
  sourceVersion: number;
  reasonCodes: MaterializationReasonCode[];
}

export interface MaterializationVersionInput {
  userId: string;
  localDate: string;
  sourceVersion: number;
  reasonCodes?: MaterializationReasonCode[];
}
