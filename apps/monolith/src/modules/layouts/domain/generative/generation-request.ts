/**
 * Generation request (ADR-0024 domain layer).
 *
 * A request asks the agent to compose one presentation surface from a natural
 * language instruction. This file owns the rules that must hold before spending
 * a model call:
 *
 * 1. the surface exists and is a page (not the tab chrome);
 * 2. the instruction is usable (non-empty, bounded) — for a turn, that the round
 *    carries messages and the document they belong to;
 * 3. the client's capabilities document is well-formed enough to prompt with.
 *
 * ## A2UI 1.0: the vocabulary moved to the client
 *
 * Up to v0.9 the server owned a closed component list and `surface-policy.ts`
 * enforced it. In v1.0 the client's catalog is full (Button, TextField, Slider,
 * Modal … all registered) and the client **advertises it on every call** as
 * `capabilities`. The server therefore no longer keeps a second copy: the prompt
 * is built from what the client sent. What is left to check structurally is in
 * `a2ui-envelope.ts`.
 */

import type { DomainFailure } from '../../../../common/result/index.js';

import { isLayoutSurface } from '../layout/surface.js';

/** Upper bound on the user's instruction, in characters. */
export const GENERATIVE_PROMPT_MAX_LENGTH = 2000;

/** Time ranges the client can render. Mirrors `RangeKey.wireValue`. */
export const GENERATIVE_RANGES = ['7d', '30d'] as const;
export type GenerativeRange = (typeof GENERATIVE_RANGES)[number];

/**
 * Surfaces the agent may compose.
 *
 * A strict subset of `LAYOUT_SURFACES`: `tab` is the bottom bar (icons,
 * labels, order), not a page. The client renders it from a different model, so
 * a generated tree there would have nowhere to mount.
 *
 * Kept as its own constant rather than derived from `LAYOUT_SURFACES`: the two
 * lists answer different questions ("where can a layout be stored" vs "where
 * can a tree be generated") and will drift independently.
 */
export const GENERATIVE_SURFACES = [
  'today',
  'record',
  'medicine',
  'review',
  'mine',
] as const;

export type GenerativeSurface = (typeof GENERATIVE_SURFACES)[number];

export function isGenerativeSurface(value: string): value is GenerativeSurface {
  return (GENERATIVE_SURFACES as readonly string[]).includes(value);
}

/** The client's catalog document, as it arrives on the wire. */
export type SurfaceCapabilities = Record<string, unknown>;

/** One generation request, as the domain sees it. */
export interface GenerationRequest {
  readonly surface: string;
  readonly prompt: string;
  readonly range?: GenerativeRange;
  /**
   * The client's catalog document (A2UI v1.0 renderer capabilities).
   *
   * The client owns the component vocabulary and advertises it on every call;
   * the server builds the prompt from this rather than from a hard-coded list.
   * Absent when the client sent none, in which case the prompt falls back to a
   * generic description of the protocol.
   */
  readonly capabilities?: SurfaceCapabilities;
}

/** A surface document as the client holds it. */
export interface SurfaceDocument {
  /** Agent-to-renderer messages, in arrival order. */
  readonly messages: readonly Record<string, unknown>[];
  /** Renderer data model snapshot, when the agent asked for one. */
  readonly dataModel?: Record<string, unknown>;
}

/**
 * One interaction round: the renderer's outbound messages plus the current
 * document, so the agent can continue the same surface.
 *
 * The server is **stateless** here: it holds no session, so every round carries
 * the whole document. That is cheaper than a session store and survives a
 * restart or a second device without any reconciliation.
 */
export interface SurfaceTurnRequest {
  readonly surface: string;
  /** Renderer-to-agent messages (`action` / `callAgentFunction` / `error`). */
  readonly messages: readonly Record<string, unknown>[];
  /** The document those messages belong to. */
  readonly document: SurfaceDocument;
  readonly capabilities?: SurfaceCapabilities;
}

/** Bytes in one kibibyte; named so the documented size below reads as 256 KiB. */
const BYTES_PER_KIB = 1024;

/** How many kibibytes of catalog document one request may carry. */
const CAPABILITIES_MAX_KIB = 256;

/** Upper bound on the serialized capabilities document: 256 KiB. */
export const GENERATIVE_CAPABILITIES_MAX_BYTES =
  CAPABILITIES_MAX_KIB * BYTES_PER_KIB;

/** Bound on how many messages a turn may carry up. */
export const SURFACE_TURN_MESSAGES_MAX = 20;

/**
 * Rejects a request the server must not spend a model call on.
 *
 * Returns the failure instead of throwing so the use case decides how to
 * surface it (ADR-0012: the domain names failure shapes, adapters map them).
 */
