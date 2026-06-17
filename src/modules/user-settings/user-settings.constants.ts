export const USER_SETTING_KEYS = {
  aiSummariesEnabled: 'aiSummariesEnabled',
  dataSharingConsent: 'dataSharingConsent',
  aiChatEnabled: 'aiChatEnabled',
} as const;

export const AI_CHAT_CONTEXT_SETTING_KEYS = {
  healthProfile: 'aiChatContext.healthProfile',
  dailyRecords: 'aiChatContext.dailyRecords',
  sleepRecords: 'aiChatContext.sleepRecords',
  currentMedicines: 'aiChatContext.currentMedicines',
} as const;

export const USER_SETTINGS_DEFAULTS = {
  aiSummariesEnabled: true,
  dataSharingConsent: false,
  aiChatEnabled: true,
} as const;

export const AI_CHAT_CONTEXT_DEFAULTS = {
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
      key: USER_SETTING_KEYS.aiChatEnabled,
      value: USER_SETTINGS_DEFAULTS.aiChatEnabled,
    },
    ...(
      Object.entries(AI_CHAT_CONTEXT_SETTING_KEYS) as Array<
        [keyof typeof AI_CHAT_CONTEXT_SETTING_KEYS, string]
      >
    ).map(([field, key]) => ({
      key,
      value: AI_CHAT_CONTEXT_DEFAULTS[field],
    })),
  ];
}
