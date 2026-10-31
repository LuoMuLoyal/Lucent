/**
 * Generation request (ADR-0024 domain layer).
 *
 * A request asks the agent to compose one presentation surface from a natural
 * language instruction, inside a **closed vocabulary** of display primitives
 * and reference keys. This file owns the rules that must hold before spending
 * a model call:
 *
 * 1. the surface exists and is a page (not the tab chrome);
 * 2. the instruction is usable (non-empty, bounded).
 *
 * What gets composed is the model's answer; what *may* be composed is checked
 * afterwards on the produced messages (`surface-policy.ts`).
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
 * A strict subset of `LAYOUT_SURFACES`: `tab_chrome` is the bottom bar (icons,
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

/** One generation request, as the domain sees it. */
export interface GenerationRequest {
  readonly surface: string;
  readonly prompt: string;
  readonly range?: GenerativeRange;
}

/**
 * Rejects a request the server must not spend a model call on.
 *
 * Returns the failure instead of throwing so the use case decides how to
 * surface it (ADR-0012: the domain names failure shapes, adapters map them).
 */
export function validateGenerationRequest(
  request: GenerationRequest,
): DomainFailure | null {
  if (!isLayoutSurface(request.surface)) {
    return {
      _tag: 'DomainFailure',
      kind: 'validation',
      code: 'LAYOUT_SURFACE_UNKNOWN',
      args: { surface: request.surface },
    };
  }

  // Known surface, but not a page: refuse rather than generate a tree the
  // client has nowhere to mount.
  if (!isGenerativeSurface(request.surface)) {
    return {
      _tag: 'DomainFailure',
      kind: 'validation',
      code: 'GENERATIVE_SURFACE_UNSUPPORTED',
      args: { surface: request.surface },
    };
  }

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
