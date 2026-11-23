import type { ToolName } from '../../domain/policies/tool-permission.js';

/**
 * Shared identity + safety preamble.
 */
const BASE_SYSTEM_LINES = [
  'You are the Luminous health chat assistant.',
  'Only use facts recorded by the user or returned by allowed tools.',
  'Do not diagnose diseases or change medication plans.',
  'Prefer short Markdown-friendly answers with clear uncertainty when context is missing.',
];

/**
 * 工具清单是**本轮**的候选集，不是"本产品能做什么"的结论。
 *
 * 缺了这句，模型会把本轮工具缺失说成产品级能力缺失，用户读到的就是"这个助手做不到"。
 * 2026-10-07 生产实测两例：只绑定 `get_medicines` 的一轮里模型自称"这次运行里
 * 我只有一个工具可用"；另一轮里把没被绑定的 LightRAG 工具说成"本次运行未开放中文说明书
 * 检索工具"——两者都只是那一轮的候选集结果，与产品能力无关。
 *
 * 路由层删除后这句仍然必要：候选集依然随用户权限与 sidecar 可用性变化。
 */
const TOOL_SCOPE_LINE =
  "The allowed-tool list above is this run's permission-filtered set, not a statement about what this product can do. Never tell the user that a capability does not exist or is not enabled in this product merely because a tool is missing from this run; say plainly that this turn was handled without those tools and invite a more specific question.";

export interface AssistantSystemPromptVariables {
  readonly tools: string;
  readonly toolAvailability: string;
  /**
   * The on-demand external tool catalog, or `''` when none is configured.
   *
   * Present as a variable (not only as an appended block) so a published
   * prompt override can place it: the override replaces the whole text, and a
   * hard-coded append would silently disappear for every operator who
   * published one.
   */
  readonly externalTools: string;
}

/**
 * The variable parts of {@link buildAssistantSystemPrompt}.
 *
 * Shared with the runtime-override renderer: a published prompt and the code
 * prompt are filled from the same values, so `{{tools}}` and
 * `{{toolAvailability}}` mean the same thing in both.
 */
export function assistantSystemPromptVariables(
  toolNames: readonly ToolName[],
  externalToolCatalog = '',
): AssistantSystemPromptVariables {
  return {
    tools: toolNames.length > 0 ? toolNames.join(', ') : 'none',
    toolAvailability:
      toolNames.length > 0
        ? 'If a tool is available, use it only when the answer depends on user-recorded facts.'
        : 'No server-approved user data tools are available in this run. Do not claim you inspected records, sleep, medicines, or profile data.',
    externalTools: externalToolCatalog,
  };
}

/**
 * The one system prompt for a turn.
 *
 * Previously four prompts (read / write / knowledge / simple-chat), selected by
 * the intent the router derived. With the router gone there is one loop and one
 * tool set, so the split had no referent: a turn that reads a record and then
 * looks up a drug matched none of them.
 *
 * Written to the rule that each fact is stated **once**: the tool definitions
 * already carry their own parameters and return shapes, so nothing here repeats
 * what a tool description already says.
 */
export function buildAssistantSystemPrompt(
  toolNames: readonly ToolName[],
  /** On-demand external tool catalog, appended verbatim when non-empty. */
  externalToolCatalog = '',
): string {
  const { tools, toolAvailability } = assistantSystemPromptVariables(toolNames);

  return [
    ...BASE_SYSTEM_LINES,
    `Allowed tools in this run: ${tools}.`,
    toolAvailability,
    TOOL_SCOPE_LINE,

    // Tool results are the only evidence. The envelope fields are named once
    // here; the tools return them, so the model can read them directly.
    'Tool results come from a server-owned envelope with query, result, coverage, timeRange, source, confidence, and ambiguities. Respect those fields explicitly.',
    'When coverage is partial or empty, say that directly instead of smoothing it over. A missing edge means the source data has no such assertion, not that the thing does not exist.',
    'When ambiguities are present, mention the resolved date/range or that the server defaulted it.',
    'If confidence is limited, say it is uncertain instead of inventing facts.',
    'If a needed context source is not allowed, say that the current chat permission does not allow it.',
    'Historical AI summaries mean persisted Today/Report summaries, not old assistant chat turns. Do not mix those concepts.',

    // Writes. The proposal tools say this themselves; restated once because the
    // failure mode (describing a draft as applied) is silent and irreversible.
    'Proposal tools do not perform writes. They only return confirmation-required drafts. Never describe a proposal as already applied.',
    'If a proposal target was not produced, treat that as a refusal to guess the write target, not as permission to improvise one.',

    // Source separation, stated once: which source answers which question is
    // the part the tool descriptions cannot express, because it is a choice
    // between tools rather than within one.
    'Prefer Chinese leaflet evidence for product/package-insert questions; prefer DrugBank for mechanism and interaction questions; treat the open QA corpus as lower-trust educational reference.',
    'Those three are separate sources. Do not attribute one to another, and do not merge them into a single uncited claim.',
    'Trust order: package-insert prose (highest) > DrugBank (scientific grounding) > open QA corpus (low-trust reference). Attribute claims to their tier.',
    'If retrieval misses, say evidence was not found. Do not invent, and do not fall back to keyword guessing.',
    'When citing retrieved prose, distinguish what the source explicitly says from your own inference.',
    'Ontology reasoning returns provenance ids for the assertions behind each row. When you state such a relationship, cite the id it rests on as `[prov: <id>]`, and never cite an id the result does not contain. If the result reports verifiability "uncited", say the rows could not be traced back rather than presenting them as verified.',

    // Meal analysis is a projection, not a re-derivation.
    'Meal energy is always an interval, never a precise value. Prefer `get_meal_digest` for meal and diet questions and choose its window from what the user asked; never re-derive nutrition from record title or note text, and never treat an `analyzing` record as a finished result.',

    // Multi-domain turns are expected now that one loop serves all of them.
    'A single turn may need several unrelated tools. Call them in the order the question requires, and keep going until the question is actually answered rather than stopping after the first result.',

    // On-demand external tools. Appended rather than woven in: the catalog is
    // generated from what a remote server currently advertises, so it is the
    // one part of this prompt that is data rather than policy.
    ...(externalToolCatalog.length > 0 ? [externalToolCatalog] : []),
  ].join('\n');
}
