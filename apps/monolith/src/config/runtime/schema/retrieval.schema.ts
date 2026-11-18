/**
 * Retrieval and assistant-budget family: sidecar switches/budgets plus the
 * per-tool and per-node timeouts the assistant runtime enforces.
 *
 * Baselines mirror `env/sidecar-defaults.ts`, the `*_MAX_LIMIT` constants in
 * `modules/assistant/tools/**`, and the tool timeouts in
 * `tools/shared/tool-constants.ts`.
 */

import { EnvKey } from '../../env/env-keys.enum.js';
import {
  LIGHTRAG_DEFAULT_BASE_URL,
  LIGHTRAG_DEFAULT_GRAPH_SOURCES,
  LIGHTRAG_DEFAULT_TIMEOUT_MS,
  LIGHTRAG_GRAPH_DEFAULT_TIMEOUT_MS,
  SEMANTICA_DEFAULT_BASE_URL,
  SEMANTICA_DEFAULT_TIMEOUT_MS,
} from '../../env/sidecar-defaults.js';
import {
  booleanField,
  csvField,
  numberField,
  type RuntimeFieldSpec,
  stringField,
} from './field-spec.js';

/** Request budgets are bounded by 5 minutes; the graph modes are the slowest. */
const MIN_REQUEST_BUDGET_MS = 100;
const MAX_REQUEST_BUDGET_MS = 120_000;
const MIN_TOOL_BUDGET_MS = 1_000;
const MAX_TOOL_BUDGET_MS = 300_000;

