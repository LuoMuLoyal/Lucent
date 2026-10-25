/**
 * `ToolPermission` policy (ADR-0024 `domain/policies`) — the user's data
 * permission gate.
 *
 * Moved out of `tools/shared/tool-permissions.ts` and out of the graph runtime:
 * "may this tool run for this user" has nothing to do with LangGraph, and living
 * next to the graph made it look like part of the keyword-routing machinery that
 * has since been removed.
 *
 * ## Gate, not router
 *
 * This answers **which data the user allows the assistant to read**. It does not
 * answer "what does this message want" — that is the model's job
 * (`application/services/intent-classifier.ts`). A tool is permitted because the
 * user opened the source, not because the message mentioned it.
 *
 * A tool is permitted when **every** source it declares is enabled. A tool
 * declaring none — all knowledge retrieval and all write proposals — is not
 * constrained by the personal-data switches; it is still constrained by the
 * assistant master switch and by the tool's own availability, which the policy
 * service decides separately.
 *
 * ## Why the vocabulary lives here
 *
 * `TOOL_NAMES`, `CONTEXT_SOURCES` and the source map used to sit in
 * `tools/shared/tool-types.ts`, i.e. inside the ACL that talks to the outside
 * world. They are the assistant's own vocabulary — a tool name is what the
 * application and the graph reason about — so they belong to this layer, and the
 * ACL now imports them from here.
 *
 * Layer purity (ADR-0024 rule D1): no imports outside `domain/`.
 */

/** Personal data sources the user may switch on individually. */
export const CONTEXT_SOURCES = [
  'health_profile',
  'daily_records',
  'sleep_records',
  'current_medicines',
] as const;

export type ContextSource = (typeof CONTEXT_SOURCES)[number];

/** Why a tool cannot be used right now (rendered by the client as a hint). */
export const TOOL_DISABLED_REASONS = [
  'chat_disabled',
  'context_disabled',
  'model_not_configured',
  'not_implemented',
  'retrieval_unavailable',
] as const;

export type ToolDisabledReason = (typeof TOOL_DISABLED_REASONS)[number];

/** Every tool the assistant knows about. */
export const TOOL_NAMES = [
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
  'resolve_drugbank_entity',
  'get_drugbank_detail',
  'search_drugbank_passages',
  'reason_over_ontology',
  'reason_over_rules',
  'propose_create_daily_record',
  'propose_update_daily_record',
  'propose_delete_daily_record',
  'propose_update_user_settings',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

/** The read-only tools — the subset a read turn may bind. */
export const READ_TOOL_NAMES = [
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
  'resolve_drugbank_entity',
  'get_drugbank_detail',
  'search_drugbank_passages',
  'reason_over_ontology',
  'reason_over_rules',
] as const satisfies readonly ToolName[];

/** Tools whose execution depends on the LightRAG sidecar (Chinese prose). */
export const RETRIEVAL_TOOL_NAMES = [
  'search_cn_medicine_knowledge',
] as const satisfies readonly ToolName[];

/**
 * Tools whose execution depends on the Semantica sidecar (English-side OAG).
 *
 * A separate group on purpose: the two sidecars fail independently, and one
 * being down must not mark the other's tools unavailable. Both report the same
 * `retrieval_unavailable` reason — the client renders one "source temporarily
 * unavailable" state either way, and the tool's own envelope says which source.
 */
export const OAG_TOOL_NAMES = [
  'reason_over_ontology',
  'reason_over_rules',
] as const satisfies readonly ToolName[];

/** Membership sets — the arrays above are the single source of truth. */
export const RETRIEVAL_TOOL_NAME_SET: ReadonlySet<ToolName> = new Set(
  RETRIEVAL_TOOL_NAMES,
);

export const OAG_TOOL_NAME_SET: ReadonlySet<ToolName> = new Set(OAG_TOOL_NAMES);

/**
 * Which personal data sources each tool needs.
 *
 * Exhaustive over {@link TOOL_NAMES} (`satisfies Record<...>`): adding a tool
 * without deciding its sources is a compile error rather than a silent
 * "permitted in every context".
 */
export const TOOL_REQUIRED_SOURCES = {
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
  resolve_drugbank_entity: [],
  get_drugbank_detail: [],
  search_drugbank_passages: [],
  reason_over_ontology: [],
  reason_over_rules: [],
  propose_create_daily_record: [],
  propose_update_daily_record: ['daily_records'],
  propose_delete_daily_record: ['daily_records'],
  propose_update_user_settings: [],
} as const satisfies Record<ToolName, readonly ContextSource[]>;

/**
 * The permission gate: tools whose declared sources are **all** enabled.
 *
 * Order follows {@link TOOL_NAMES} so the capability list is stable across calls
 * (the client renders it in order).
 */
export function selectPermittedTools(
  enabledSources: readonly ContextSource[],
): ToolName[] {
  const enabled = new Set(enabledSources);
  return TOOL_NAMES.filter((tool) =>
    TOOL_REQUIRED_SOURCES[tool].every((source) => enabled.has(source)),
  );
}

/** Sources the user has switched on, in canonical order. */
export function selectEnabledSources(
  isEnabled: (source: ContextSource) => boolean,
): ContextSource[] {
  return CONTEXT_SOURCES.filter(isEnabled);
}
