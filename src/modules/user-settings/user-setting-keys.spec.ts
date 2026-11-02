import {
  AI_SUMMARIES_ENABLED_SETTING_KEY,
  ASSISTANT_CONTEXT_CURRENT_MEDICINES_SETTING_KEY,
  ASSISTANT_CONTEXT_DAILY_RECORDS_SETTING_KEY,
  ASSISTANT_CONTEXT_HEALTH_PROFILE_SETTING_KEY,
  ASSISTANT_CONTEXT_SLEEP_RECORDS_SETTING_KEY,
  ASSISTANT_ENABLED_SETTING_KEY,
  ASSISTANT_MEMORY_ENABLED_SETTING_KEY,
  DATA_SHARING_CONSENT_SETTING_KEY,
  WATER_TARGET_COUNT_SETTING_KEY,
} from '../../common/constants/user-setting-keys.js';
import {
  ASSISTANT_CONTEXT_SETTING_KEYS,
  USER_SETTING_KEYS,
} from './domain/settings/setting-key.js';

/**
 * Pins the domain's literal key strings to the `common/` constants.
 *
 * The same nine strings necessarily exist in two places: `common/` needs them
 * to read `aiSummariesEnabled` from `common/llm`, and `domain/` is not allowed
 * to import from `common/` (ADR-0024 D1). This test is what keeps the copies
 * equal — a drift here would silently write a setting row nobody reads back.
 */
describe('user-setting key strings match common/constants', () => {
  it('matches the five top-level keys', () => {
    expect(USER_SETTING_KEYS).toEqual({
      aiSummariesEnabled: AI_SUMMARIES_ENABLED_SETTING_KEY,
      dataSharingConsent: DATA_SHARING_CONSENT_SETTING_KEY,
      assistantEnabled: ASSISTANT_ENABLED_SETTING_KEY,
      assistantMemoryEnabled: ASSISTANT_MEMORY_ENABLED_SETTING_KEY,
      waterTargetCount: WATER_TARGET_COUNT_SETTING_KEY,
    });
  });

  it('matches the four assistant-context keys', () => {
    expect(ASSISTANT_CONTEXT_SETTING_KEYS).toEqual({
      healthProfile: ASSISTANT_CONTEXT_HEALTH_PROFILE_SETTING_KEY,
      dailyRecords: ASSISTANT_CONTEXT_DAILY_RECORDS_SETTING_KEY,
      sleepRecords: ASSISTANT_CONTEXT_SLEEP_RECORDS_SETTING_KEY,
      currentMedicines: ASSISTANT_CONTEXT_CURRENT_MEDICINES_SETTING_KEY,
    });
  });
});