export function validateGenerationRequest(
  request: GenerationRequest,
): DomainFailure | null {
  const surfaceFailure = validateComposableSurface(request.surface);
  if (surfaceFailure != null) return surfaceFailure;

  const prompt = request.prompt.trim();
  if (prompt.length === 0) {
    return {
      _tag: 'DomainFailure',
      kind: 'validation',
      code: 'GENERATIVE_PROMPT_EMPTY',
    };
  }

  if (prompt.length > GENERATIVE_PROMPT_MAX_LENGTH) {
    return {
      _tag: 'DomainFailure',
      kind: 'validation',
      code: 'GENERATIVE_PROMPT_TOO_LONG',
      args: { maxLength: GENERATIVE_PROMPT_MAX_LENGTH },
    };
  }

  return validateCapabilities(request.capabilities);
}

/**
 * Rejects a turn the server must not spend a model call on.
 *
 * A turn carries no prompt: what the model should do is implied by the action
 * and the document. The shape checks are the whole validation.
 */
export function validateTurnRequest(
  request: SurfaceTurnRequest,
): DomainFailure | null {
  const surfaceFailure = validateComposableSurface(request.surface);
  if (surfaceFailure != null) return surfaceFailure;

  if (request.messages.length === 0) {
    return {
      _tag: 'DomainFailure',
      kind: 'validation',
      code: 'GENERATIVE_TURN_EMPTY',
    };
  }

  if (request.messages.length > SURFACE_TURN_MESSAGES_MAX) {
    return {
      _tag: 'DomainFailure',
      kind: 'validation',
      code: 'GENERATIVE_TURN_TOO_LARGE',
      args: { maxMessages: SURFACE_TURN_MESSAGES_MAX },
    };
  }

  // A turn without the document cannot be continued: the agent needs the tree
  // the action was fired from. Refuse rather than compose a fresh surface that
  // would replace what the user is looking at.
  if (request.document.messages.length === 0) {
    return {
      _tag: 'DomainFailure',
      kind: 'validation',
      code: 'GENERATIVE_DOCUMENT_EMPTY',
    };
  }

  return validateCapabilities(request.capabilities);
}

/** Shared surface check for both endpoints. */
function validateComposableSurface(surface: string): DomainFailure | null {
  if (!isLayoutSurface(surface)) {
    return {
      _tag: 'DomainFailure',
      kind: 'validation',
      code: 'LAYOUT_SURFACE_UNKNOWN',
      args: { surface },
    };
  }

  // Known surface, but not a page: refuse rather than generate a tree the
  // client has nowhere to mount.
  if (!isGenerativeSurface(surface)) {
    return {
      _tag: 'DomainFailure',
      kind: 'validation',
      code: 'GENERATIVE_SURFACE_UNSUPPORTED',
      args: { surface },
    };
  }

  return null;
}

/**
 * How large a capabilities document may be.
 *
 * The client owns the catalog, so the server cannot bound it structurally — only
 * this size ceiling, which keeps one request from pushing an arbitrarily large
 * prompt at the model.
 */
export function validateCapabilities(
  capabilities: SurfaceCapabilities | undefined,
): DomainFailure | null {
  if (capabilities == null) return null;

  let serialized: string;
  try {
    serialized = JSON.stringify(capabilities);
    // The rule reports the CatchClause, so the exemption sits on the line above
    // it rather than inside the block.
    // eslint-disable-next-line error-handling/no-silent-catch -- the error rides in the returned failure, not swallowed
  } catch (error) {
    // A cyclic or otherwise unserializable document cannot become a prompt.
    // This is caller-side data, not a server fault, so it is a validation
    // failure rather than an internal error.
    return {
      _tag: 'DomainFailure',
      kind: 'validation',
      code: 'GENERATIVE_CAPABILITIES_INVALID',
      cause: error,
    };
  }

  if (
    Buffer.byteLength(serialized, 'utf8') > GENERATIVE_CAPABILITIES_MAX_BYTES
  ) {
    return {
      _tag: 'DomainFailure',
      kind: 'validation',
      code: 'GENERATIVE_CAPABILITIES_TOO_LARGE',
      args: { maxBytes: GENERATIVE_CAPABILITIES_MAX_BYTES },
    };
  }

  return null;
}

/**
 * Narrows a surface string that `validateGenerationRequest` already accepted.
 *
 * Exists so callers do not repeat a bare cast after the validator: the only
 * place the projection happens is right here.
 */
export function toGenerativeSurface(value: string): GenerativeSurface {
  return value as GenerativeSurface;
}
