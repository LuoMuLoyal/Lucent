/**
 * ⚠️ **TEMPORARY re-export shim — delete this file.**
 *
 * The vocabulary it forwards now lives in `domain/suggestion/suggestion.types.ts`
 * (ADR-0024: the Daily Guidance enums are domain language, not `types/` bucket
 * contents). This file exists only so the ~51 existing import sites did not have
 * to change in the same commit as the move — that keeps each step of the
 * migration independently compilable and revertible.
 *
 * **It is a forwarding layer, not a second definition.** There is exactly one
 * source of truth; nothing here declares a type. That is what makes deleting it
 * safe, unlike a duplicated definition.
 *
 * **How to delete it:** point every remaining importer at
 * `../domain/suggestion/suggestion.types.js` and remove this file. The compiler
 * will list any site you missed — that is the whole point of doing it last.
 * It must not survive as a permanent indirection.
 */

export {
  SuggestionType,
  TriggerType,
  SuggestionLifecycleState,
  SuggestionFeedback,
  SuggestionConfidence,
} from '../domain/suggestion/suggestion.types.js';
export type { SuggestionCardTone } from '../domain/suggestion/suggestion.types.js';
