export const USER_SETTING_KEYS = {
  aiSummariesEnabled: 'aiSummariesEnabled',
  dataSharingConsent: 'dataSharingConsent',
  assistantEnabled: 'assistantEnabled',
  assistantMemoryEnabled: 'assistantMemoryEnabled',
} as const;

export const ASSISTANT_CONTEXT_SETTING_KEYS = {
  healthProfile: 'assistantContext.healthProfile',
  dailyRecords: 'assistantContext.dailyRecords',
  sleepRecords: 'assistantContext.sleepRecords',
  currentMedicines: 'assistantContext.currentMedicines',
} as const;

export const USER_SETTINGS_DEFAULTS = {
  aiSummariesEnabled: true,
  dataSharingConsent: false,
  assistantEnabled: true,
  assistantMemoryEnabled: false,
} as const;

export const ASSISTANT_CONTEXT_DEFAULTS = {
  healthProfile: true,
  dailyRecords: true,
  sleepRecords: true,
  currentMedicines: true,
} as const;

export function listDefaultBooleanUserSettings(): Array<{
  key: string;
  value: boolean;
}> {
  return [
    {
      key: USER_SETTING_KEYS.aiSummariesEnabled,
      value: USER_SETTINGS_DEFAULTS.aiSummariesEnabled,
    },
    {
      key: USER_SETTING_KEYS.assistantEnabled,
      value: USER_SETTINGS_DEFAULTS.assistantEnabled,
    },
    {
      key: USER_SETTING_KEYS.assistantMemoryEnabled,
      value: USER_SETTINGS_DEFAULTS.assistantMemoryEnabled,
    },
    ...(
      Object.entries(ASSISTANT_CONTEXT_SETTING_KEYS) as Array<
        [keyof typeof ASSISTANT_CONTEXT_SETTING_KEYS, string]
      >
    ).map(([field, key]) => ({
      key,
      value: ASSISTANT_CONTEXT_DEFAULTS[field],
    })),
  ];
}
