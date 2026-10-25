/**
 * `UserSettings` aggregate (ADR-0024, User Profile context).
 *
 * ## Why an aggregate over a bag of key/value rows
 *
 * Storage is one row per setting (`@@unique([userId, key])`), but the *resource*
 * the API returns is the assembled whole: every field has a default, and a
 * missing row is not "unset", it is "default". That resolution rule — read the
 * row if present and type-valid, otherwise fall back — is the only business
 * rule this context has on the read path, and it used to live in a private
 * method of a 250-line service. Here it is pure and testable without Prisma.
 *
 * ## `updatedAt` is the newest row, not a resource timestamp
 *
 * There is no `UserSetting` row holding the resource itself, so `updatedAt` is
 * the max `updatedAt` across the user's rows (`rows` are pre-sorted desc). An
 * empty set means "never written" and yields `null` — the client uses that to
 * distinguish "defaults" from "the user actually saved something".
 */

import {
  ASSISTANT_CONTEXT_DEFAULTS,
  ASSISTANT_CONTEXT_SETTING_KEYS,
  PASSWORD_REAUTHENTICATION_REQUIRED,
  USER_SETTING_KEYS,
  USER_SETTINGS_DEFAULTS,
  type AssistantContextField,
  type SettingUpsert,
  type SettingValue,
  type UserSettingField,
} from './setting-key.js';

/** One stored row, as the repository hands it over. */
export interface StoredSettingRow {
  key: string;
  value: unknown;
  updatedAt: Date;
}

/** The assembled settings resource (shapes the HTTP response). */
export interface UserSettingsSnapshot {
  aiSummariesEnabled: boolean;
  dataSharingConsent: boolean;
  assistantEnabled: boolean;
  assistantMemoryEnabled: boolean;
  waterTargetCount: number;
  assistantContext: Record<AssistantContextField, boolean>;
  updatedAt: Date | null;
  passwordReauthenticationRequired: boolean;
}

/**
 * A partial update, expressed in **field** terms rather than stored-key terms.
 *
 * Kept separate from the HTTP DTO on purpose: the DTO is the wire contract
 * (zod, `.strict()`), this is the application-layer command. Splitting them
 * means the domain does not import zod schemas and the transport can evolve
 * without touching the rule that turns fields into rows.
 */
export interface UserSettingsPatch {
  aiSummariesEnabled?: boolean;
  dataSharingConsent?: boolean;
  assistantEnabled?: boolean;
  assistantMemoryEnabled?: boolean;
  waterTargetCount?: number;
  assistantContext?: Partial<Record<AssistantContextField, boolean>>;
}

const TOP_LEVEL_FIELDS: readonly UserSettingField[] = [
  'aiSummariesEnabled',
  'dataSharingConsent',
  'assistantEnabled',
  'assistantMemoryEnabled',
  'waterTargetCount',
];

const ASSISTANT_CONTEXT_FIELDS: readonly AssistantContextField[] = [
  'healthProfile',
  'dailyRecords',
  'sleepRecords',
  'currentMedicines',
];

export class UserSettings {
  private constructor(
    readonly userId: string,
    private readonly snapshot: UserSettingsSnapshot,
  ) {}

  /**
   * Assembles the aggregate from whatever rows exist.
   *
   * `rows` must be ordered `updatedAt desc` (the repository guarantees it);
   * the first row is the newest, which becomes `updatedAt`.
   */
  static fromRows(userId: string, rows: StoredSettingRow[]): UserSettings {
    const stored = new Map<string, SettingValue>();
    for (const row of rows) {
      // Later rows would overwrite earlier ones, but the unique index on
      // (userId, key) means there is exactly one row per key; the loop is
      // defensive, not a merge strategy.
      if (isSettingValue(row.value)) {
        stored.set(row.key, row.value);
      }
    }

    const boolOf = (key: string, fallback: boolean): boolean => {
      const value = stored.get(key);
      return typeof value === 'boolean' ? value : fallback;
    };
    const numberOf = (key: string, fallback: number): number => {
      const value = stored.get(key);
      return typeof value === 'number' && Number.isFinite(value)
        ? value
        : fallback;
    };

    const snapshot: UserSettingsSnapshot = {
      aiSummariesEnabled: boolOf(
        USER_SETTING_KEYS.aiSummariesEnabled,
        USER_SETTINGS_DEFAULTS.aiSummariesEnabled,
      ),
      dataSharingConsent: boolOf(
        USER_SETTING_KEYS.dataSharingConsent,
        USER_SETTINGS_DEFAULTS.dataSharingConsent,
      ),
      assistantEnabled: boolOf(
        USER_SETTING_KEYS.assistantEnabled,
        USER_SETTINGS_DEFAULTS.assistantEnabled,
      ),
      assistantMemoryEnabled: boolOf(
        USER_SETTING_KEYS.assistantMemoryEnabled,
        USER_SETTINGS_DEFAULTS.assistantMemoryEnabled,
      ),
      waterTargetCount: numberOf(
        USER_SETTING_KEYS.waterTargetCount,
        USER_SETTINGS_DEFAULTS.waterTargetCount,
      ),
      assistantContext: {
        healthProfile: boolOf(
          ASSISTANT_CONTEXT_SETTING_KEYS.healthProfile,
          ASSISTANT_CONTEXT_DEFAULTS.healthProfile,
        ),
        dailyRecords: boolOf(
          ASSISTANT_CONTEXT_SETTING_KEYS.dailyRecords,
          ASSISTANT_CONTEXT_DEFAULTS.dailyRecords,
        ),
        sleepRecords: boolOf(
          ASSISTANT_CONTEXT_SETTING_KEYS.sleepRecords,
          ASSISTANT_CONTEXT_DEFAULTS.sleepRecords,
        ),
        currentMedicines: boolOf(
          ASSISTANT_CONTEXT_SETTING_KEYS.currentMedicines,
          ASSISTANT_CONTEXT_DEFAULTS.currentMedicines,
        ),
      },
      updatedAt: rows.length > 0 ? (rows[0]?.updatedAt ?? null) : null,
      passwordReauthenticationRequired: PASSWORD_REAUTHENTICATION_REQUIRED,
    };

    return new UserSettings(userId, snapshot);
  }

  /** The current resource. */
  toSnapshot(): UserSettingsSnapshot {
    return this.snapshot;
  }

  /**
   * Turns a partial update into the rows to upsert.
   *
   * `undefined` means "not supplied" and produces no row — an empty result is a
   * legitimate no-op (`PATCH {}` returns the current resource).
   *
   * The assistant-context block (a separate `UserProfile` aggregate) and the
   * settings aggregate are written in the same call by the use case; this
   * method only knows the settings half so the boundary stays visible.
   */
  static upsertsFor(patch: UserSettingsPatch): SettingUpsert[] {
    const upserts: SettingUpsert[] = [];
    for (const field of TOP_LEVEL_FIELDS) {
      const value = patch[field];
      if (value !== undefined) {
        upserts.push({ key: USER_SETTING_KEYS[field], value });
      }
    }
    for (const field of ASSISTANT_CONTEXT_FIELDS) {
      const value = patch.assistantContext?.[field];
      if (value !== undefined) {
        upserts.push({ key: ASSISTANT_CONTEXT_SETTING_KEYS[field], value });
      }
    }
    return upserts;
  }
}

function isSettingValue(value: unknown): value is SettingValue {
  return typeof value === 'boolean' || typeof value === 'number';
}
