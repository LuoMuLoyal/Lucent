/**
 * LangChain-compatible tool definitions for the assistant's function-calling
 * loop.
 *
 * Each tool maps 1:1 to an {@link AssistantToolName}. The LLM decides which
 * tools to call; the actual execution is handled by
 * {@link AssistantToolService} using the conversation context (userId, locale,
 * userMessage), so most tools take no parameters.
 */
import type { AssistantToolName } from './tool-types.js';
import {
  DEFAULT_MEAL_DIGEST_DAYS,
  DEFAULT_MEAL_DIGEST_LIMIT,
  MAX_MEAL_DIGEST_DAYS,
  MAX_MEAL_DIGEST_LIMIT,
} from './tool-constants.js';

interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

const noParams = {
  type: 'object',
  properties: {},
} as const;

/**
 * Tool schemas for the rare tools that take real arguments.
 *
 * Most tools derive everything they need from the conversation context, so they
 * advertise an empty parameter object. `get_meal_analysis_digest` is the first
 * tool whose window is a genuine model decision (`days` / `limit`): the model
 * translates "看看最近两周的饮食" into numbers instead of the server guessing at
 * `userMessage` text. The declared maxima are the same values the server
 * enforces, so the model cannot ask for a window the server will silently cut.
 */
const MEAL_DIGEST_PARAMETERS = {
  type: 'object',
  properties: {
    days: {
      type: 'integer',
      minimum: 1,
      maximum: MAX_MEAL_DIGEST_DAYS,
      description: `Lookback window in days, today included (1-${String(MAX_MEAL_DIGEST_DAYS)}). Defaults to ${String(DEFAULT_MEAL_DIGEST_DAYS)}.`,
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: MAX_MEAL_DIGEST_LIMIT,
      description: `Maximum number of analyzed meals to return, newest first (1-${String(MAX_MEAL_DIGEST_LIMIT)}). Defaults to ${String(DEFAULT_MEAL_DIGEST_LIMIT)}.`,
    },
  },
  additionalProperties: false,
} as const;

const TOOL_PARAMETERS: Partial<
  Record<AssistantToolName, Record<string, unknown>>
> = {
  get_meal_analysis_digest: MEAL_DIGEST_PARAMETERS,
};

const TOOL_DESCRIPTIONS: Record<AssistantToolName, string> = {
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
  search_medicine_leaflets:
    'Search medicine leaflets (package inserts) for usage, dosage, contraindications, and side effects.',
  search_medical_qa_corpus:
    'Search an open medical Q&A corpus (low-trust educational reference) for disease knowledge, pathology, and prevention.',
  resolve_drugbank_entity:
    'Resolve a drug name to a DrugBank entity for scientific pharmacology data.',
  get_drugbank_detail:
    'Get detailed DrugBank information: mechanism, pharmacokinetics, interactions.',
  search_drugbank_passages:
    'Search DrugBank passages for drug interaction and mechanism evidence.',
  propose_create_daily_record:
    'Propose creating a new daily record (water, meal, symptom, note, sleep). Does not write — returns a confirmation draft.',
  propose_update_daily_record:
    'Propose updating an existing daily record. Does not write — returns a confirmation draft.',
  propose_delete_daily_record:
    'Propose deleting a daily record. Does not write — returns a confirmation draft.',
  propose_update_user_settings:
    'Propose updating user settings (assistant enabled, memory, context permissions). Does not write — returns a confirmation draft.',
};

/**
 * Builds LangChain tool definitions for the given tool names.
 *
 * @param toolNames - The subset of tools the LLM is allowed to call.
 * @returns Array of tool definitions compatible with `model.bindTools()`.
 */
export function buildToolDefinitions(
  toolNames: readonly AssistantToolName[],
): ToolDefinition[] {
  return toolNames.map((name) => ({
    type: 'function',
    function: {
      name,
      description: TOOL_DESCRIPTIONS[name],
      parameters: TOOL_PARAMETERS[name] ?? noParams,
    },
  }));
}
