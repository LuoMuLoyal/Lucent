/**
 * ⚠️ **TEMPORARY re-export shim — delete this file.**
 *
 * The candidate vocabulary now lives in
 * `domain/suggestion/suggestion-candidate.ts` (ADR-0024). This file exists only
 * so the existing import sites did not have to change in the same commit as the
 * move — that keeps each migration step independently compilable and revertible.
 *
 * **It is a forwarding layer, not a second definition.** There is exactly one
 * source of truth; nothing here declares a type.
 *
 * **How to delete it:** point every remaining importer at
 * `../domain/suggestion/suggestion-candidate.js` and remove this file. The
 * compiler will list any site you missed. It must not survive as a permanent
 * indirection.
 */

export type {
  CopyGenerationMetadata,
  SuggestionCandidate,
} from '../domain/suggestion/suggestion-candidate.js';