export const retrievalRuntimeFields = {
  // ── LightRAG sidecar (Chinese prose retrieval) ────────────────────
  [EnvKey.LIGHTRAG_ENABLED]: booleanField({
    family: 'retrieval',
    defaultValue: false,
  }),
  [EnvKey.LIGHTRAG_BASE_URL]: stringField({
    family: 'retrieval',
    defaultValue: LIGHTRAG_DEFAULT_BASE_URL,
  }),
  [EnvKey.LIGHTRAG_TIMEOUT_MS]: numberField({
    family: 'retrieval',
    min: MIN_REQUEST_BUDGET_MS,
    max: MAX_REQUEST_BUDGET_MS,
    defaultValue: LIGHTRAG_DEFAULT_TIMEOUT_MS,
  }),
  [EnvKey.LIGHTRAG_GRAPH_TIMEOUT_MS]: numberField({
    family: 'retrieval',
    min: MIN_REQUEST_BUDGET_MS,
    max: MAX_REQUEST_BUDGET_MS,
    defaultValue: LIGHTRAG_GRAPH_DEFAULT_TIMEOUT_MS,
  }),
  [EnvKey.LIGHTRAG_GRAPH_SOURCES]: csvField({
    family: 'retrieval',
    defaultValue: [LIGHTRAG_DEFAULT_GRAPH_SOURCES],
  }),
  [EnvKey.LIGHTRAG_WORKSPACE_LEAFLET]: stringField({
    family: 'retrieval',
    defaultValue: 'leaflet',
  }),
  [EnvKey.LIGHTRAG_WORKSPACE_QA]: stringField({
    family: 'retrieval',
    defaultValue: 'qa',
  }),
  [EnvKey.LIGHTRAG_MAX_LIMIT]: numberField({
    family: 'retrieval',
    min: 1,
    max: 100,
    defaultValue: 8,
  }),

  // ── Semantica sidecar (English-side OAG) ──────────────────────────
  [EnvKey.SEMANTICA_ENABLED]: booleanField({
    family: 'retrieval',
    defaultValue: false,
  }),
  [EnvKey.SEMANTICA_BASE_URL]: stringField({
    family: 'retrieval',
    defaultValue: SEMANTICA_DEFAULT_BASE_URL,
  }),
  [EnvKey.SEMANTICA_TIMEOUT_MS]: numberField({
    family: 'retrieval',
    min: MIN_REQUEST_BUDGET_MS,
    max: MAX_REQUEST_BUDGET_MS,
    defaultValue: SEMANTICA_DEFAULT_TIMEOUT_MS,
  }),
  [EnvKey.SEMANTICA_MAX_LIMIT]: numberField({
    family: 'retrieval',
    min: 1,
    max: 1_000,
    defaultValue: 100,
  }),
  [EnvKey.SEMANTICA_REASON_MAX_LIMIT]: numberField({
    family: 'retrieval',
    min: 1,
    max: 50_000,
    defaultValue: 20_000,
  }),

  // ── Assistant retrieval budgets ───────────────────────────────────
  [EnvKey.ASSISTANT_VECTOR_MAX_LIMIT]: numberField({
    family: 'retrieval',
    min: 1,
    max: 100,
    defaultValue: 8,
  }),
  [EnvKey.ASSISTANT_TOOL_TIMEOUT_MS]: numberField({
    family: 'retrieval',
    min: MIN_TOOL_BUDGET_MS,
    max: MAX_TOOL_BUDGET_MS,
    defaultValue: 20_000,
  }),
  [EnvKey.ASSISTANT_ONTOLOGY_TOOL_TIMEOUT_MS]: numberField({
    family: 'retrieval',
    min: MIN_TOOL_BUDGET_MS,
    max: MAX_TOOL_BUDGET_MS,
    defaultValue: 45_000,
  }),
  [EnvKey.ASSISTANT_RETRIEVAL_TOOL_TIMEOUT_MS]: numberField({
    family: 'retrieval',
    min: MIN_TOOL_BUDGET_MS,
    max: MAX_TOOL_BUDGET_MS,
    defaultValue: 65_000,
  }),
  // Baseline = AI_MODEL_TIMEOUT_MS (10s) + the widest tool budget (65s) + 5s,
  // i.e. the value `graph.ts` derives. It must stay above every tool budget:
  // a node that cancels first turns a tool's structured timeout into an opaque
  // `Node "agent" exceeded its run timeout`.
  [EnvKey.ASSISTANT_NODE_TIMEOUT_MS]: numberField({
    family: 'retrieval',
    min: MIN_TOOL_BUDGET_MS,
    max: MAX_TOOL_BUDGET_MS,
    defaultValue: 80_000,
  }),
  [EnvKey.ASSISTANT_MEMORY_EXTRACTION_TIMEOUT_MS]: numberField({
    family: 'retrieval',
    min: MIN_TOOL_BUDGET_MS,
    max: MAX_TOOL_BUDGET_MS,
    defaultValue: 11_000,
  }),
  // Tool-loop cap. A count, not a duration, so it gets its own bounds: the
  // graph's only bound on a turn now that no router narrows the tool set. The
  // floor of 1 still allows a single tool round; the ceiling keeps a runaway
  // turn from spending the whole node timeout budget on round trips.
  [EnvKey.ASSISTANT_MAX_TOOL_LOOPS]: numberField({
    family: 'retrieval',
    min: 1,
    max: 32,
    defaultValue: 8,
  }),

  // ── MCP endpoint ──────────────────────────────────────────────────
  // Hot-switchable like the sidecar flags: turning the endpoint off must not
  // require a restart. Registration happens in `onModuleInit`, so a published
  // `false` stops new sessions from being created but does not tear down an
  // already-registered route — closing a route mid-flight would drop
  // in-progress SSE streams. Operationally: flip it off, drain, then restart.
  [EnvKey.MCP_ENABLED]: booleanField({
    family: 'retrieval',
    defaultValue: false,
  }),
  [EnvKey.MCP_API_KEY]: stringField({
    family: 'retrieval',
    defaultValue: '',
  }),
  // Comma-separated origins. Empty means "no browser may call it", which is the
  // safe default: non-browser clients send no Origin and are still allowed.
  [EnvKey.MCP_ALLOWED_ORIGINS]: stringField({
    family: 'retrieval',
    defaultValue: '',
  }),
} satisfies Record<string, RuntimeFieldSpec<unknown>>;
