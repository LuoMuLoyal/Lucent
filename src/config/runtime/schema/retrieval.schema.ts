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
  [EnvKey.ASSISTANT_NODE_TIMEOUT_MS]: numberField({
    family: 'retrieval',
    min: MIN_TOOL_BUDGET_MS,
    max: MAX_TOOL_BUDGET_MS,
    defaultValue: 75_000,
  }),
  [EnvKey.ASSISTANT_MEMORY_EXTRACTION_TIMEOUT_MS]: numberField({
    family: 'retrieval',
    min: MIN_TOOL_BUDGET_MS,
    max: MAX_TOOL_BUDGET_MS,
    defaultValue: 11_000,
  }),
} satisfies Record<string, RuntimeFieldSpec<unknown>>;
