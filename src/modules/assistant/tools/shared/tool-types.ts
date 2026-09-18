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
  'get_meal_analysis_digest',
  'search_cn_medicine_products',
  'get_cn_medicine_detail',
  'search_cn_medicine_knowledge',
  'search_medicine_leaflets',
  'resolve_drugbank_entity',
  'get_drugbank_detail',
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
  'get_meal_analysis_digest',
  'search_cn_medicine_products',
  'get_cn_medicine_detail',
  'search_cn_medicine_knowledge',
  'search_medicine_leaflets',
  'resolve_drugbank_entity',
  'get_drugbank_detail',
  'search_drugbank_passages',
] as const satisfies readonly AssistantToolName[];

export const ASSISTANT_IMPLEMENTED_TOOL_NAMES =
  ASSISTANT_TOOL_NAMES satisfies readonly AssistantToolName[];

export const ASSISTANT_TOOL_DISABLED_REASONS = [
  'chat_disabled',
  'context_disabled',
  'model_not_configured',
  'not_implemented',
  'retrieval_unavailable',
] as const;

export type AssistantToolDisabledReason =
  (typeof ASSISTANT_TOOL_DISABLED_REASONS)[number];

/**
 * Tools whose execution depends on the LightRAG sidecar.
 *
 * They are the only ones gated on retrieval availability: when the sidecar is
 * disabled or unreachable, no degradation path exists for Chinese prose
 * retrieval (计划 §一.7 —— 不做降级)，所以这些工具必须报
 * `retrieval_unavailable`，让客户端把它显示成"检索暂不可用"，
 * 而不是伪装成"确实没有证据"。
 *
 * DrugBank passage search deliberately stays out: it reads a pgvector table
 * inside Lucent's own database, not the sidecar.
 */
export const ASSISTANT_RETRIEVAL_TOOL_NAMES = [
  'search_cn_medicine_knowledge',
] as const satisfies readonly AssistantToolName[];

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
  get_meal_analysis_digest: ['daily_records'],
  search_cn_medicine_products: [],
  get_cn_medicine_detail: [],
  search_cn_medicine_knowledge: [],
  search_medicine_leaflets: [],
  resolve_drugbank_entity: [],
  get_drugbank_detail: [],
  search_drugbank_passages: [],
  propose_create_daily_record: [],
  propose_update_daily_record: ['daily_records'],
  propose_delete_daily_record: ['daily_records'],
  propose_update_user_settings: [],
} as const satisfies Record<
  AssistantToolName,
  readonly AssistantContextSource[]
>;
