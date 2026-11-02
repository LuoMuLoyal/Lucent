/**
 * `ProposedAction` — the value object a proposal carries, and the four kinds of
 * change the assistant is allowed to suggest (ADR-0024 §4, AI Assistant).
 *
 * A proposal never writes anything: it is a **snapshot plus a payload**, and the
 * snapshot exists so the client can show what will change without a second round
 * trip. The union is discriminated on `type`, and the discriminant is the same
 * string the confirm path switches on — one vocabulary from the tool that drafts
 * the proposal to the write that applies it.
 *
 * Layer purity (ADR-0024 rule D1): no imports outside `domain/`.
 */

/** A field rendered on the proposal card: a label and its (already localized) value. */
export interface ProposalPreviewField {
  label: string;
  value: string;
}

/** Kinds of daily record the assistant may *create* (a closed subset). */
export const CREATABLE_RECORD_KINDS = [
  'water',
  'meal',
  'symptom',
  'note',
  'sleep',
  'vital',
  'activity',
] as const;

export type CreatableRecordKind = (typeof CREATABLE_RECORD_KINDS)[number];

/** Create a daily record from a generated candidate. */
export interface CreateDailyRecordPayload {
  type: 'create_daily_record';
  draft: {
    kind: CreatableRecordKind;
    occurredAt: string;
    title: string | null;
    value: string | null;
    unit: string | null;
    note: string | null;
    payload: Record<string, unknown> | null;
  };
}

/**
 * Update a daily record.
 *
 * The draft carries **only the keys the assistant intended to change**: an absent
 * key means "leave it", an explicit `null` means "clear it". That distinction is
 * the whole reason this is not a full record DTO, and the write path passes the
 * draft through verbatim to preserve it.
 */
export interface UpdateDailyRecordPayload {
  type: 'update_daily_record';
  recordId: string;
  draft: {
    occurredAt?: string | null;
    title?: string | null;
    value?: string | null;
    unit?: string | null;
    note?: string | null;
    payload?: Record<string, unknown> | null;
  };
}

/** Delete one daily record. */
export interface DeleteDailyRecordPayload {
  type: 'delete_daily_record';
  recordId: string;
}

/** Change the assistant-related user settings. */
export interface UpdateUserSettingsPayload {
  type: 'update_user_settings';
  draft: {
    assistantEnabled?: boolean;
    assistantMemoryEnabled?: boolean;
    assistantContext?: {
      healthProfile?: boolean;
      dailyRecords?: boolean;
      sleepRecords?: boolean;
      currentMedicines?: boolean;
    };
  };
}

export type ProposalPayload =
  | CreateDailyRecordPayload
  | UpdateDailyRecordPayload
  | DeleteDailyRecordPayload
  | UpdateUserSettingsPayload;

export type ProposalActionType = ProposalPayload['type'];

/**
 * The target a proposal writes to.
 *
 * `daily_record_draft` is the create case (no record exists yet); the other two
 * name an existing record or the settings object. `snapshot` holds the state the
 * proposal was drafted against, so the UI can diff without a read.
 */
export interface ProposalTarget {
  kind: 'daily_record' | 'user_settings' | 'daily_record_draft';
  label: string;
  recordId?: string;
  settingKeys?: string[];
  matchedBy?: string[];
  snapshot?: Record<string, unknown>;
}

/** One proposed write, as it travels from a tool to the review step. */
export interface ProposedAction {
  /** Ephemeral id, unique within the streamed result and used by `confirm`. */
  id: string;
  type: ProposalActionType;
  status: 'proposed';
  /** A proposal is *always* confirmed by the user — never `false`. */
  confirmationRequired: true;
  title: string;
  summary: string;
  reason: string | null;
  previewFields: ProposalPreviewField[];
  target: ProposalTarget;
  /** Boundaries restated to the user, in the user's language. */
  constraints: string[];
  /** ISO-8601 instant after which the confirm path refuses this proposal. */
  expiresAt: string;
  /** Version of `payload`; bumping it means the write path must understand both. */
  payloadVersion: 1;
  payload: ProposalPayload;
}

/**
 * Settings keys touched by an `update_user_settings` draft, in stable order.
 *
 * Context switches are reported as `assistantContext.<key>` rather than bare keys:
 * the client renders them next to the two top-level switches, and `dailyRecords`
 * without its parent path reads like a daily-record operation.
 */
export function collectSettingsDraftKeys(
  draft: UpdateUserSettingsPayload['draft'],
): string[] {
  const keys: string[] = [];
  if (draft.assistantEnabled != null) {
    keys.push('assistantEnabled');
  }
  if (draft.assistantMemoryEnabled != null) {
    keys.push('assistantMemoryEnabled');
  }
  if (draft.assistantContext != null) {
    for (const key of Object.keys(draft.assistantContext)) {
      keys.push(`assistantContext.${key}`);
    }
  }
  return keys;
}

/** True when the draft actually changes a setting (empty drafts are not proposals). */
export function hasSettingsDraft(
  draft: UpdateUserSettingsPayload['draft'],
): boolean {
  return collectSettingsDraftKeys(draft).length > 0;
}
