/**
 * Bridges the assistant's existing tool set into deepagents.
 *
 * ## Why a bridge at all
 *
 * The 24 tools under `adapters/acl/tools/` are executed through
 * `AssistantToolService.executeOne`, which owns the per-tool timeout, the result
 * cache, the empty/timeout metrics and the proposal envelopes. Re-implementing
 * that surface as `StructuredTool` instances would be a second executor that
 * has to stay in step with the first.
 *
 * So the bridge does one thing: expose each tool to deepagents as a
 * `StructuredTool` whose implementation calls the **existing** executor. The
 * tool set, its permission filtering and its envelopes stay exactly where they
 * are (ADR-0009 / ADR-0024); only the calling convention changes.
 *
 * ## Parameters
 *
 * deepagents needs a zod schema per tool, while the assistant declares JSON
 * Schema (`tool-definitions.ts`). Only six tools take arguments, so the zod
 * schemas are written out here rather than generated — a JSON-Schema-to-zod
 * translator would be a third representation to keep in sync for one caller.
 * The bounds below are read from the same live budgets the JSON Schema uses, so
 * the model cannot be told a range the server would clamp.
 */
import { tool, type StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import type { ToolName } from '../../domain/policies/tool-permission.js';
import { TOOL_DESCRIPTIONS } from '../../domain/policies/tool-permission.js';
import type {
  AssistantToolCall,
  AssistantToolExecutionResult,
} from '../../application/ports/assistant.js';
import type { ToolLimitBudgets } from '../acl/tools/shared/tool-definitions.js';
import {
  DEFAULT_MEAL_DIGEST_DAYS,
  DEFAULT_MEAL_DIGEST_LIMIT,
  MAX_MEAL_DIGEST_DAYS,
  MAX_MEAL_DIGEST_LIMIT,
} from '../acl/tools/shared/tool-constants.js';
import {
  LIGHTRAG_DEFAULT_LIMIT,
  LIGHTRAG_DEFAULT_MODE,
  LIGHTRAG_QUERY_MODES,
  LIGHTRAG_SOURCES,
} from '../../application/ports/retrieval.js';
import {
  SEMANTICA_DEFAULT_LIMIT,
  SEMANTICA_REASON_DEFAULT_LIMIT,
} from '../../application/ports/semantica.types.js';
import {
  DEFAULT_REACTION_DRUG_LIMIT,
  MAX_REACTION_DRUG_LIMIT,
} from '../../../medicines/application/ports/onsides.js';

/**
 * Builds the zod schema for a tool that takes arguments.
 *
 * `undefined` means "this tool takes none", which is the majority. The executor
 * still receives `{}` for those, matching what the JSON-Schema path sends.
 */
function buildParameters(
  name: ToolName,
  budgets: ToolLimitBudgets,
): z.ZodType<Record<string, unknown>> | undefined {
  switch (name) {
    case 'get_meal_digest':
      return z.object({
        days: z
          .number()
          .int()
          .min(1)
          .max(MAX_MEAL_DIGEST_DAYS)
          .optional()
          .describe(
            `Lookback window in days, today included (1-${String(MAX_MEAL_DIGEST_DAYS)}). Defaults to ${String(DEFAULT_MEAL_DIGEST_DAYS)}.`,
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_MEAL_DIGEST_LIMIT)
          .optional()
          .describe(
            `Maximum number of analyzed meals (1-${String(MAX_MEAL_DIGEST_LIMIT)}). Defaults to ${String(DEFAULT_MEAL_DIGEST_LIMIT)}.`,
          ),
      });

    case 'search_cn_knowledge':
      return z.object({
        query: z
          .string()
          .min(1)
          .describe('What to look for, as a question or phrase.'),
        source: z
          .enum(LIGHTRAG_SOURCES)
          .describe(
            'Exactly one source per call: "leaflet" for package-insert facts, "qa" for the open medical corpus. Never mix them.',
          ),
        mode: z
          .enum(LIGHTRAG_QUERY_MODES)
          .optional()
          .describe(
            `Retrieval mode. Graph modes are only available for sources whose graph is built. Defaults to "${LIGHTRAG_DEFAULT_MODE}".`,
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(budgets.lightragMaxLimit)
          .optional()
          .describe(
            `Maximum chunks to return (1-${String(budgets.lightragMaxLimit)}). Defaults to ${String(LIGHTRAG_DEFAULT_LIMIT)}.`,
          ),
      });

    case 'resolve_drugbank':
      return z.object({
        query: z
          .string()
          .min(1)
          .describe(
            'The drug to resolve, as a DrugBank-style name, CAS number, UNII or DrugBank id. Pass the identifier alone — never the whole user question.',
          ),
      });

    case 'search_drugbank':
      return z.object({
        query: z
          .string()
          .min(1)
          .describe(
            'What to look for inside that drug\'s DrugBank passages, e.g. "drug interactions with corticosteroids".',
          ),
        drugbankId: z
          .string()
          .optional()
          .describe(
            'DrugBank id to scope the search to. Prefer this after resolve_drugbank returned exactly one entity.',
          ),
        drugName: z
          .string()
          .optional()
          .describe(
            'Drug name to scope the search to when you have no DrugBank id yet. Ignored when drugbankId is given.',
          ),
      });

    case 'search_adverse_reactions':
      return z.object({
        direction: z
          .enum(['by_drug', 'by_ingredient', 'by_reaction'])
          .describe(
            'Which way to read the evidence. by_drug needs drugbankId, by_ingredient needs rxnormCui, by_reaction needs meddraId.',
          ),
        drugbankId: z
          .string()
          .optional()
          .describe(
            'DrugBank id, required for direction=by_drug (e.g. "DB01050").',
          ),
        rxnormCui: z
          .string()
          .optional()
          .describe(
            'RxNorm ingredient CUI, required for direction=by_ingredient (e.g. "5640").',
          ),
        meddraId: z
          .string()
          .optional()
          .describe(
            'MedDRA term id, required for direction=by_reaction. Take it from a previous result.',
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_REACTION_DRUG_LIMIT)
          .optional()
          .describe(
            `Maximum rows to return (1-${String(MAX_REACTION_DRUG_LIMIT)}). Defaults to ${String(DEFAULT_REACTION_DRUG_LIMIT)}.`,
          ),
      });

    case 'reason_ontology':
      return z.object({
        question: z
          .string()
          .min(1)
          .describe(
            'The pharmacology question to answer over the typed DrugBank graph.',
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(budgets.semanticaMaxLimit)
          .optional()
          .describe(
            `Maximum rows to return (1-${String(budgets.semanticaMaxLimit)}). Defaults to ${String(SEMANTICA_DEFAULT_LIMIT)}.`,
          ),
      });

    case 'reason_rules':
      return z.object({
        intent: z
          .string()
          .min(1)
          .describe(
            'The rule to apply, taken from the sidecar rule catalogue.',
          ),
        query: z
          .string()
          .min(1)
          .describe(
            'The derivation to run; it must pin at least one constant argument.',
          ),
        drug_names: z
          .array(z.string())
          .optional()
          .describe(
            'Scope by drug names. Either this or atc_prefixes is required.',
          ),
        atc_prefixes: z
          .array(z.string())
          .optional()
          .describe(
            'Scope by ATC prefixes. Either this or drug_names is required.',
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(budgets.semanticaReasonMaxLimit)
          .optional()
          .describe(
            `Maximum conclusions to return (1-${String(budgets.semanticaReasonMaxLimit)}). Defaults to ${String(SEMANTICA_REASON_DEFAULT_LIMIT)}.`,
          ),
      });

    default:
      return undefined;
  }
}

/** Renders one executor result as the text a model reads. */
function renderResult(result: AssistantToolExecutionResult): string {
  if (result.timeout === true) {
    return JSON.stringify({
      timeout: true,
      reason:
        'The tool exceeded its time budget. Report the gap rather than guessing.',
    });
  }
  return JSON.stringify(result.data);
}

/**
 * Builds the tool instances deepagents binds.
 *
 * Each returned tool keeps the assistant's own name, description and — crucially
 * — calls `execute`, which is the production executor. That is what preserves
 * the proposal envelopes and the timeout contract: an agent that could bypass
 * them would be able to describe a draft as an applied write.
 */
export function buildDeepAgentTools(options: {
  toolNames: readonly ToolName[];
  budgets: ToolLimitBudgets;
  /** The production executor: `AssistantToolService.executeMany`. */
  execute: (
    calls: readonly AssistantToolCall[],
  ) => Promise<AssistantToolExecutionResult[]>;
}): StructuredTool[] {
  const { toolNames, budgets, execute } = options;

  return toolNames.map((name) => {
    const parameters = buildParameters(name, budgets);

    const definition = {
      name,
      description: TOOL_DESCRIPTIONS[name],
      /**
       * The model's arguments go straight through as `args`, which is how the
       * existing tools already receive them (`context.toolArgs`). Nothing is
       * parsed out of the user message here.
       */
      func: async (args: Record<string, unknown>) => {
        const [result] = await execute([{ name, args }]);
        // The executor always returns one result per call; a missing entry would
        // mean the executor broke its contract, and silently returning "ok"
        // would hide that from the model.
        return renderResult(
          result ?? {
            name,
            data: {
              unavailable: true,
              reason: 'Tool result was not produced.',
            },
          },
        );
      },
    };

    return (
      parameters != null
        ? tool(definition.func, { ...definition, schema: parameters })
        : tool(definition.func, { ...definition, schema: z.object({}) })
    ) as StructuredTool;
  });
}
