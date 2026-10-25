/** DI token for the materialization store. */
export const MATERIALIZATION_STORE_PORT = 'MATERIALIZATION_STORE_PORT';

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

/**
 * Persistence port for the per-user/day materialization row.
 *
 * The recompute queue adapters and the suggestion service both drive this
 * state machine, but the Prisma implementation is infrastructure — they depend
 * on this contract and the module binds MaterializationStore to it.
 */
export interface MaterializationStorePort {
  readStatus(
    userId: string,
    localDate: string,
  ): Promise<MaterializationStatusView>;
  markPending(input: MarkPendingInput): Promise<MaterializationStatusView>;
  markReady(
    input: MaterializationVersionInput,
  ): Promise<MaterializationStatusView>;
  markFailed(
    input: MaterializationVersionInput & {
      errorCode: string;
      computedVersion?: number;
    },
  ): Promise<MaterializationStatusView>;
}
