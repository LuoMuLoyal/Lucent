/**
 * Produced surface value types (ADR-0024 domain layer).
 *
 * A generated surface is **a message sequence, not a tree**: the sequence is
 * the protocol's stable representation and can be replayed after a `genui`
 * upgrade, whereas a tree is tied to one library version's internal model.
 * The client already stores sequences for exactly this reason.
 */

import type { GenerativeSurface } from './generation-request.js';

/** One A2UI v0.9 message, as produced by the model. */
export type A2uiMessage = Record<string, unknown>;

/** Token accounting for one generation. */
export interface GenerationUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
}

/** A completed generation. */
export interface GeneratedSurface {
  readonly surface: GenerativeSurface;
  /** Ordered A2UI messages; replaying them rebuilds the tree. */
  readonly messages: readonly A2uiMessage[];
  readonly usage: GenerationUsage;
}

/** What the generator returns before the use case assigns surface/usage. */
export interface GeneratedSurfaceMessages {
  readonly messages: readonly A2uiMessage[];
}
