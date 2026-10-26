/**
 * LangChain-compatible tool definitions for the assistant's function-calling
 * loop.
 *
 * Each tool maps 1:1 to an {@link ToolName}. The LLM decides which
 * tools to call; the actual execution is handled by
 * {@link AssistantToolService} using the conversation context (userId, locale,
 * userMessage), so most tools take no parameters.
 */
import type { ToolName } from '../../../../domain/policies/tool-permission.js';
import { TOOL_DESCRIPTIONS } from '../../../../domain/policies/tool-permission.js';

export { TOOL_DESCRIPTIONS };
import {
  DEFAULT_MEAL_DIGEST_DAYS,
  DEFAULT_MEAL_DIGEST_LIMIT,
  MAX_MEAL_DIGEST_DAYS,
  MAX_MEAL_DIGEST_LIMIT,
} from './tool-constants.js';
import {
  LIGHTRAG_DEFAULT_LIMIT,
  LIGHTRAG_DEFAULT_MODE,
  LIGHTRAG_MAX_LIMIT,
  LIGHTRAG_QUERY_MODES,
  LIGHTRAG_SOURCES,
} from '../../../../application/ports/retrieval.js';
import {
  SEMANTICA_DEFAULT_LIMIT,
  SEMANTICA_MAX_LIMIT,
  SEMANTICA_REASON_DEFAULT_LIMIT,
  SEMANTICA_REASON_MAX_LIMIT,
} from '../../../../application/ports/semantica.types.js';

interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * Upper bounds advertised to the model, resolved from the runtime snapshot.
 *
 * The schema maximum is part of the contract: if it says 8 while the server
 * would accept 100, the model never asks for more than 8 and the operator's
 * change has no effect. The advertised value and the server-side clamp
 * therefore read the same snapshot key.
 */
export interface ToolLimitBudgets {
  readonly lightragMaxLimit: number;
  readonly semanticaMaxLimit: number;
  readonly semanticaReasonMaxLimit: number;
}

/** Code baselines; mirrored by the runtime schema, used when no snapshot exists. */
export const CODE_TOOL_LIMIT_BUDGETS: ToolLimitBudgets = {
  lightragMaxLimit: LIGHTRAG_MAX_LIMIT,
  semanticaMaxLimit: SEMANTICA_MAX_LIMIT,
  semanticaReasonMaxLimit: SEMANTICA_REASON_MAX_LIMIT,
};

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

const buildCnMedicineKnowledgeParameters = (budgets: ToolLimitBudgets) => ({
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description:
        'The natural-language question to search for, in Chinese when the user asked in Chinese.',
    },
    source: {
      type: 'string',
      enum: [...LIGHTRAG_SOURCES],
      description:
        'Which evidence library to search. "leaflet" = Chinese medicine package inserts (dosage, contraindications, adverse reactions, interactions). "qa" = an open medical Q&A corpus (disease knowledge, pathology, prevention; low-trust educational reference). Choose exactly one; the two libraries are never mixed in a single call.',
    },
    mode: {
      type: 'string',
      enum: [...LIGHTRAG_QUERY_MODES],
      description: `Retrieval mode. "${LIGHTRAG_DEFAULT_MODE}" (default) = vector similarity over text chunks: fast, and the right choice for a single fact (one dosage, one contraindication). "local"/"global"/"hybrid"/"mix" = graph-augmented retrieval: they traverse a knowledge graph of entities and relations, which surfaces evidence spread across several documents that vector search alone misses — use one of these when the question needs cross-document connection (e.g. what several drugs interact with), not for single-fact lookups. They are much slower (tens of seconds) because they first call a model to extract keywords. The graph is built for "leaflet" only, so "qa" accepts "${LIGHTRAG_DEFAULT_MODE}" alone; "bypass" is rejected.`,
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: budgets.lightragMaxLimit,
      description: `Maximum number of evidence chunks to return (1-${String(budgets.lightragMaxLimit)}). Defaults to ${String(LIGHTRAG_DEFAULT_LIMIT)}.`,
    },
  },
  required: ['query', 'source'],
  additionalProperties: false,
});

/**
 * 本体推理工具的参数。
 *
 * `question` 是模型真正要表达的东西（一次一个药理问题），服务端不做文本启发式
 * 猜测；`limit` 的上界与服务端强制的上界是同一个常量，模型问不到会被静默裁剪的窗口。
 */
const buildOntologyReasoningParameters = (budgets: ToolLimitBudgets) => ({
  type: 'object',
  properties: {
    question: {
      type: 'string',
      description:
        'One pharmacological question to answer from the English DrugBank knowledge graph. Keep drug and target names in English as DrugBank writes them.',
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: budgets.semanticaMaxLimit,
      description: `Maximum number of graph rows to return (1-${String(budgets.semanticaMaxLimit)}). Defaults to ${String(SEMANTICA_DEFAULT_LIMIT)}.`,
    },
  },
  required: ['question'],
  additionalProperties: false,
});

/**
 * 规则推理工具的参数。
 *
 * 与 {@link ONTOLOGY_REASONING_PARAMETERS} 的关键区别：这里**必须显式给范围**。
 * `/reason` 的代价随范围增长，不给范围就是在全图上跑不动点——那不是"更全"，
 * 而是把一个分钟级的计算塞进秒级的工具调用，结果只会是超时，而超时会被
 * 误读成"图上没有"。所以 `scope` 是 required 而不是可选。
 *
 * `intent` 也 required：规则库里有哪几条规则由 sidecar 说了算，模型从
 * `list_reasoning_rules` 拿，不靠猜也不写死在提示词里。
 */
