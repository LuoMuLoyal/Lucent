import {
  AI_SUMMARIES_ENABLED_SETTING_KEY,
  ASSISTANT_CONTEXT_DAILY_RECORDS_SETTING_KEY,
  ASSISTANT_CONTEXT_HEALTH_PROFILE_SETTING_KEY,
  ASSISTANT_CONTEXT_CURRENT_MEDICINES_SETTING_KEY,
  ASSISTANT_CONTEXT_SLEEP_RECORDS_SETTING_KEY,
  ASSISTANT_ENABLED_SETTING_KEY,
  ASSISTANT_MEMORY_ENABLED_SETTING_KEY,
  DATA_SHARING_CONSENT_SETTING_KEY,
  WATER_TARGET_COUNT_SETTING_KEY,
} from '../../../common/constants/user-setting-keys.js';

export const USER_SETTING_KEYS = {
  aiSummariesEnabled: AI_SUMMARIES_ENABLED_SETTING_KEY,
  dataSharingConsent: DATA_SHARING_CONSENT_SETTING_KEY,
  assistantEnabled: ASSISTANT_ENABLED_SETTING_KEY,
  assistantMemoryEnabled: ASSISTANT_MEMORY_ENABLED_SETTING_KEY,
  waterTargetCount: WATER_TARGET_COUNT_SETTING_KEY,
} as const;

export const ASSISTANT_CONTEXT_SETTING_KEYS = {
  healthProfile: ASSISTANT_CONTEXT_HEALTH_PROFILE_SETTING_KEY,
  dailyRecords: ASSISTANT_CONTEXT_DAILY_RECORDS_SETTING_KEY,
  sleepRecords: ASSISTANT_CONTEXT_SLEEP_RECORDS_SETTING_KEY,
  currentMedicines: ASSISTANT_CONTEXT_CURRENT_MEDICINES_SETTING_KEY,
} as const;

export const USER_SETTINGS_DEFAULTS = {
  aiSummariesEnabled: true,
  dataSharingConsent: false,
  assistantEnabled: true,
  assistantMemoryEnabled: false,
  waterTargetCount: 8,
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
