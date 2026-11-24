/**
 * Canonical user-setting key strings shared across modules.
 *
 * These keys are used by both domain modules (settings) and common
 * infrastructure (AI summaries). Keeping them in `common/` breaks the
 * previous reverse dependency where `common/llm` imported from
 * `modules/settings`.
 */

export const AI_SUMMARIES_ENABLED_SETTING_KEY = 'aiSummariesEnabled';
export const DATA_SHARING_CONSENT_SETTING_KEY = 'dataSharingConsent';
export const ASSISTANT_ENABLED_SETTING_KEY = 'assistantEnabled';
export const ASSISTANT_MEMORY_ENABLED_SETTING_KEY = 'assistantMemoryEnabled';
export const ASSISTANT_AGENT_MODE_SETTING_KEY = 'assistantAgentMode';

export const ASSISTANT_CONTEXT_HEALTH_PROFILE_SETTING_KEY =
  'assistantContext.healthProfile';
export const ASSISTANT_CONTEXT_DAILY_RECORDS_SETTING_KEY =
  'assistantContext.records';
export const ASSISTANT_CONTEXT_SLEEP_RECORDS_SETTING_KEY =
  'assistantContext.sleepRecords';
export const ASSISTANT_CONTEXT_CURRENT_MEDICINES_SETTING_KEY =
  'assistantContext.currentMedicines';

export const WATER_TARGET_COUNT_SETTING_KEY = 'waterTargetCount';