const buildRuleReasoningParameters = (budgets: ToolLimitBudgets) => ({
  type: 'object',
  properties: {
    intent: {
      type: 'string',
      description:
        'Which rule library entry to apply, as reported by the rule list. Each intent names one rule.',
    },
    query: {
      type: 'string',
      description:
        'The rule\'s conclusion to read, in Datalog form. Pin what you are asking about with a constant and leave the rest as a `?` variable, e.g. `potential_ddi(DB00682, ?B)` asks "what does this drug potentially interact with". A pattern that pins nothing is refused rather than answered.',
    },
    drug_names: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Drug names or DrugBank ids bounding the subgraph to reason over. At least one of `drug_names` / `atc_prefixes` is required: the reasoning runs over an explicit scope, never the whole graph.',
    },
    atc_prefixes: {
      type: 'array',
      items: { type: 'string' },
      description:
        'ATC class prefixes (e.g. "B01A") bounding the subgraph. Alternative to naming drugs directly.',
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: budgets.semanticaReasonMaxLimit,
      description: `Maximum number of graph edges to read into the scope (1-${String(budgets.semanticaReasonMaxLimit)}). Defaults to ${String(SEMANTICA_REASON_DEFAULT_LIMIT)}. A scope that hits this bound is reported as truncated — raise it only when you need the wider subgraph, because the reasoning cost grows with it.`,
    },
  },
  required: ['intent', 'query'],
  additionalProperties: false,
});

/**
 * DrugBank 实体解析的参数。
 *
 * ⚠️ 这两个工具（本项与下面的 passage 搜索）**长期没有声明参数**，于是模型只能传空
 * 对象、服务端只能去读 `context.userMessage`（用户原句）——而整句当 SQL 的 `contains`
 * 模式必然 0 行。2026-10-07 生产实测："查了英文显示零个，换成英文还是零个"就是这个，
 * 复现见 `search.service.ts` 的同名注释。参数在这里补上，工具侧再优先读 `toolArgs`。
 *
 * `query` 明确要求**只给药品名**：给整句会把解析重新打回 0 行。
 */
const DRUGBANK_ENTITY_PARAMETERS = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description:
        'The drug to resolve, as a DrugBank-style name, CAS number, UNII or DrugBank id (e.g. "ibuprofen", "15687-27-1", "DB01050"). Pass the drug identifier alone — never the whole user question.',
    },
  },
  required: ['query'],
  additionalProperties: false,
} as const;

/**
 * DrugBank 段落检索的参数。
 *
 * 与实体解析分开：这里 `query` 是**要检索什么内容**（可以是"与糖皮质激素的相互作用"
 * 这种描述），而不是药品名；药品身份由 `drugbankId` / `drugName` 单独给。
 * 旧实现把两者混成一个"用户原句"，于是作用域解析必然失败、段落检索永远返回空
 * （工具自身的报错是 "requires one resolved DrugBank entity scope"）。
 */
const DRUGBANK_PASSAGE_PARAMETERS = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description:
        'What to look for inside that drug\'s DrugBank passages, e.g. "drug interactions with corticosteroids" or "mechanism of action".',
    },
    drugbankId: {
      type: 'string',
      description:
        'DrugBank id to scope the search to (e.g. "DB01050"). Prefer this after resolve_drugbank_entity returned exactly one entity, or to disambiguate several matches.',
    },
    drugName: {
      type: 'string',
      description:
        'Drug name to scope the search to when you do not have the DrugBank id yet (e.g. "ibuprofen"). Ignored when drugbankId is given.',
    },
  },
  required: ['query'],
  additionalProperties: false,
} as const;

/**
 * Parameter schemas for the tools that take arguments.
 *
 * Built per call rather than once at module load: the advertised maxima are
 * tunables, and a module-level object would freeze whatever the first import
 * happened to see.
 */
function buildToolParameters(
  budgets: ToolLimitBudgets,
): Partial<Record<ToolName, Record<string, unknown>>> {
  return {
    get_meal_analysis_digest: MEAL_DIGEST_PARAMETERS,
    search_cn_medicine_knowledge: buildCnMedicineKnowledgeParameters(budgets),
    resolve_drugbank_entity: DRUGBANK_ENTITY_PARAMETERS,
    search_drugbank_passages: DRUGBANK_PASSAGE_PARAMETERS,
    reason_over_ontology: buildOntologyReasoningParameters(budgets),
    reason_over_rules: buildRuleReasoningParameters(budgets),
  };
}

/**
 * Builds LangChain tool definitions for the given tool names.
 *
 * @param toolNames - The subset of tools the LLM is allowed to call.
 * @returns Array of tool definitions compatible with `model.bindTools()`.
 */
export function buildToolDefinitions(
  toolNames: readonly ToolName[],
  budgets: ToolLimitBudgets = CODE_TOOL_LIMIT_BUDGETS,
): ToolDefinition[] {
  const parameters = buildToolParameters(budgets);
  return toolNames.map((name) => ({
    type: 'function',
    function: {
      name,
      description: TOOL_DESCRIPTIONS[name],
      parameters: parameters[name] ?? noParams,
    },
  }));
}
