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

/**
 * Every tool the assistant knows about.
 *
 * Names follow `verb_noun` and are kept short on purpose: they travel through
 * `capabilities` into the OpenAPI contract and into every MCP tool list, and a
 * name is read by a model on every turn. See `TOOL_DESCRIPTIONS` for the
 * conventions that govern the prose half of each definition.
 */
export const TOOL_NAMES = [
  'get_today_records',
  'get_records_by_date',
  'get_records_by_range',
  'get_today_summary',
  'get_report_summary',
  'get_today_summaries',
  'get_report_summaries',
  'get_user_profile',
  'get_user_settings',
  'get_medicines',
  'get_sleep_summary',
  'get_meal_digest',
  'search_cn_products',
  'get_cn_product_detail',
  'search_cn_knowledge',
  'resolve_drugbank',
  'get_drugbank_detail',
  'search_drugbank',
  'reason_ontology',
  'reason_rules',
  'create_record_draft',
  'update_record_draft',
  'delete_record_draft',
  'update_settings_draft',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

/** The read-only tools — the subset a read turn may bind. */
export const READ_TOOL_NAMES = [
  'get_today_records',
  'get_records_by_date',
  'get_records_by_range',
  'get_today_summary',
  'get_report_summary',
  'get_today_summaries',
  'get_report_summaries',
  'get_user_profile',
  'get_user_settings',
  'get_medicines',
  'get_sleep_summary',
  'get_meal_digest',
  'search_cn_products',
  'get_cn_product_detail',
  'search_cn_knowledge',
  'resolve_drugbank',
  'get_drugbank_detail',
  'search_drugbank',
  'reason_ontology',
  'reason_rules',
] as const satisfies readonly ToolName[];

/** Tools whose execution depends on the LightRAG sidecar (Chinese prose). */
export const RETRIEVAL_TOOL_NAMES = [
  'search_cn_knowledge',
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
  'reason_ontology',
  'reason_rules',
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
  get_today_summary: [],
  get_report_summary: [],
  get_today_summaries: [],
  get_report_summaries: [],
  get_user_profile: ['health_profile'],
  get_user_settings: [],
  get_medicines: ['current_medicines'],
  get_sleep_summary: ['sleep_records'],
  get_meal_digest: ['daily_records'],
  search_cn_products: [],
  get_cn_product_detail: [],
  search_cn_knowledge: [],
  resolve_drugbank: [],
  get_drugbank_detail: [],
  search_drugbank: [],
  reason_ontology: [],
  reason_rules: [],
  create_record_draft: [],
  update_record_draft: ['daily_records'],
  delete_record_draft: ['daily_records'],
  update_settings_draft: [],
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

/**
 * One-line, model-facing description of each tool.
 *
 * ## Shape
 *
 * `"[what it does]. [what it returns]. [what it does NOT do / when to use the
 * sibling instead]."` — the same three-part form the Anthropic MCP review
 * criteria describe. A description is the only thing a model reads before
 * choosing a tool, so it is prompt text, not documentation.
 *
 * ## Rules this file follows
 *
 * - **No behavioural instructions.** Nothing here says "always", "you must", or
 *   "cite X" — those belong in the system prompt, and in a tool description they
 *   read as prompt injection at review.
 * - **Output contracts stay out.** Citation ids, envelope fields and empty-result
 *   semantics are properties of the returned `data`; restating them here would
 *   duplicate `assistant-safety.md` and drift from it.
 * - **Siblings are disambiguated.** When two tools are near-neighbours, each says
 *   which one the other handles, so a wrong-tool call is preventable by reading
 *   one line.
 * - **Short.** Aim ≤200 characters; the two longest shapes below are the ones
 *   where "returns" genuinely needs two clauses.
 */
export const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  // ── User data ──────────────────────────────────────────────────────
  get_today_records:
    "Read the user's daily records for today: meals, water, symptoms, notes. Returns the read envelope with coverage and ambiguities.",
  get_records_by_date:
    "Read the user's daily records for one named date. Use get_records_by_range when the user gives a span instead of a single day.",
  get_records_by_range:
    "Read the user's daily records across a date range (e.g. 'last 7 days'). Returns per-day records with the envelope.",
  get_today_summary:
    'Read the persisted Today AI summary for one date. Summaries are stored results, not live model calls.',
  get_report_summary:
    'Read the persisted weekly/monthly report summary for a date range. Use get_today_summary for a single day.',
  get_today_summaries:
    'List recent persisted Today summaries without a date filter. Use get_today_summary when the user names one date.',
  get_report_summaries:
    'List recent persisted report summaries without a date filter. Use get_report_summary when the user names a range.',
  get_user_profile:
    "Read the user's health profile: allergies, conditions, blood type, height. Stable facts, not daily records.",
  get_user_settings:
    "Read the user's assistant settings: enabled state, memory, context permissions.",
  get_medicines:
    "Read the user's current medicines and active dose reminders. Use get_medicines for what they take now; search_cn_products for product facts.",
  get_sleep_summary:
    "Read the user's sleep summaries across a date range. Distinct from daily records, which carry sleep entries only as part of a day.",
  get_meal_digest:
    "Read already-computed meal analyses for a lookback window: energy interval plus ranked findings per meal. Pass days and limit to size it. Does not re-derive nutrition from record text.",

  // ── Chinese product catalogue (SQL key lookup) ─────────────────────
  search_cn_products:
    'Search Chinese medicine products by approval number, manufacturer, or product name. Returns candidates only — call get_cn_product_detail for one result.',
  get_cn_product_detail:
    'Read one Chinese medicine product by id. Takes an id, not a name — use search_cn_products to find the id first.',

  // ── Chinese prose (LightRAG) ───────────────────────────────────────
  search_cn_knowledge:
    'Search Chinese package-insert prose and the open medical QA corpus by meaning: dosage, contraindications, adverse reactions, interactions. Returns exactly one source per call; the two are separate evidence and are not merged. Use search_cn_products for structured product facts.',

  // ── English DrugBank (SQL + pgvector + graph) ──────────────────────
  resolve_drugbank:
    'Resolve a drug name, CAS, UNII or DrugBank id to one DrugBank entity. Pass the identifier alone, not the whole question. Required before search_drugbank and get_drugbank_detail.',
  get_drugbank_detail:
    'Read structured DrugBank fields for one resolved entity: mechanism, pharmacokinetics, interactions. Requires a resolved entity — use resolve_drugbank first, and search_drugbank for narrative passages.',
  search_drugbank:
    'Search narrative DrugBank passages for interaction and mechanism evidence. Scope it with drugbankId or drugName from resolve_drugbank. Use get_drugbank_detail for structured fields and reason_ontology for typed edges.',

  // ── Ontology reasoning (Semantica sidecar) ─────────────────────────
  reason_ontology:
    'Read typed drug–target–enzyme edges from the DrugBank graph for multi-hop questions: shared targets, same enzyme, whether two drugs interact. Returns the executed query with its rows. Use reason_rules when the answer must be derived rather than read; use search_drugbank for narrative evidence. Zero rows means the graph holds no such edge, not that none exists.',
  reason_rules:
    'Derive new facts from the DrugBank graph under a stated rule, for questions no single edge answers: indirect interaction through a shared enzyme, potential interactions. Returns derived conclusions, each naming its rule — not asserted edges. Requires an explicit scope (drug_names or atc_prefixes). Use reason_ontology to read direct edges instead.',

  // ── Write proposals (HITL) ─────────────────────────────────────────
  create_record_draft:
    'Draft a new daily record (water, meal, symptom, note, sleep) for the user to confirm. Does not write — returns a confirmation draft with an expiry.',
  update_record_draft:
    'Draft an edit to an existing daily record for the user to confirm. Does not write — returns a confirmation draft with an expiry.',
  delete_record_draft:
    'Draft the deletion of a daily record for the user to confirm. Does not write — returns a confirmation draft with an expiry.',
  update_settings_draft:
    'Draft a change to assistant settings (enabled, memory, context permissions) for the user to confirm. Does not write — returns a confirmation draft.',
};
