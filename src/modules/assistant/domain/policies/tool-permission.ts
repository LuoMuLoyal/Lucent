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

/** One-line, model-facing description of each tool (domain vocabulary). */
export const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  get_today_records:
    "Retrieve the user's daily records for today, including meals, water, symptoms, and notes.",
  get_records_by_date:
    "Retrieve the user's daily records for a specific date mentioned in the conversation.",
  get_records_by_range:
    "Retrieve the user's daily records for a date range (e.g. 'last 7 days').",
  get_today_summary_by_date:
    'Retrieve a persisted Today AI summary for a specific date.',
  get_report_summary_by_range:
    'Retrieve a persisted report (weekly/monthly) AI summary for a date range.',
  get_recent_today_summaries: 'Retrieve recent historical Today AI summaries.',
  get_recent_report_summaries:
    'Retrieve recent historical report AI summaries.',
  get_user_profile:
    "Retrieve the user's health profile: allergies, conditions, blood type, height, etc.",
  get_user_settings: "Retrieve the user's assistant and privacy settings.",
  get_current_medicines:
    "Retrieve the user's current medicines and active dose reminders.",
  get_sleep_summary_by_range:
    "Retrieve the user's sleep summaries for a date range.",
  get_meal_analysis_digest:
    "Retrieve the user's already-computed meal analyses (energy interval + ranked findings per meal) for a lookback window. Use this instead of re-reading meal photos or re-deriving nutrition; pass `days` and `limit` to size the window.",
  search_cn_medicine_products:
    'Search Chinese medicine products by approval number, manufacturer, or product name.',
  get_cn_medicine_detail:
    'Get detailed information about a specific Chinese medicine product.',
  search_cn_medicine_knowledge:
    'Search Chinese prose medicine knowledge (package-insert fields such as dosage/contraindications/adverse reactions, or an open medical Q&A corpus) by meaning. Pick exactly one source per call; never mix them.',
  resolve_drugbank_entity:
    'Resolve a drug name to a DrugBank entity for scientific pharmacology data.',
  get_drugbank_detail:
    'Get detailed DrugBank information: mechanism, pharmacokinetics, interactions.',
  search_drugbank_passages:
    'Search DrugBank passages for drug interaction and mechanism evidence.',
  reason_over_ontology:
    'Answer a pharmacology question by reasoning over the English DrugBank knowledge graph of typed drug–target–enzyme relationships. Use it for multi-hop questions ("which drugs share this target", "is X metabolized by the same enzyme as Y", "do A and B interact") instead of inferring them from prose. It returns the executed query with its rows so the answer stays auditable, plus one provenance citation per assertion the rows rest on (result.citations[].id — each resolves to the DrugBank source table and row it came from). Cite those ids when you state a relationship, and never cite one the result does not contain. Zero rows means this graph has no such edge — it is not proof that no such relationship exists, because the graph only mirrors what the source data asserts.',
  reason_over_rules:
    'Derive new facts from the DrugBank knowledge graph using a stated rule, for questions the graph cannot answer by reading edges alone ("do A and B interact through a shared enzyme", "what does this drug potentially interact with"). Unlike reason_over_ontology this returns *derived* conclusions, not asserted edges: each one names the rule that produced it and carries citations to the assertions it rests on. Present them as derived, never as things the data states. Requires an explicit scope (`drug_names` or `atc_prefixes`) — it reasons over that subgraph, and a conclusion is only as complete as the scope it came from. An empty result is a finding about the scope you gave, not about the graph.',
  propose_create_daily_record:
    'Propose creating a new daily record (water, meal, symptom, note, sleep). Does not write — returns a confirmation draft.',
  propose_update_daily_record:
    'Propose updating an existing daily record. Does not write — returns a confirmation draft.',
  propose_delete_daily_record:
    'Propose deleting a daily record. Does not write — returns a confirmation draft.',
  propose_update_user_settings:
    'Propose updating user settings (assistant enabled, memory, context permissions). Does not write — returns a confirmation draft.',
};
