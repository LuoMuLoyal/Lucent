/**
 * User Profile context — the settings aggregate's vocabulary (ADR-0024).
 *
 * ## Plain literals, not imports from `common/`
 *
 * The stored key strings also exist in
 * `src/common/constants/user-setting-keys.ts`, because `common/llm` must read
 * `digestEnabled` without depending on this module. The domain cannot
 * import from `common/` either (D1: `domain/**` is pure), so the literal values
 * are restated here.
 *
 * That is not a second source of truth going unnoticed: the two lists are
 * pinned to each other by `user-setting-keys.spec.ts`, which imports both and
 * fails on any drift. A comment cannot enforce that; a test can.
 */

export const USER_SETTING_KEYS = {
  digestEnabled: 'digestEnabled',
  dataSharingConsent: 'dataSharingConsent',
  assistantEnabled: 'assistantEnabled',
  assistantMemoryEnabled: 'assistantMemoryEnabled',
  assistantAgentMode: 'assistantAgentMode',
  waterTargetCount: 'waterTargetCount',
} as const;

/**
 * The three values `assistantAgentMode` may take.
 *
 * `default` means "follow the operator's `ASSISTANT_AGENT_RUNTIME`". The other
 * two are an explicit per-user override. Values are stored as strings in
 * `UserSetting.value` (which is `Json`), so this list is also the validation
 * boundary: anything else read back falls back to `default`.
 */
export const ASSISTANT_AGENT_MODES = [
  'default',
  'graph',
  'deepagents',
] as const;

export type AssistantAgentMode = (typeof ASSISTANT_AGENT_MODES)[number];

export const ASSISTANT_CONTEXT_SETTING_KEYS = {
  healthProfile: 'assistantContext.healthProfile',
  records: 'assistantContext.records',
  sleepRecords: 'assistantContext.sleepRecords',
  currentMedicines: 'assistantContext.currentMedicines',
} as const;

export const USER_SETTINGS_DEFAULTS = {
  digestEnabled: true,
  dataSharingConsent: false,
  assistantEnabled: true,
  assistantMemoryEnabled: false,
  assistantAgentMode: 'default' as AssistantAgentMode,
  waterTargetCount: 8,
} as const;

export const ASSISTANT_CONTEXT_DEFAULTS = {
  healthProfile: true,
  records: true,
  sleepRecords: true,
  currentMedicines: true,
} as const;

/** A field of the top-level settings resource that maps to one stored row. */
export type UserSettingField = keyof typeof USER_SETTING_KEYS;

/** A field of the nested assistant-context permission block. */
export type AssistantContextField = keyof typeof ASSISTANT_CONTEXT_SETTING_KEYS;

/** Value type actually persisted in `UserSetting.value`. */
export type SettingValue = boolean | number | string;

/** One row to upsert: the persisted key plus its new value. */
export interface SettingUpsert {
  key: string;
  value: SettingValue;
}

/**
 * `passwordReauthenticationRequired` is a constant, not a preference.
 *
 * Every sensitive operation on this backend requires a password re-auth, so the
 * response always carries `true`. It is **not** derived from any stored row and
 * `PATCH /settings` deliberately ignores it (the update schema rejects the
 * field as unknown). Making it settable would let a client downgrade its own
 * re-authentication requirement.
 */
export const PASSWORD_REAUTHENTICATION_REQUIRED = true;

/**
 * Every boolean setting this module knows about with its default value.
 *
 * Consumed when provisioning a brand-new account: the defaults are not written
 * on first read (a read stays read-only), so callers that need rows present
 * materialise them from this list.
 */
export function listDefaultBooleanUserSettings(): Array<{
  key: string;
  value: boolean;
}> {
  return [
    {
      key: USER_SETTING_KEYS.digestEnabled,
      value: USER_SETTINGS_DEFAULTS.digestEnabled,
    },
    {
      key: USER_SETTING_KEYS.assistantEnabled,
      value: USER_SETTINGS_DEFAULTS.assistantEnabled,
    },
    {
      key: USER_SETTING_KEYS.assistantMemoryEnabled,
      value: USER_SETTINGS_DEFAULTS.assistantMemoryEnabled,
    },
    ...assistantContextDefaults(),
  ];
}

function assistantContextDefaults(): Array<{ key: string; value: boolean }> {
  const fields = Object.keys(
    ASSISTANT_CONTEXT_SETTING_KEYS,
  ) as AssistantContextField[];
  return fields.map((field) => ({
    key: ASSISTANT_CONTEXT_SETTING_KEYS[field],
    value: ASSISTANT_CONTEXT_DEFAULTS[field],
  }));
}
