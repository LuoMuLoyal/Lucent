export const ASSISTANT_CONTEXT_SOURCES = [
  'health_profile',
  'daily_records',
  'sleep_records',
  'current_medicines',
] as const;

export type AssistantContextSource = (typeof ASSISTANT_CONTEXT_SOURCES)[number];

export const ASSISTANT_TOOL_NAMES = [
  'get_today_records',
  'get_records_by_date',
  'get_records_by_range',
  'get_today_summary_by_date',
  'get_report_summary_by_range',
  'get_recent_today_summaries',
  'get_recent_report_summaries',
  'get_user_profile',
  'get_user_settings',
  'get_current_medicines',
  'get_sleep_summary_by_range',
  'search_medicine_leaflets',
  'search_medical_qa_corpus',
  'resolve_drugbank_entity',
  'search_drugbank_passages',
  'propose_create_daily_record',
  'propose_update_daily_record',
  'propose_delete_daily_record',
  'propose_update_user_settings',
] as const;

export type AssistantToolName = (typeof ASSISTANT_TOOL_NAMES)[number];

export const ASSISTANT_READ_TOOL_NAMES = [
  'get_today_records',
  'get_records_by_date',
  'get_records_by_range',
  'get_today_summary_by_date',
  'get_report_summary_by_range',
  'get_recent_today_summaries',
  'get_recent_report_summaries',
  'get_user_profile',
  'get_user_settings',
  'get_current_medicines',
  'get_sleep_summary_by_range',
  'search_medicine_leaflets',
  'search_medical_qa_corpus',
  'resolve_drugbank_entity',
  'search_drugbank_passages',
] as const satisfies readonly AssistantToolName[];

export const ASSISTANT_IMPLEMENTED_TOOL_NAMES =
  ASSISTANT_TOOL_NAMES satisfies readonly AssistantToolName[];

export const ASSISTANT_TOOL_DISABLED_REASONS = [
  'chat_disabled',
  'context_disabled',
  'model_not_configured',
  'not_implemented',
] as const;

export type AssistantToolDisabledReason =
  (typeof ASSISTANT_TOOL_DISABLED_REASONS)[number];

export const ASSISTANT_TOOL_SOURCE_MAP = {
  get_today_records: ['daily_records'],
  get_records_by_date: ['daily_records'],
  get_records_by_range: ['daily_records'],
  get_today_summary_by_date: [],
  get_report_summary_by_range: [],
  get_recent_today_summaries: [],
  get_recent_report_summaries: [],
  get_user_profile: ['health_profile'],
  get_user_settings: [],
  get_current_medicines: ['current_medicines'],
  get_sleep_summary_by_range: ['sleep_records'],
  search_medicine_leaflets: [],
  search_medical_qa_corpus: [],
  resolve_drugbank_entity: [],
  search_drugbank_passages: [],
  propose_create_daily_record: [],
  propose_update_daily_record: ['daily_records'],
  propose_delete_daily_record: ['daily_records'],
  propose_update_user_settings: [],
} as const satisfies Record<
  AssistantToolName,
  readonly AssistantContextSource[]
>;
