/**
 * Retrieval ports (ADR-0024 `application/ports`).
 *
 * The tool adapters under `adapters/acl/tools` need two things from the two
 * sidecars: **is it usable** (capability discovery) and **the normalized types**
 * they hand back. They used to import the concrete HTTP clients in
 * `infrastructure/retrieval/`, which pointed the dependency the wrong way —
 * adapters may not depend on infrastructure.
 *
 * The ports are deliberately narrow: `isEnabled()` plus the shapes. The clients
 * themselves (timeouts, headers, error kinds) stay in infrastructure; the
 * adapters never see an HTTP concern.
 */

import type {
  LightragCallFailure,
  LightragQueryOutcome as LightragQueryValue,
  LightragQueryMode,
  LightragSource,
} from './lightrag.types.js';
import type {
  SemanticaCallFailure,
  SemanticaGraphSchema,
  SemanticaQueryOutcome,
  SemanticaReasonOutcome,
} from './semantica.types.js';


/** DI tokens — strings so a Nest resolution error names the port readably. */
export const ASSISTANT_LIGHTRAG = 'ASSISTANT_LIGHTRAG';
export const ASSISTANT_SEMANTICA = 'ASSISTANT_SEMANTICA';

/**
 * The LightRAG client **as the tool adapters use it**.
 *
 * `isEnabled() === false` means "no degradation path exists": callers must report
 * `retrieval_unavailable` rather than pretend there was no evidence.
 */
/**
 * What a query returns, as the port states it.
 *
 * Deliberately not `Pick<Client, ...>`: naming the class here would make the port
 * depend on the implementation module, which is the direction the layer rule
 * forbids. The implementation satisfies these types, so a drift breaks its build
 * rather than the callers'.
 */
export type LightragQueryOutcome =
  | { ok: true; value: LightragQueryValue }
  | { ok: false; failure: LightragCallFailure };

export type SemanticaResult<T> =
  | { ok: true; value: T }
  | { ok: false; failure: SemanticaCallFailure };

export interface LightragAvailability {
  isEnabled(): boolean;
  resolveTimeoutMs(mode: LightragQueryMode): number;
  buildDisabledFailure(): LightragCallFailure;
  query(input: {
    workspace: string;
    query: string;
    mode?: LightragQueryMode;
    limit: number;
  }): Promise<LightragQueryOutcome>;
}

/** The Semantica client as the ontology tool adapters use it. */
export interface SemanticaAvailability {
  isEnabled(): boolean;
  buildDisabledFailure(): SemanticaCallFailure;
  schema(): Promise<SemanticaResult<SemanticaGraphSchema>>;
  query(input: {
    cypher: string;
    params?: Record<string, unknown>;
    limit?: number;
  }): Promise<SemanticaResult<SemanticaQueryOutcome>>;
  reason(input: Record<string, unknown>): Promise<SemanticaResult<SemanticaReasonOutcome>>;
}

/** Re-exported for the tool adapters' parameter schemas. */
export type {
  LightragCallFailure,
  LightragQueryMode,
  LightragSource,
  SemanticaCallFailure,
};
export {
  LIGHTRAG_DEFAULT_LIMIT,
  LIGHTRAG_DEFAULT_MODE,
  LIGHTRAG_DEFAULT_SOURCE,
  LIGHTRAG_MAX_LIMIT,
  LIGHTRAG_QUERY_MODES,
  LIGHTRAG_REJECTED_MODES,
  LIGHTRAG_SOURCES,
  parseGraphSources,
} from './lightrag.types.js';
