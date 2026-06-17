export const AI_CHAT_CONTEXT_SOURCES = [
  'health_profile',
  'daily_records',
  'sleep_records',
  'current_medicines',
] as const;

export type AiChatContextSource = (typeof AI_CHAT_CONTEXT_SOURCES)[number];

export const AI_CHAT_TOOL_NAMES = [
  'health_context_snapshot',
  'recent_daily_records',
  'recent_sleep_summary',
  'current_medicines',
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
  health_context_snapshot: ['health_profile'],
  recent_daily_records: ['daily_records'],
  recent_sleep_summary: ['sleep_records'],
  current_medicines: ['current_medicines'],
} as const satisfies Record<AiChatToolName, readonly AiChatContextSource[]>;
