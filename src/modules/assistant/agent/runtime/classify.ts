import type { AssistantToolName } from '../../tools/shared/tool-types';
import { selectRelevantToolsForMessage } from './router';
import { WRITE_INTENT_RULES } from './tool-keyword-rules';

/**
 * Semantic intent of the user message, used by the runtime graph to route to
 * intent-specific sub-graphs or fast paths.
 *
 * - `simple_chat`    — greeting / chit-chat that needs no tools.
 * - `read_data`      — reads the user's own records, summaries, profile.
 * - `write_proposal` — proposes record/settings mutations (never writes DB).
 * - `knowledge`      — medicine / medical knowledge retrieval (RAG).
 * - `mixed`          — spans multiple categories (e.g. read + write).
 */
export type AssistantIntent =
  | 'simple_chat'
  | 'read_data'
  | 'write_proposal'
  | 'knowledge'
  | 'mixed';

/** Knowledge-retrieval tools (RAG / external medicine data). */
const KNOWLEDGE_TOOL_NAMES = new Set<AssistantToolName>([
  'search_cn_medicine_products',
  'get_cn_medicine_detail',
  'search_medicine_leaflets',
  'search_medical_qa_corpus',
  'resolve_drugbank_entity',
  'get_drugbank_detail',
  'search_drugbank_passages',
]);

/** Write-proposal tools (never write to the DB directly). */
const WRITE_TOOL_NAMES = new Set<AssistantToolName>([
  'propose_create_daily_record',
  'propose_update_daily_record',
  'propose_delete_daily_record',
  'propose_update_user_settings',
]);

export interface IntentClassification {
  intent: AssistantIntent;
  relevantTools: AssistantToolName[];
}

/**
 * Pure rule-based intent classification. No LLM is invoked.
 *
 * Runs the existing keyword router (`selectRelevantToolsForMessage`) and then
 * buckets the matched tools into read / write / knowledge categories. Empty
 * matches fall back to `simple_chat` unless a write intent pattern matched
 * (write tools simply are not available in this run).
 */
export function classifyIntent(
  userMessage: string,
  allowedTools: readonly AssistantToolName[],
): IntentClassification {
  const relevantTools = selectRelevantToolsForMessage(
    userMessage,
    allowedTools,
  );

  if (relevantTools.length === 0) {
    const hasWriteIntent = WRITE_INTENT_RULES.some((rule) =>
      rule.test(userMessage),
    );
    return {
      intent: hasWriteIntent ? 'write_proposal' : 'simple_chat',
      relevantTools,
    };
  }

  let hasRead = false;
  let hasWrite = false;
  let hasKnowledge = false;
  for (const toolName of relevantTools) {
    if (WRITE_TOOL_NAMES.has(toolName)) {
      hasWrite = true;
    } else if (KNOWLEDGE_TOOL_NAMES.has(toolName)) {
      hasKnowledge = true;
    } else {
      hasRead = true;
    }
  }

  // Write proposals win over their auxiliary reads: the router attaches
  // `get_today_records` to propose-create as context, which is not a genuine
  // mixed intent. Only read × knowledge (or write × knowledge) counts as mixed.
  const intent: AssistantIntent = hasWrite
    ? hasKnowledge
      ? 'mixed'
      : 'write_proposal'
    : hasRead && hasKnowledge
      ? 'mixed'
      : hasKnowledge
        ? 'knowledge'
        : 'read_data';

  return { intent, relevantTools };
}
