export const AI_CHAT_CONTEXT_SOURCES = [
  'health_profile',
  'daily_records',
  'sleep_records',
  'current_medicines',
] as const;

export type AiChatContextSource = (typeof AI_CHAT_CONTEXT_SOURCES)[number];

export const AI_CHAT_TOOL_NAMES = [
  'get_today_records',
  'get_records_by_date',
  'get_records_by_range',
  'get_recent_today_summaries',
  'get_recent_report_summaries',
  'get_user_profile',
  'get_user_settings',
  'get_current_medicines',
  'get_sleep_summary_by_range',
] as const;

export type AiChatToolName = (typeof AI_CHAT_TOOL_NAMES)[number];

export const AI_CHAT_TOOL_DISABLED_REASONS = [
  'chat_disabled',
  'context_disabled',
  'model_not_configured',
  'not_implemented',
] as const;

export type AiChatToolDisabledReason =
  (typeof AI_CHAT_TOOL_DISABLED_REASONS)[number];

export const AI_CHAT_TOOL_SOURCE_MAP = {
  get_today_records: ['daily_records'],
  get_records_by_date: ['daily_records'],
  get_records_by_range: ['daily_records'],
  get_recent_today_summaries: [],
  get_recent_report_summaries: [],
  get_user_profile: ['health_profile'],
  get_user_settings: [],
  get_current_medicines: ['current_medicines'],
  get_sleep_summary_by_range: ['sleep_records'],
} as const satisfies Record<AiChatToolName, readonly AiChatContextSource[]>;
